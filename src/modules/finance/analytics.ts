import type { PrismaClient } from "@/generated/prisma/client";
import { toNumber } from "@/modules/sales/invoice-utils";

export async function loadArRows(db: PrismaClient, tenantId: string) {
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
    },
    orderBy: [{ dueAt: "asc" }, { issuedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      status: true,
      issuedAt: true,
      dueAt: true,
      total: true,
      paidAmount: true,
      customer: { select: { id: true, code: true, name: true } },
    },
  });

  const now = Date.now();
  return invoices
    .map((inv) => {
      const total = toNumber(inv.total);
      const paid = toNumber(inv.paidAmount);
      const balance = Math.round((total - paid) * 100) / 100;
      const dueMs = inv.dueAt ? inv.dueAt.getTime() : null;
      const daysPastDue =
        dueMs != null && balance > 0.005
          ? Math.max(0, Math.floor((now - dueMs) / 86_400_000))
          : 0;
      let bucket: "current" | "1-30" | "31-60" | "61-90" | "90+" = "current";
      if (daysPastDue > 90) bucket = "90+";
      else if (daysPastDue > 60) bucket = "61-90";
      else if (daysPastDue > 30) bucket = "31-60";
      else if (daysPastDue > 0) bucket = "1-30";
      return {
        id: inv.id,
        number: inv.number,
        status: inv.status,
        issuedAt: inv.issuedAt?.toISOString() ?? null,
        dueAt: inv.dueAt?.toISOString() ?? null,
        total,
        paid,
        balance,
        daysPastDue,
        bucket,
        customer: inv.customer,
      };
    })
    .filter((r) => r.balance > 0.005);
}

export async function loadApRows(db: PrismaClient, tenantId: string) {
  const orders = await db.purchaseOrder.findMany({
    where: {
      tenantId,
      status: { in: ["ORDERED", "PARTIAL", "RECEIVED"] },
    },
    orderBy: [{ orderedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      status: true,
      orderedAt: true,
      total: true,
      supplier: { select: { id: true, code: true, name: true } },
    },
  });

  return orders.map((po) => ({
    id: po.id,
    number: po.number,
    status: po.status,
    orderedAt: po.orderedAt.toISOString(),
    total: toNumber(po.total),
    supplier: po.supplier,
  }));
}

export async function loadVatSummary(
  db: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
) {
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issuedAt: { gte: from, lte: to },
    },
    select: {
      kind: true,
      subtotal: true,
      vatAmount: true,
      total: true,
      lines: { select: { vatRate: true, lineTotal: true, quantity: true, unitPrice: true } },
    },
  });

  const byRate = new Map<
    number,
    { vatRate: number; net: number; vat: number; gross: number; docs: number }
  >();

  let salesNet = 0;
  let salesVat = 0;
  let creditNet = 0;
  let creditVat = 0;

  for (const inv of invoices) {
    const sub = toNumber(inv.subtotal);
    const vat = toNumber(inv.vatAmount);
    const isCredit = inv.kind === "SALES_CREDIT";
    if (isCredit) {
      creditNet += sub;
      creditVat += vat;
    } else {
      salesNet += sub;
      salesVat += vat;
    }

    // Approximate per-rate from lines (lineTotal includes VAT)
    for (const line of inv.lines) {
      const rate = toNumber(line.vatRate);
      const qty = toNumber(line.quantity);
      const unit = toNumber(line.unitPrice);
      const net = Math.round(qty * unit * 100) / 100;
      const lineVat = Math.round(((net * rate) / 100) * 100) / 100;
      const sign = isCredit ? -1 : 1;
      const cur = byRate.get(rate) ?? {
        vatRate: rate,
        net: 0,
        vat: 0,
        gross: 0,
        docs: 0,
      };
      cur.net += sign * net;
      cur.vat += sign * lineVat;
      cur.gross += sign * (net + lineVat);
      byRate.set(rate, cur);
    }
  }

  for (const row of byRate.values()) {
    row.net = Math.round(row.net * 100) / 100;
    row.vat = Math.round(row.vat * 100) / 100;
    row.gross = Math.round(row.gross * 100) / 100;
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    salesNet: Math.round(salesNet * 100) / 100,
    salesVat: Math.round(salesVat * 100) / 100,
    creditNet: Math.round(creditNet * 100) / 100,
    creditVat: Math.round(creditVat * 100) / 100,
    netVatPayable: Math.round((salesVat - creditVat) * 100) / 100,
    byRate: [...byRate.values()].sort((a, b) => b.vatRate - a.vatRate),
    documentCount: invoices.length,
  };
}
