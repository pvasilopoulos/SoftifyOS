import type { PrismaClient } from "@/generated/prisma/client";
import { toNumber } from "@/modules/sales/invoice-utils";
import { createAndPostJournal, ensureChartOfAccounts, findAccountByCode } from "./service";
import { round2 } from "./service";

type Db = PrismaClient;

export type VatBookRow = {
  vatRate: number;
  salesNet: number;
  salesVat: number;
  purchaseNet: number;
  purchaseVat: number;
  netVat: number;
};

/** Φ5 — Βιβλίο ΦΠΑ έσοδα/έξοδα από παραστατικά περιόδου */
export async function loadVatBooks(
  db: Db,
  tenantId: string,
  opts: { from: Date; to: Date; legalEntityId?: string | null },
) {
  const sales = await db.invoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issuedAt: { gte: opts.from, lte: opts.to },
      ...(opts.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
    },
    select: {
      kind: true,
      lines: {
        select: { vatRate: true, quantity: true, unitPrice: true },
      },
    },
  });

  const purchases = await db.purchaseInvoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issueDate: { gte: opts.from, lte: opts.to },
      ...(opts.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
    },
    select: {
      lines: {
        select: { vatRate: true, qty: true, unitPrice: true, netAmount: true, vatAmount: true },
      },
    },
  });

  const map = new Map<number, VatBookRow>();

  function row(rate: number): VatBookRow {
    const cur = map.get(rate) ?? {
      vatRate: rate,
      salesNet: 0,
      salesVat: 0,
      purchaseNet: 0,
      purchaseVat: 0,
      netVat: 0,
    };
    map.set(rate, cur);
    return cur;
  }

  for (const inv of sales) {
    const sign = inv.kind === "SALES_CREDIT" ? -1 : 1;
    for (const line of inv.lines) {
      const rate = toNumber(line.vatRate);
      const net = round2(toNumber(line.quantity) * toNumber(line.unitPrice));
      const vat = round2((net * rate) / 100);
      const r = row(rate);
      r.salesNet = round2(r.salesNet + sign * net);
      r.salesVat = round2(r.salesVat + sign * vat);
    }
  }

  for (const inv of purchases) {
    for (const line of inv.lines) {
      const rate = toNumber(line.vatRate);
      const net = toNumber(line.netAmount) || round2(toNumber(line.qty) * toNumber(line.unitPrice));
      const vat = toNumber(line.vatAmount) || round2((net * rate) / 100);
      const r = row(rate);
      r.purchaseNet = round2(r.purchaseNet + net);
      r.purchaseVat = round2(r.purchaseVat + vat);
    }
  }

  const rows = [...map.values()]
    .map((r) => ({
      ...r,
      netVat: round2(r.salesVat - r.purchaseVat),
    }))
    .sort((a, b) => a.vatRate - b.vatRate);

  const totals = rows.reduce(
    (acc, r) => ({
      salesNet: round2(acc.salesNet + r.salesNet),
      salesVat: round2(acc.salesVat + r.salesVat),
      purchaseNet: round2(acc.purchaseNet + r.purchaseNet),
      purchaseVat: round2(acc.purchaseVat + r.purchaseVat),
      netVat: round2(acc.netVat + r.netVat),
    }),
    { salesNet: 0, salesVat: 0, purchaseNet: 0, purchaseVat: 0, netVat: 0 },
  );

  return { rows, totals, from: opts.from.toISOString(), to: opts.to.toISOString() };
}

export type PartyCardLine = {
  at: string;
  docType: string;
  number: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  refId: string;
};

