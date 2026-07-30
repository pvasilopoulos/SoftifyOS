import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { calcInvoiceTotals, toNumber } from "@/modules/sales/invoice-utils";
import { creditFromInvoiceSchema } from "@/modules/sales/schemas";
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
    const body = creditFromInvoiceSchema.parse(
      await request.json().catch(() => ({})),
    );

    const source = await prisma.invoice.findFirst({
      where: {
        id,
        tenantId: session.tenantId,
        kind: { in: ["SALES_INVOICE", "RETAIL_RECEIPT"] },
      },
      include: {
        lines: { orderBy: { position: "asc" } },
      },
    });
    if (!source) {
      return NextResponse.json({ error: "Δεν βρέθηκε τιμολόγιο" }, { status: 404 });
    }
    if (source.status === "DRAFT" || source.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Το τιμολόγιο πρέπει να είναι εκδομένο" },
        { status: 400 },
      );
    }

    const prepared = body.lines
      ? body.lines.map((sel) => {
          const line = source.lines.find((l) => l.id === sel.sourceLineId);
          if (!line) throw new Error("Μη έγκυρη γραμμή τιμολογίου");
          const qty = sel.quantity ?? toNumber(line.quantity);
          if (qty > toNumber(line.quantity) + 0.0001) {
            throw new Error(`Υπερβαίνει την ποσότητα γραμμής · ${line.description}`);
          }
          return {
            productId: line.productId,
            description: line.description,
            quantity: qty,
            unitPrice: toNumber(line.unitPrice),
            vatRate: toNumber(line.vatRate),
          };
        })
      : source.lines.map((line) => ({
          productId: line.productId,
          description: line.description,
          quantity: toNumber(line.quantity),
          unitPrice: toNumber(line.unitPrice),
          vatRate: toNumber(line.vatRate),
        }));

    if (prepared.length === 0) {
      return NextResponse.json(
        { error: "Δεν υπάρχουν γραμμές για πιστωτικό" },
        { status: 400 },
      );
    }

    const series =
      (body.seriesId
        ? await prisma.documentSeries.findFirst({
            where: {
              id: body.seriesId,
              tenantId: session.tenantId,
              kind: "SALES_CREDIT",
              isActive: true,
            },
          })
        : null) ??
      (await resolveDefaultSeries(prisma, session.tenantId, "SALES_CREDIT"));

    if (!series) {
      return NextResponse.json(
        { error: "Δεν υπάρχει ενεργή σειρά πιστωτικών — ρυθμίστε Σειρές & Τύποι" },
        { status: 400 },
      );
    }

    const totals = calcInvoiceTotals(prepared);
    const status = body.status ?? "DRAFT";
    const notes =
      body.notes?.trim() ||
      `Πιστωτικό για ${source.number}`;

    const credit = await prisma.$transaction(async (tx) => {
      const allocated = await allocateFromSeries(tx, {
        tenantId: session.tenantId,
        seriesId: series.id,
        kind: "SALES_CREDIT",
      });

      return tx.invoice.create({
        data: {
          tenantId: session.tenantId,
          customerId: source.customerId,
          branchId: source.branchId,
          spaceId: source.spaceId,
          seriesId: allocated.seriesId,
          siteId: allocated.siteId,
          relatedInvoiceId: source.id,
          kind: "SALES_CREDIT",
          number: allocated.number,
          status,
          issuedAt: status === "ISSUED" ? new Date() : null,
          dueAt: source.dueAt,
          currency: source.currency,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          paidAmount: 0,
          notes,
          lines: {
            create: prepared.map((line, idx) => ({
              tenantId: session.tenantId,
              productId: line.productId,
              position: idx + 1,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatRate: line.vatRate,
              lineTotal: totals.lines[idx]!.lineTotal,
            })),
          },
        },
        include: {
          lines: { orderBy: { position: "asc" } },
          relatedInvoice: { select: { id: true, number: true } },
        },
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.credit_from",
      entity: "invoice",
      entityId: credit.id,
      meta: {
        number: credit.number,
        relatedInvoiceId: source.id,
        relatedNumber: source.number,
        status: credit.status,
      },
    });

    return NextResponse.json(
      {
        item: {
          ...credit,
          subtotal: toNumber(credit.subtotal),
          vatAmount: toNumber(credit.vatAmount),
          total: toNumber(credit.total),
          paidAmount: toNumber(credit.paidAmount),
          creditId: credit.id,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = getErrorMessage(error, "Credit create failed");
    const status =
      message.includes("γραμμ") || message.includes("ποσότ") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
