import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  companyStamp,
  isCompanyScopeError,
  requireCompanyId,
} from "@/platform/tenancy/company-scope";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { buildChangeMeta } from "@/platform/tenancy/audit-diff";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  calcInvoiceTotals,
  roundMoney,
  toNumber,
} from "@/modules/sales/invoice-utils";
import { orderInvoiceSchema } from "@/modules/sales/order-schemas";
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
    const legalEntityId = requireCompanyId(session);

    const { id } = await context.params;
    const body = orderInvoiceSchema.parse(
      await request.json().catch(() => ({})),
    );

    const order = await prisma.order.findFirst({
      where: { id, tenantId: session.tenantId, legalEntityId },
      include: {
        series: true,
        lines: { orderBy: { position: "asc" } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (order.kind === "SALES_QUOTE") {
      return NextResponse.json(
        {
          error:
            "Οι προσφορές δεν τιμολογούνται απευθείας — μετατρέψτε σε παραγγελία",
        },
        { status: 400 },
      );
    }
    if (order.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Η ακυρωμένη παραγγελία δεν τιμολογείται" },
        { status: 400 },
      );
    }
    if (order.status === "INVOICED") {
      const existing = await prisma.invoice.findFirst({
        where: { tenantId: session.tenantId, legalEntityId, orderId: order.id },
        select: { id: true, number: true },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(
        {
          error: "Η παραγγελία έχει ήδη τιμολογηθεί πλήρως",
          invoiceId: existing?.id,
          invoiceNumber: existing?.number,
        },
        { status: 409 },
      );
    }

    const selections =
      body.lines && body.lines.length > 0
        ? body.lines
        : order.lines
            .map((line) => {
              const remaining =
                toNumber(line.quantity) - toNumber(line.quantityInvoiced);
              return remaining > 0.0001
                ? { orderLineId: line.id, quantity: remaining }
                : null;
            })
            .filter(Boolean) as Array<{ orderLineId: string; quantity: number }>;

    if (selections.length === 0) {
      return NextResponse.json(
        { error: "Δεν απομένουν ποσότητες προς τιμολόγηση" },
        { status: 400 },
      );
    }

    const invoiceSeries =
      (body.seriesId
        ? await prisma.documentSeries.findFirst({
            where: {
              id: body.seriesId,
              tenantId: session.tenantId,
              legalEntityId,
              kind: "SALES_INVOICE",
              isActive: true,
            },
          })
        : null) ??
      (await resolveDefaultSeries(
        prisma,
        session.tenantId,
        "SALES_INVOICE",
        null,
        legalEntityId,
      ));

    if (!invoiceSeries) {
      return NextResponse.json(
        { error: "Δεν υπάρχει ενεργή σειρά τιμολογίων — ρυθμίστε Σειρές & Τύποι" },
        { status: 400 },
      );
    }

    if (!invoiceSeries.allowPartial && body.lines && body.lines.length > 0) {
      const full = order.lines.every((line) => {
        const sel = selections.find((s) => s.orderLineId === line.id);
        const remaining =
          toNumber(line.quantity) - toNumber(line.quantityInvoiced);
        return sel && Math.abs(sel.quantity - remaining) < 0.0001;
      });
      if (!full) {
        return NextResponse.json(
          { error: "Η σειρά δεν επιτρέπει μερική τιμολόγηση" },
          { status: 400 },
        );
      }
    }

    const preparedLines: Array<{
      orderLineId: string;
      productId: string | null;
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
    }> = [];
    for (const sel of selections) {
      const line = order.lines.find((l) => l.id === sel.orderLineId);
      if (!line) {
        return NextResponse.json(
          { error: "Μη έγκυρη γραμμή παραγγελίας" },
          { status: 400 },
        );
      }
      const remaining =
        toNumber(line.quantity) - toNumber(line.quantityInvoiced);
      if (sel.quantity > remaining + 0.0001) {
        return NextResponse.json(
          {
            error: `Υπερβαίνει το υπόλοιπο γραμμής (${remaining}) · ${line.description}`,
          },
          { status: 400 },
        );
      }
      preparedLines.push({
        orderLineId: line.id,
        productId: line.productId,
        description: line.description,
        quantity: sel.quantity,
        unitPrice: toNumber(line.unitPrice),
        vatRate: toNumber(line.vatRate),
      });
    }

    const totals = calcInvoiceTotals(preparedLines);
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 30);

    const result = await prisma.$transaction(async (tx) => {
      const allocated = await allocateFromSeries(tx, {
        tenantId: session.tenantId,
        seriesId: invoiceSeries.id,
        kind: "SALES_INVOICE",
        legalEntityId,
      });

      const invoice = await tx.invoice.create({
        data: {
          tenantId: session.tenantId,
          ...companyStamp(session),
          customerId: order.customerId,
          branchId: order.branchId,
          spaceId: order.spaceId,
          orderId: order.id,
          seriesId: allocated.seriesId,
          siteId: allocated.siteId,
          kind: "SALES_INVOICE",
          number: allocated.number,
          status: "ISSUED",
          issuedAt: new Date(),
          dueAt,
          currency: order.currency,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          paidAmount: 0,
          notes: order.notes
            ? `Από παραγγελία ${order.number}\n${order.notes}`
            : `Από παραγγελία ${order.number}`,
          lines: {
            create: preparedLines.map((line, idx) => ({
              tenantId: session.tenantId,
              productId: line.productId,
              orderLineId: line.orderLineId,
              position: idx + 1,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatRate: line.vatRate,
              lineTotal: totals.lines[idx]!.lineTotal,
            })),
          },
        },
      });

      for (const line of preparedLines) {
        await tx.orderLine.update({
          where: { id: line.orderLineId },
          data: {
            quantityInvoiced: {
              increment: line.quantity,
            },
          },
        });
      }

      const refreshed = await tx.orderLine.findMany({
        where: { orderId: order.id },
      });
      const fullyInvoiced = refreshed.every(
        (l) => toNumber(l.quantityInvoiced) >= toNumber(l.quantity) - 0.0001,
      );
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: fullyInvoiced ? "INVOICED" : "PARTIAL_INVOICED",
        },
      });

      return invoice;
    });

    const orderAfter = await prisma.order.findFirst({
      where: { id: order.id },
      include: { lines: { orderBy: { position: "asc" } } },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "order.invoice",
      entity: "order",
      entityId: order.id,
      meta: buildChangeMeta({
        before: orderAuditSnapshot(order),
        after: {
          ...(orderAfter
            ? orderAuditSnapshot(orderAfter)
            : { status: "INVOICED" }),
          invoiceId: result.id,
          invoiceNumber: result.number,
          invoiceTotal: roundMoney(totals.total),
        },
        extra: {
          orderNumber: order.number,
          invoiceId: result.id,
          invoiceNumber: result.number,
          partial: preparedLines.length > 0,
          total: roundMoney(totals.total),
        },
        omitKeys: ["id", "updatedAt", "createdAt", "lines"],
      }),
    });

    return NextResponse.json(
      {
        item: {
          orderId: order.id,
          invoiceId: result.id,
          invoiceNumber: result.number,
          total: toNumber(result.total),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Μη έγκυρα δεδομένα τιμολόγησης" },
        { status: 400 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Σύγκρουση αριθμού τιμολογίου — δοκιμάστε ξανά" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Invoice failed") },
      { status: 400 },
    );
  }
}