/** Φ5 — Καρτέλα πελάτη (AR) από τιμολόγια + εξοφλήσεις */
export async function loadCustomerCard(
  db: Db,
  tenantId: string,
  customerId: string,
  opts?: { from?: Date | null; to?: Date | null; legalEntityId?: string | null },
) {
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, code: true, name: true },
  });
  if (!customer) return null;

  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      customerId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(opts?.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
      ...(opts?.from || opts?.to
        ? {
            issuedAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      number: true,
      kind: true,
      total: true,
      issuedAt: true,
      createdAt: true,
    },
    orderBy: { issuedAt: "asc" },
  });

  const settlements = await db.settlement.findMany({
    where: {
      tenantId,
      customerId,
      kind: "RECEIPT",
      status: "POSTED",
      ...(opts?.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
      ...(opts?.from || opts?.to
        ? {
            settledAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      number: true,
      totalAmount: true,
      settledAt: true,
    },
    orderBy: { settledAt: "asc" },
  });

  type Ev = { at: Date; sort: number; line: Omit<PartyCardLine, "balance"> };
  const events: Ev[] = [];

  for (const inv of invoices) {
    const total = toNumber(inv.total);
    const isCredit = inv.kind === "SALES_CREDIT";
    events.push({
      at: inv.issuedAt ?? inv.createdAt,
      sort: 0,
      line: {
        at: (inv.issuedAt ?? inv.createdAt).toISOString(),
        docType: isCredit ? "Πιστωτικό" : "Τιμολόγιο",
        number: inv.number,
        description: isCredit ? "Πιστωτικό πώλησης" : "Χρέωση πελάτη",
        debit: isCredit ? 0 : total,
        credit: isCredit ? total : 0,
        refId: inv.id,
      },
    });
  }
  for (const s of settlements) {
    events.push({
      at: s.settledAt,
      sort: 1,
      line: {
        at: s.settledAt.toISOString(),
        docType: "Είσπραξη",
        number: s.number,
        description: "Εξόφληση / είσπραξη",
        debit: 0,
        credit: toNumber(s.totalAmount),
        refId: s.id,
      },
    });
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.sort - b.sort);
  let running = 0;
  const lines: PartyCardLine[] = events.map((e) => {
    running = round2(running + e.line.debit - e.line.credit);
    return { ...e.line, balance: running };
  });

  return {
    party: customer,
    partyType: "CUSTOMER" as const,
    lines,
    balance: running,
  };
}

/** Φ5 — Καρτέλα προμηθευτή (AP) */
export async function loadSupplierCard(
  db: Db,
  tenantId: string,
  supplierId: string,
  opts?: { from?: Date | null; to?: Date | null; legalEntityId?: string | null },
) {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, tenantId },
    select: { id: true, code: true, name: true },
  });
  if (!supplier) return null;

  const invoices = await db.purchaseInvoice.findMany({
    where: {
      tenantId,
      supplierId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(opts?.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
      ...(opts?.from || opts?.to
        ? {
            issueDate: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      number: true,
      total: true,
      issueDate: true,
    },
    orderBy: { issueDate: "asc" },
  });

  const settlements = await db.settlement.findMany({
    where: {
      tenantId,
      supplierId,
      kind: "PAYMENT",
      status: "POSTED",
      ...(opts?.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
      ...(opts?.from || opts?.to
        ? {
            settledAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      number: true,
      totalAmount: true,
      settledAt: true,
    },
    orderBy: { settledAt: "asc" },
  });

  type Ev = { at: Date; sort: number; line: Omit<PartyCardLine, "balance"> };
  const events: Ev[] = [];
  for (const inv of invoices) {
    events.push({
      at: inv.issueDate,
      sort: 0,
      line: {
        at: inv.issueDate.toISOString(),
        docType: "Τιμ. αγοράς",
        number: inv.number,
        description: "Χρέωση προμηθευτή",
        debit: 0,
        credit: toNumber(inv.total),
        refId: inv.id,
      },
    });
  }
  for (const s of settlements) {
    events.push({
      at: s.settledAt,
      sort: 1,
      line: {
        at: s.settledAt.toISOString(),
        docType: "Πληρωμή",
        number: s.number,
        description: "Εξόφληση προμηθευτή",
        debit: toNumber(s.totalAmount),
        credit: 0,
        refId: s.id,
      },
    });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.sort - b.sort);
  let running = 0;
  const lines: PartyCardLine[] = events.map((e) => {
    // AP balance = credit − debit (amount owed)
    running = round2(running + e.line.credit - e.line.debit);
    return { ...e.line, balance: running };
  });

  return {
    party: supplier,
    partyType: "SUPPLIER" as const,
    lines,
    balance: running,
  };
}

export type OpeningBalanceLine = {
  glAccountCode: string;
  debit?: number;
  credit?: number;
  memo?: string | null;
};

/** Φ5 — Wizard υπολοίπων έναρξης → opening journal */
export async function postOpeningBalances(
  db: Db,
  input: {
    tenantId: string;
    legalEntityId?: string | null;
    entryDate?: Date | null;
    description?: string | null;
    userId?: string | null;
    lines: OpeningBalanceLine[];
  },
) {
  await ensureChartOfAccounts(db, input.tenantId);

  const journalLines: Array<{
    glAccountId: string;
    debit: number;
    credit: number;
    memo: string | null;
    legalEntityId: string | null;
  }> = [];

  for (const l of input.lines) {
    const acc = await findAccountByCode(db, input.tenantId, l.glAccountCode);
    if (!acc) {
      throw new Error(`Λογαριασμός ${l.glAccountCode} δεν βρέθηκε`);
    }
    const debit = round2(Math.max(0, l.debit ?? 0));
    const credit = round2(Math.max(0, l.credit ?? 0));
    if (debit <= 0 && credit <= 0) continue;
    journalLines.push({
      glAccountId: acc.id,
      debit,
      credit,
      memo: l.memo ?? "Υπόλοιπο έναρξης",
      legalEntityId: input.legalEntityId ?? null,
    });
  }

  if (journalLines.length < 2) {
    throw new Error("Απαιτούνται τουλάχιστον 2 γραμμές");
  }

  return createAndPostJournal(db, {
    tenantId: input.tenantId,
    description: input.description ?? "Υπόλοιπα έναρξης",
    sourceType: "opening.wizard",
    sourceId: `ob-${Date.now()}`,
    createdByUserId: input.userId,
    entryDate: input.entryDate ?? new Date(),
    isOpening: true,
    legalEntityId: input.legalEntityId,
    lines: journalLines,
  });
}

export type CashbookMethodRow = {
  methodCode: string;
  receipts: number;
  payments: number;
  net: number;
  count: number;
};

/** Ταμείο / τρόποι εξόφλησης από Settlement Method Lines. */
export async function loadCashbook(
  db: Db,
  tenantId: string,
  opts: { from: Date; to: Date; legalEntityId?: string | null },
) {
  const settlements = await db.settlement.findMany({
    where: {
      tenantId,
      status: "POSTED",
      settledAt: { gte: opts.from, lte: opts.to },
      ...(opts.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
    },
    select: {
      kind: true,
      methods: { select: { methodCode: true, amount: true } },
    },
  });

  const map = new Map<string, CashbookMethodRow>();
  let receiptTotal = 0;
  let paymentTotal = 0;

  for (const s of settlements) {
    const sign = s.kind === "PAYMENT" ? -1 : 1;
    for (const m of s.methods) {
      const code = m.methodCode || "OTHER";
      const amt = toNumber(m.amount);
      const row = map.get(code) ?? {
        methodCode: code,
        receipts: 0,
        payments: 0,
        net: 0,
        count: 0,
      };
      if (sign > 0) {
        row.receipts = round2(row.receipts + amt);
        receiptTotal = round2(receiptTotal + amt);
      } else {
        row.payments = round2(row.payments + amt);
        paymentTotal = round2(paymentTotal + amt);
      }
      row.net = round2(row.receipts - row.payments);
      row.count += 1;
      map.set(code, row);
    }
  }

  const rows = [...map.values()].sort((a, b) =>
    a.methodCode.localeCompare(b.methodCode, "el"),
  );

  return {
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    receiptTotal,
    paymentTotal,
    netTotal: round2(receiptTotal - paymentTotal),
    settlementCount: settlements.length,
    rows,
  };
}
