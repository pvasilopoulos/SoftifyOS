import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { buildChangeMeta } from "@/platform/tenancy/audit-diff";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { quoteConvertSchema } from "@/modules/sales/order-schemas";
import { orderAuditSnapshot } from "@/modules/sales/order-audit";
import {
  allocateFromSeries,
  resolveDefaultSeries,
} from "@/modules/documents/series";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = quoteConvertSchema.parse(
      await request.json().catch(() => ({})),
    );

    const quote = await prisma.order.findFirst({
      where: {
        id,
        tenantId: session.tenantId,
        kind: "SALES_QUOTE",
      },
      include: {
        lines: { orderBy: { position: "asc" } },
        convertedOrders: {
          where: { kind: "SALES_ORDER" },
          select: { id: true, number: true },
          take: 1,
        },
      },
    });
    if (!quote) {
      return NextResponse.json({ error: "Δεν βρέθηκε προσφορά" }, { status: 404 });
    }
    if (quote.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Η προσφορά είναι ακυρωμένη" },
        { status: 400 },
      );
    }
    if (quote.convertedOrders[0]) {
      return NextResponse.json(
        {
          error: "Η προσφορά έχει ήδη μετατραπεί",
          orderId: quote.convertedOrders[0].id,
        },
        { status: 409 },
      );
    }

    const series =
      (body.seriesId
        ? await prisma.documentSeries.findFirst({
            where: {
              id: body.seriesId,
              tenantId: session.tenantId,
              kind: "SALES_ORDER",
              isActive: true,
            },
          })
        : null) ??
      (await resolveDefaultSeries(prisma, session.tenantId, "SALES_ORDER"));

    if (!series) {
      return NextResponse.json(
        { error: "Δεν υπάρχει ενεργή σειρά παραγγελιών" },
        { status: 400 },
      );
    }

    const status = body.status ?? "CONFIRMED";
    const notes =
      body.notes?.trim() ||
      `Από προσφορά ${quote.number}${quote.notes ? `\n${quote.notes}` : ""}`;

    const order = await prisma.$transaction(async (tx) => {
      const allocated = await allocateFromSeries(tx, {
        tenantId: session.tenantId,
        seriesId: series.id,
        kind: "SALES_ORDER",
      });

      const created = await tx.order.create({
        data: {
          tenantId: session.tenantId,
          customerId: quote.customerId,
          branchId: quote.branchId,
          spaceId: quote.spaceId,
          seriesId: allocated.seriesId,
          siteId: allocated.siteId,
          sourceQuoteId: quote.id,
          kind: "SALES_ORDER",
          number: allocated.number,
          status,
          currency: quote.currency,
          subtotal: quote.subtotal,
          vatAmount: quote.vatAmount,
          total: quote.total,
          notes,
          lines: {
            create: quote.lines.map((line) => ({
              tenantId: session.tenantId,
              productId: line.productId,
              position: line.position,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatRate: line.vatRate,
              lineTotal: line.lineTotal,
            })),
          },
        },
      });

      await tx.order.update({
        where: { id: quote.id },
        data: { status: "CONFIRMED" },
      });

      return created;
    });

    const quoteAfter = await prisma.order.findFirst({
      where: { id: quote.id },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    const orderFull = await prisma.order.findFirst({
      where: { id: order.id },
      include: { lines: { orderBy: { position: "asc" } } },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "quote.convert",
      entity: "order",
      entityId: order.id,
      meta: buildChangeMeta({
        before: {
          quote: orderAuditSnapshot(quote),
        },
        after: {
          quote: quoteAfter
            ? orderAuditSnapshot(quoteAfter)
            : { ...orderAuditSnapshot(quote), status: "CONFIRMED" },
          order: orderFull
            ? orderAuditSnapshot(orderFull)
            : {
                id: order.id,
                number: order.number,
                status: order.status,
                total: toNumber(order.total),
              },
        },
        extra: {
          orderNumber: order.number,
          quoteId: quote.id,
          quoteNumber: quote.number,
        },
        omitKeys: ["id", "updatedAt", "createdAt", "lines", "lineCount"],
      }),
    });

    return NextResponse.json(
      {
        item: {
          orderId: order.id,
          number: order.number,
          total: toNumber(order.total),
          quoteId: quote.id,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Convert failed") },
      { status: 500 },
    );
  }
}
