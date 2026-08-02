import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  createAndPostJournal,
  findAccountByCode,
  LedgerError,
} from "@/modules/ledger/service";
import { resolveSeriesPaymentMethods } from "@/modules/documents/series-payments";
import {
  roundMoney,
  statusAfterPayment,
  toNumber,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";
import type {
  CreateClearingSettlementInput,
  CreatePaymentSettlementInput,
  CreateReceiptSettlementInput,
} from "./schemas";

type Db = PrismaClient | Prisma.TransactionClient;

export class SettlementError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "SettlementError";
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function nextSettlementNumber(db: Db, tenantId: string, kind: string) {
  const year = new Date().getFullYear();
  const prefix =
    kind === "PAYMENT"
      ? `ΕΞΠ-${year}-`
      : kind === "CLEARING"
        ? `ΕΚΚ-${year}-`
        : `ΕΙΣ-${year}-`;
  const latest = await db.settlement.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const seq = latest
    ? Number(latest.number.slice(prefix.length)) + 1 || 1
    : 1;
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

/** externalRef on CLEARING method lines points back to source method line */
function clearingRef(methodLineId: string) {
  return `clr:${methodLineId}`;
}

type ResolvedMethod = {
  paymentMethodId: string | null;
  methodCode: string;
  amount: number;
  changeAmount: number;
  externalRef: string | null;
  giftCardId: string | null;
  loyaltyAccountId: string | null;
  glCashCode: string;
  glClearingCode: string | null;
  usesClearing: boolean;
};

async function resolveMethods(
  db: Db,
  input: {
    tenantId: string;
    seriesId: string | null;
    methods: CreateReceiptSettlementInput["methods"];
    allowMultiTender: boolean;
    clearingMode: string;
  },
): Promise<ResolvedMethod[]> {
  const allowed = await resolveSeriesPaymentMethods(db, {
    tenantId: input.tenantId,
    seriesId: input.seriesId,
    collectOnly: true,
    activeOnly: true,
  });
  if (allowed.length === 0) {
    throw new SettlementError("Δεν υπάρχουν διαθέσιμοι τρόποι πληρωμής", 400);
  }
  if (!input.allowMultiTender && input.methods.length > 1) {
    throw new SettlementError(
      "Η σειρά δεν επιτρέπει πολλαπλούς τρόπους πληρωμής",
      400,
    );
  }

  const resolved: ResolvedMethod[] = [];
  for (const m of input.methods) {
    const method =
      allowed.find((a) => a.id === m.paymentMethodId) ??
      allowed.find((a) => a.code === m.method) ??
      null;
    if (!method) {
      throw new SettlementError(
        `Ο τρόπος πληρωμής δεν επιτρέπεται για αυτή τη σειρά`,
        400,
      );
    }
    const pm = await db.paymentMethod.findFirst({
      where: { id: method.id, tenantId: input.tenantId },
      select: {
        glAccount: true,
        glClearingAccount: true,
        kind: true,
      },
    });
    const useClearing =
      input.clearingMode === "CLEARING" &&
      Boolean(pm?.glClearingAccount) &&
      (pm?.kind === "CARD" || Boolean(pm?.glClearingAccount));
    resolved.push({
      paymentMethodId: method.id,
      methodCode: method.code,
      amount: round2(m.amount),
      changeAmount: round2(m.changeAmount ?? 0),
      externalRef: m.externalRef ?? null,
      giftCardId: m.giftCardId ?? null,
      loyaltyAccountId: m.loyaltyAccountId ?? null,
      glCashCode: pm?.glAccount || "38.00.00",
      glClearingCode: pm?.glClearingAccount ?? null,
      usesClearing: useClearing,
    });
  }
  return resolved;
}

async function postSettlementJournal(
  db: Db,
  input: {
    tenantId: string;
    legalEntityId: string | null;
    settlementId: string;
    number: string;
    kind: "RECEIPT" | "PAYMENT";
    methods: ResolvedMethod[];
    arOrApCode: string;
    userId?: string | null;
  },
) {
  const party = await findAccountByCode(
    db,
    input.tenantId,
    input.arOrApCode,
  );
  if (!party) return null;

  const lines: Array<{
    glAccountId: string;
    debit?: number;
    credit?: number;
    memo?: string;
    legalEntityId?: string | null;
  }> = [];

  for (const m of input.methods) {
    const code = m.usesClearing
      ? m.glClearingCode || m.glCashCode
      : m.glCashCode;
    const acc = await findAccountByCode(db, input.tenantId, code);
    if (!acc) continue;
    const net = round2(m.amount - m.changeAmount);
    if (input.kind === "RECEIPT") {
      lines.push({
        glAccountId: acc.id,
        debit: net,
        memo: m.usesClearing ? `Εκκαθάριση ${m.methodCode}` : m.methodCode,
        legalEntityId: input.legalEntityId,
      });
    } else {
      lines.push({
        glAccountId: acc.id,
        credit: net,
        memo: m.methodCode,
        legalEntityId: input.legalEntityId,
      });
    }
  }

  const total = round2(
    input.methods.reduce((s, m) => s + m.amount - m.changeAmount, 0),
  );
  if (input.kind === "RECEIPT") {
    lines.push({
      glAccountId: party.id,
      credit: total,
      memo: "Πελάτες",
      legalEntityId: input.legalEntityId,
    });
  } else {
    lines.push({
      glAccountId: party.id,
      debit: total,
      memo: "Προμηθευτές",
      legalEntityId: input.legalEntityId,
    });
  }

  if (lines.length < 2) return null;

  try {
    return await createAndPostJournal(db, {
      tenantId: input.tenantId,
      description:
        input.kind === "RECEIPT"
          ? `Είσπραξη ${input.number}`
          : `Πληρωμή ${input.number}`,
      sourceType:
        input.kind === "RECEIPT" ? "settlement.receipt" : "settlement.payment",
      sourceId: input.settlementId,
      createdByUserId: input.userId,
      legalEntityId: input.legalEntityId,
      lines,
    });
  } catch (e) {
    if (e instanceof LedgerError) return null;
    throw e;
  }
}

/** Φ1 — AR receipt settlement (ολική/μερική/πολλαπλοί τρόποι/σύνθετη) */
export async function createReceiptSettlement(
  db: PrismaClient,
  input: {
    tenantId: string;
    userId?: string | null;
    legalEntityId?: string | null;
    data: CreateReceiptSettlementInput;
  },
) {
  const allocations =
    input.data.allocations && input.data.allocations.length > 0
      ? input.data.allocations
      : input.data.invoiceId
        ? [
            {
              targetType: "INVOICE" as const,
              invoiceId: input.data.invoiceId,
              purchaseInvoiceId: null,
              amount: round2(
                input.data.methods.reduce((s, m) => s + m.amount, 0),
              ),
            },
          ]
        : [];

  if (allocations.length === 0) {
    throw new SettlementError("Απαιτείται τουλάχιστον ένα παραστατικό", 400);
  }

  const invoiceIds = allocations
    .map((a) => a.invoiceId)
    .filter((id): id is string => Boolean(id));
  const invoices = await db.invoice.findMany({
    where: {
      tenantId: input.tenantId,
      id: { in: invoiceIds },
      ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
    },
    include: {
      series: {
        select: {
          id: true,
          glDebitAccount: true,
          allowPartialSettlement: true,
          allowMultiTender: true,
          allowMultiDocumentSettlement: true,
          allowOnAccount: true,
          settlementClearingMode: true,
        },
      },
    },
  });
  if (invoices.length !== invoiceIds.length) {
    throw new SettlementError("Παραστατικό δεν βρέθηκε", 404);
  }

  const series = invoices[0]!.series;
  if (
    !series?.allowMultiDocumentSettlement &&
    allocations.length > 1
  ) {
    throw new SettlementError(
      "Η σειρά δεν επιτρέπει εξόφληση πολλών παραστατικών",
      400,
    );
  }

  const customerId =
    input.data.customerId || invoices[0]!.customerId;
  if (invoices.some((i) => i.customerId !== customerId)) {
    throw new SettlementError(
      "Όλα τα παραστατικά πρέπει να ανήκουν στον ίδιο πελάτη",
      400,
    );
  }

  for (const inv of invoices) {
    const st = inv.status as InvoiceStatusKey;
    if (st === "DRAFT" || st === "CANCELLED" || st === "PAID") {
      throw new SettlementError(
        `Το ${inv.number} δεν δέχεται είσπραξη (${st})`,
        400,
      );
    }
  }

  const methodTotal = round2(
    input.data.methods.reduce((s, m) => s + m.amount, 0),
  );
  const allocTotal = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (Math.abs(methodTotal - allocTotal) > 0.01) {
    throw new SettlementError(
      `Άθροισμα τρόπων (${methodTotal.toFixed(2)}) ≠ κατανομές (${allocTotal.toFixed(2)})`,
      400,
    );
  }

  for (const a of allocations) {
    const inv = invoices.find((i) => i.id === a.invoiceId)!;
    const balance = round2(toNumber(inv.total) - toNumber(inv.paidAmount));
    if (a.amount > balance + 0.001) {
      throw new SettlementError(
        `Ποσό υπερβαίνει υπόλοιπο ${inv.number} (${balance.toFixed(2)})`,
        400,
      );
    }
    if (
      !series?.allowPartialSettlement &&
      a.amount + 0.001 < balance
    ) {
      throw new SettlementError(
        "Η σειρά απαιτεί ολική εξόφληση",
        400,
      );
    }
  }

  const legalEntityId =
    input.data.legalEntityId ||
    input.legalEntityId ||
    invoices[0]!.legalEntityId;

  const resolvedMethods = await resolveMethods(db, {
    tenantId: input.tenantId,
    seriesId: series?.id ?? invoices[0]!.seriesId,
    methods: input.data.methods,
    allowMultiTender: series?.allowMultiTender ?? true,
    clearingMode: series?.settlementClearingMode ?? "IMMEDIATE",
  });

  const number = await nextSettlementNumber(db, input.tenantId, "RECEIPT");
  const settledAt = input.data.settledAt
    ? new Date(input.data.settledAt)
    : new Date();

  const settlement = await db.$transaction(async (tx) => {
    const row = await tx.settlement.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId,
        number,
        kind: "RECEIPT",
        status: "POSTED",
        partyType: "CUSTOMER",
        customerId,
        currency: "EUR",
        totalAmount: methodTotal,
        settledAt,
        reference: input.data.reference ?? null,
        notes: input.data.notes ?? null,
        createdByUserId: input.userId ?? null,
        allocations: {
          create: allocations.map((a) => ({
            tenantId: input.tenantId,
            targetType:
              invoices.find((i) => i.id === a.invoiceId)?.kind === "SALES_CREDIT"
                ? "CREDIT_NOTE"
                : "INVOICE",
            invoiceId: a.invoiceId!,
            amount: a.amount,
          })),
        },
        methods: {
          create: resolvedMethods.map((m) => ({
            tenantId: input.tenantId,
            paymentMethodId: m.paymentMethodId,
            methodCode: m.methodCode,
            amount: m.amount,
            changeAmount: m.changeAmount,
            externalRef: m.externalRef,
            giftCardId: m.giftCardId,
            loyaltyAccountId: m.loyaltyAccountId,
            usesClearing: m.usesClearing,
          })),
        },
      },
      include: {
        allocations: true,
        methods: true,
      },
    });

    for (const a of allocations) {
      const inv = invoices.find((i) => i.id === a.invoiceId)!;
      const paidAmount = roundMoney(toNumber(inv.paidAmount) + a.amount);
      const nextStatus = statusAfterPayment(
        inv.status as InvoiceStatusKey,
        paidAmount,
        toNumber(inv.total),
      );
      await tx.invoice.update({
        where: { id: inv.id },
        data: { paidAmount, status: nextStatus },
      });
      // Keep InvoicePayment rows for compatibility / POS / history
      const shareMethods = resolvedMethods;
      const primary = shareMethods[0]!;
      await tx.invoicePayment.create({
        data: {
          tenantId: input.tenantId,
          invoiceId: inv.id,
          settlementId: row.id,
          amount: a.amount,
          method: primary.methodCode,
          paymentMethodId: primary.paymentMethodId,
          note: input.data.notes ?? null,
          changeAmount: primary.changeAmount,
          externalRef: primary.externalRef,
          giftCardId: primary.giftCardId,
          loyaltyAccountId: primary.loyaltyAccountId,
          paidAt: settledAt,
        },
      });
    }

    return row;
  });

  let journalId: string | null = null;
  try {
    const journal = await postSettlementJournal(db, {
      tenantId: input.tenantId,
      legalEntityId,
      settlementId: settlement.id,
      number: settlement.number,
      kind: "RECEIPT",
      methods: resolvedMethods,
      arOrApCode: series?.glDebitAccount || "30.00.00",
      userId: input.userId,
    });
    journalId = journal?.id ?? null;
    if (journalId) {
      await db.settlement.update({
        where: { id: settlement.id },
        data: { journalEntryId: journalId },
      });
    }
  } catch {
    journalId = null;
  }

  return { settlement, journalId };
}

/** Φ3 — AP payment settlement against purchase invoices */
export async function createPaymentSettlement(
  db: PrismaClient,
  input: {
    tenantId: string;
    userId?: string | null;
    legalEntityId?: string | null;
    data: CreatePaymentSettlementInput;
  },
) {
  const allocations =
    input.data.allocations && input.data.allocations.length > 0
      ? input.data.allocations
      : input.data.purchaseInvoiceId
        ? [
            {
              targetType: "PURCHASE_INVOICE" as const,
              invoiceId: null,
              purchaseInvoiceId: input.data.purchaseInvoiceId,
              amount: round2(
                input.data.methods.reduce((s, m) => s + m.amount, 0),
              ),
            },
          ]
        : [];

  if (allocations.length === 0) {
    throw new SettlementError("Απαιτείται τιμολόγιο αγοράς", 400);
  }

  const piIds = allocations
    .map((a) => a.purchaseInvoiceId)
    .filter((id): id is string => Boolean(id));
  const pis = await db.purchaseInvoice.findMany({
    where: {
      tenantId: input.tenantId,
      id: { in: piIds },
      supplierId: input.data.supplierId,
    },
  });
  if (pis.length !== piIds.length) {
    throw new SettlementError("Τιμολόγιο αγοράς δεν βρέθηκε", 404);
  }

  for (const pi of pis) {
    if (pi.status === "DRAFT" || pi.status === "CANCELLED" || pi.status === "PAID") {
      throw new SettlementError(
        `Το ${pi.number} δεν δέχεται πληρωμή (${pi.status})`,
        400,
      );
    }
  }

  const methodTotal = round2(
    input.data.methods.reduce((s, m) => s + m.amount, 0),
  );
  const allocTotal = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (Math.abs(methodTotal - allocTotal) > 0.01) {
    throw new SettlementError(
      `Άθροισμα τρόπων ≠ κατανομής`,
      400,
    );
  }

  for (const a of allocations) {
    const pi = pis.find((p) => p.id === a.purchaseInvoiceId)!;
    const balance = round2(toNumber(pi.total) - toNumber(pi.paidAmount));
    if (a.amount > balance + 0.001) {
      throw new SettlementError(
        `Ποσό υπερβαίνει υπόλοιπο ${pi.number}`,
        400,
      );
    }
  }

  const legalEntityId =
    input.data.legalEntityId ||
    input.legalEntityId ||
    pis[0]!.legalEntityId;

  // AP: allow all active collect/payment methods (showInCollect)
  const resolvedMethods = await resolveMethods(db, {
    tenantId: input.tenantId,
    seriesId: null,
    methods: input.data.methods,
    allowMultiTender: true,
    clearingMode: "IMMEDIATE",
  });

  const number = await nextSettlementNumber(db, input.tenantId, "PAYMENT");
  const settledAt = input.data.settledAt
    ? new Date(input.data.settledAt)
    : new Date();

  const settlement = await db.$transaction(async (tx) => {
    const row = await tx.settlement.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId,
        number,
        kind: "PAYMENT",
        status: "POSTED",
        partyType: "SUPPLIER",
        supplierId: input.data.supplierId,
        currency: "EUR",
        totalAmount: methodTotal,
        settledAt,
        reference: input.data.reference ?? null,
        notes: input.data.notes ?? null,
        createdByUserId: input.userId ?? null,
        allocations: {
          create: allocations.map((a) => ({
            tenantId: input.tenantId,
            targetType: "PURCHASE_INVOICE",
            purchaseInvoiceId: a.purchaseInvoiceId!,
            amount: a.amount,
          })),
        },
        methods: {
          create: resolvedMethods.map((m) => ({
            tenantId: input.tenantId,
            paymentMethodId: m.paymentMethodId,
            methodCode: m.methodCode,
            amount: m.amount,
            changeAmount: m.changeAmount,
            externalRef: m.externalRef,
            usesClearing: m.usesClearing,
          })),
        },
      },
      include: { allocations: true, methods: true },
    });

    for (const a of allocations) {
      const pi = pis.find((p) => p.id === a.purchaseInvoiceId)!;
      const paidAmount = roundMoney(toNumber(pi.paidAmount) + a.amount);
      const total = toNumber(pi.total);
      const status =
        paidAmount + 0.001 >= total
          ? "PAID"
          : paidAmount > 0
            ? "PARTIAL"
            : pi.status === "POSTED"
              ? "POSTED"
              : pi.status;
      await tx.purchaseInvoice.update({
        where: { id: pi.id },
        data: { paidAmount, status },
      });
    }

    // Legacy PurchasePayment row for supplier history
    const primary = resolvedMethods[0]!;
    await tx.purchasePayment.create({
      data: {
        tenantId: input.tenantId,
        supplierId: input.data.supplierId,
        amount: methodTotal,
        method: primary.methodCode,
        reference: input.data.reference ?? null,
        notes: input.data.notes ?? null,
        paidAt: settledAt,
      },
    });

    return row;
  });

  let journalId: string | null = null;
  try {
    const journal = await postSettlementJournal(db, {
      tenantId: input.tenantId,
      legalEntityId,
      settlementId: settlement.id,
      number: settlement.number,
      kind: "PAYMENT",
      methods: resolvedMethods,
      arOrApCode: "50.00.00",
      userId: input.userId,
    });
    journalId = journal?.id ?? null;
    if (journalId) {
      await db.settlement.update({
        where: { id: settlement.id },
        data: { journalEntryId: journalId },
      });
    }
  } catch {
    journalId = null;
  }

  return { settlement, journalId };
}

/** Φ4 — void settlement + unwind balances + reverse journal */
export async function voidSettlement(
  db: PrismaClient,
  input: {
    tenantId: string;
    id: string;
    userId?: string | null;
  },
) {
  const settlement = await db.settlement.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
    include: { allocations: true, methods: true },
  });
  if (!settlement) throw new SettlementError("Η εξόφληση δεν βρέθηκε", 404);
  if (settlement.status === "VOIDED") {
    throw new SettlementError("Ήδη ακυρωμένη", 400);
  }

  await db.$transaction(async (tx) => {
    // Φ4 — void CLEARING: ξεκλείδωμα πηγών (clearingJournalId)
    if (settlement.kind === "CLEARING" && settlement.journalEntryId) {
      await tx.settlement.updateMany({
        where: {
          tenantId: input.tenantId,
          clearingJournalId: settlement.journalEntryId,
        },
        data: { clearingJournalId: null },
      });
    }

    for (const a of settlement.allocations) {
      if (a.invoiceId) {
        const inv = await tx.invoice.findFirst({
          where: { id: a.invoiceId, tenantId: input.tenantId },
        });
        if (!inv) continue;
        const paidAmount = roundMoney(
          Math.max(0, toNumber(inv.paidAmount) - toNumber(a.amount)),
        );
        const total = toNumber(inv.total);
        let status: InvoiceStatusKey = inv.status as InvoiceStatusKey;
        if (status !== "CANCELLED" && status !== "DRAFT") {
          if (paidAmount <= 0.001) status = "ISSUED";
          else if (paidAmount + 0.001 < total) status = "PARTIAL";
          else status = "PAID";
        }
        await tx.invoice.update({
          where: { id: inv.id },
          data: { paidAmount, status },
        });
      }
      if (a.purchaseInvoiceId) {
        const pi = await tx.purchaseInvoice.findFirst({
          where: { id: a.purchaseInvoiceId, tenantId: input.tenantId },
        });
        if (!pi) continue;
        const paidAmount = roundMoney(
          Math.max(0, toNumber(pi.paidAmount) - toNumber(a.amount)),
        );
        const total = toNumber(pi.total);
        const status =
          paidAmount <= 0.001
            ? "POSTED"
            : paidAmount + 0.001 < total
              ? "PARTIAL"
              : "PAID";
        await tx.purchaseInvoice.update({
          where: { id: pi.id },
          data: { paidAmount, status },
        });
      }
    }

    await tx.invoicePayment.deleteMany({
      where: { settlementId: settlement.id, tenantId: input.tenantId },
    });

    await tx.settlement.update({
      where: { id: settlement.id },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedByUserId: input.userId ?? null,
      },
    });
  });

  // Reverse GL if present
  if (settlement.journalEntryId) {
    try {
      const { reverseJournal } = await import("@/modules/ledger/service");
      await reverseJournal(db, {
        tenantId: input.tenantId,
        journalId: settlement.journalEntryId,
        createdByUserId: input.userId,
        description: `Ακύρωση εξόφλησης ${settlement.number}`,
      });
    } catch {
      // best-effort
    }
  }

  return db.settlement.findFirstOrThrow({
    where: { id: settlement.id },
    include: { allocations: true, methods: true },
  });
}

/**
 * Φ4 — βήμα 2 εκκαθάρισης: μεταφορά από glClearingAccount → τράπεζα/ταμείο.
 * Οι γραμμές τρόπου με usesClearing=true παραμένουν ανοιχτές μέχρι να εκκαθαριστούν.
 */
export async function listPendingClearing(
  db: Db,
  tenantId: string,
  opts?: { legalEntityId?: string | null },
) {
  const methods = await db.settlementMethodLine.findMany({
    where: {
      tenantId,
      usesClearing: true,
      settlement: {
        tenantId,
        status: "POSTED",
        kind: "RECEIPT",
        ...(opts?.legalEntityId
          ? { legalEntityId: opts.legalEntityId }
          : {}),
      },
    },
    include: {
      settlement: {
        select: {
          id: true,
          number: true,
          settledAt: true,
          legalEntityId: true,
          customer: { select: { id: true, name: true, code: true } },
        },
      },
      paymentMethod: {
        select: {
          id: true,
          code: true,
          name: true,
          glAccount: true,
          glClearingAccount: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const refs = methods.map((m) => clearingRef(m.id));
  const already = refs.length
    ? await db.settlementMethodLine.findMany({
        where: {
          tenantId,
          externalRef: { in: refs },
          settlement: { kind: "CLEARING", status: "POSTED" },
        },
        select: { externalRef: true },
      })
    : [];
  const cleared = new Set(already.map((a) => a.externalRef).filter(Boolean));

  return methods
    .filter((m) => !cleared.has(clearingRef(m.id)))
    .map((m) => ({
      id: m.id,
      settlementId: m.settlementId,
      settlementNumber: m.settlement.number,
      settledAt: m.settlement.settledAt.toISOString(),
      legalEntityId: m.settlement.legalEntityId,
      customer: m.settlement.customer,
      methodCode: m.methodCode,
      paymentMethodId: m.paymentMethodId,
      amount: round2(toNumber(m.amount) - toNumber(m.changeAmount)),
      clearingGl: m.paymentMethod?.glClearingAccount || "33.90.01",
      bankGl: m.paymentMethod?.glAccount || "38.03.00",
    }));
}

export async function createClearingSettlement(
  db: PrismaClient,
  input: {
    tenantId: string;
    userId?: string | null;
    legalEntityId?: string | null;
    data: CreateClearingSettlementInput;
  },
) {
  const pending = await listPendingClearing(db, input.tenantId, {
    legalEntityId: input.legalEntityId ?? input.data.legalEntityId,
  });
  const selected = pending.filter((p) =>
    input.data.sourceMethodLineIds.includes(p.id),
  );
  if (selected.length !== input.data.sourceMethodLineIds.length) {
    throw new SettlementError(
      "Κάποιες γραμμές δεν είναι ανοιχτές για εκκαθάριση",
      400,
    );
  }
  if (selected.length === 0) {
    throw new SettlementError("Δεν επιλέχθηκαν γραμμές εκκαθάρισης", 400);
  }

  let bankCode = input.data.bankGlAccount || selected[0]!.bankGl;
  if (input.data.paymentMethodId) {
    const pm = await db.paymentMethod.findFirst({
      where: { id: input.data.paymentMethodId, tenantId: input.tenantId },
      select: { glAccount: true },
    });
    if (pm?.glAccount) bankCode = pm.glAccount;
  }

  const total = round2(selected.reduce((s, m) => s + m.amount, 0));
  const number = await nextSettlementNumber(db, input.tenantId, "CLEARING");
  const settledAt = input.data.settledAt
    ? new Date(input.data.settledAt)
    : new Date();
  const legalEntityId =
    input.data.legalEntityId ||
    input.legalEntityId ||
    selected[0]!.legalEntityId;

  const settlement = await db.settlement.create({
    data: {
      tenantId: input.tenantId,
      legalEntityId,
      number,
      kind: "CLEARING",
      status: "POSTED",
      partyType: "CUSTOMER",
      customerId: selected[0]!.customer?.id ?? null,
      currency: "EUR",
      totalAmount: total,
      settledAt,
      reference: input.data.reference ?? selected.map((s) => s.settlementNumber).join(", "),
      notes: input.data.notes ?? "Εκκαθάριση καρτών (βήμα 2)",
      createdByUserId: input.userId ?? null,
      methods: {
        create: selected.map((m) => ({
          tenantId: input.tenantId,
          paymentMethodId: m.paymentMethodId,
          methodCode: m.methodCode,
          amount: m.amount,
          changeAmount: 0,
          externalRef: clearingRef(m.id),
          usesClearing: false,
        })),
      },
    },
    include: { allocations: true, methods: true },
  });

  let journalId: string | null = null;
  try {
    const bank = await findAccountByCode(db, input.tenantId, bankCode);
    // Group by clearing GL in case multiple schemes
    const byClearing = new Map<string, number>();
    for (const m of selected) {
      byClearing.set(
        m.clearingGl,
        round2((byClearing.get(m.clearingGl) ?? 0) + m.amount),
      );
    }
    const lines: Array<{
      glAccountId: string;
      debit?: number;
      credit?: number;
      memo?: string;
      legalEntityId?: string | null;
    }> = [];
    if (bank) {
      lines.push({
        glAccountId: bank.id,
        debit: total,
        memo: "Εκκαθάριση → τράπεζα",
        legalEntityId,
      });
    }
    for (const [code, amt] of byClearing) {
      const clr = await findAccountByCode(db, input.tenantId, code);
      if (!clr) continue;
      lines.push({
        glAccountId: clr.id,
        credit: amt,
        memo: `Εκκαθάριση ${code}`,
        legalEntityId,
      });
    }
    if (lines.length >= 2) {
      const journal = await createAndPostJournal(db, {
        tenantId: input.tenantId,
        description: `Εκκαθάριση ${number}`,
        sourceType: "settlement.clearing",
        sourceId: settlement.id,
        createdByUserId: input.userId,
        legalEntityId,
        lines,
      });
      journalId = journal.id;
      await db.settlement.update({
        where: { id: settlement.id },
        data: { journalEntryId: journalId },
      });
      // Mark source settlements when fully cleared
      const sourceIds = [...new Set(selected.map((s) => s.settlementId))];
      for (const sid of sourceIds) {
        const still = (await listPendingClearing(db, input.tenantId)).filter(
          (p) => p.settlementId === sid,
        );
        if (still.length === 0) {
          await db.settlement.update({
            where: { id: sid },
            data: { clearingJournalId: journalId },
          });
        }
      }
    }
  } catch (e) {
    if (!(e instanceof LedgerError)) throw e;
  }

  return { settlement, journalId };
}

export async function listSettlements(
  db: Db,
  tenantId: string,
  opts?: {
    kind?: "RECEIPT" | "PAYMENT" | "CLEARING";
    legalEntityId?: string | null;
    take?: number;
  },
) {
  return db.settlement.findMany({
    where: {
      tenantId,
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
    },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      supplier: { select: { id: true, name: true, code: true } },
      allocations: true,
      methods: true,
    },
    orderBy: [{ settledAt: "desc" }, { createdAt: "desc" }],
    take: opts?.take ?? 100,
  });
}

export function serializeSettlement(
  s: Awaited<ReturnType<typeof listSettlements>>[number],
) {
  return {
    id: s.id,
    number: s.number,
    kind: s.kind,
    status: s.status,
    partyType: s.partyType,
    customerId: s.customerId,
    supplierId: s.supplierId,
    customer: s.customer,
    supplier: s.supplier,
    legalEntityId: s.legalEntityId,
    totalAmount: toNumber(s.totalAmount),
    settledAt: s.settledAt.toISOString(),
    reference: s.reference,
    notes: s.notes,
    journalEntryId: s.journalEntryId,
    voidedAt: s.voidedAt?.toISOString() ?? null,
    allocations: s.allocations.map((a) => ({
      id: a.id,
      targetType: a.targetType,
      invoiceId: a.invoiceId,
      purchaseInvoiceId: a.purchaseInvoiceId,
      amount: toNumber(a.amount),
    })),
    methods: s.methods.map((m) => ({
      id: m.id,
      paymentMethodId: m.paymentMethodId,
      methodCode: m.methodCode,
      amount: toNumber(m.amount),
      changeAmount: toNumber(m.changeAmount),
      usesClearing: m.usesClearing,
      externalRef: m.externalRef,
    })),
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * Φ4 — POS checkout: create Settlement from already-paid retail invoice
 * payments, then post issue + settlement journals (best-effort).
 */
export async function finalizePosCheckoutAccounting(
  db: PrismaClient,
  input: {
    tenantId: string;
    userId?: string | null;
    legalEntityId?: string | null;
    invoiceId: string;
  },
) {
  const invoice = await db.invoice.findFirst({
    where: { id: input.invoiceId, tenantId: input.tenantId },
    include: {
      series: {
        select: {
          glDebitAccount: true,
          glCreditAccount: true,
          glVatAccount: true,
          settlementClearingMode: true,
        },
      },
      payments: {
        orderBy: { paidAt: "asc" },
        include: {
          paymentMethod: {
            select: {
              id: true,
              code: true,
              glAccount: true,
              glClearingAccount: true,
              kind: true,
            },
          },
        },
      },
    },
  });
  if (!invoice || invoice.payments.length === 0) {
    return { settlementId: null, issueJournalId: null, settlementJournalId: null };
  }

  const existing = await db.settlement.findFirst({
    where: {
      tenantId: input.tenantId,
      kind: "RECEIPT",
      allocations: { some: { invoiceId: invoice.id } },
      status: "POSTED",
    },
    select: { id: true, journalEntryId: true },
  });
  if (existing) {
    return {
      settlementId: existing.id,
      issueJournalId: null,
      settlementJournalId: existing.journalEntryId,
    };
  }

  const clearingMode = invoice.series?.settlementClearingMode ?? "IMMEDIATE";
  const resolvedMethods: ResolvedMethod[] = invoice.payments.map((p) => {
    const pm = p.paymentMethod;
    const useClearing =
      clearingMode === "CLEARING" &&
      Boolean(pm?.glClearingAccount) &&
      (pm?.kind === "CARD" || Boolean(pm?.glClearingAccount));
    return {
      paymentMethodId: p.paymentMethodId,
      methodCode: p.method,
      amount: toNumber(p.amount),
      changeAmount: toNumber(p.changeAmount),
      externalRef: p.externalRef,
      giftCardId: p.giftCardId,
      loyaltyAccountId: p.loyaltyAccountId,
      glCashCode: pm?.glAccount || "38.00.00",
      glClearingCode: pm?.glClearingAccount ?? null,
      usesClearing: useClearing,
    };
  });
  const methodTotal = round2(
    resolvedMethods.reduce((s, m) => s + m.amount, 0),
  );
  const number = await nextSettlementNumber(db, input.tenantId, "RECEIPT");
  const legalEntityId =
    input.legalEntityId || invoice.legalEntityId || null;

  const settlement = await db.$transaction(async (tx) => {
    const row = await tx.settlement.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId,
        number,
        kind: "RECEIPT",
        status: "POSTED",
        partyType: "CUSTOMER",
        customerId: invoice.customerId,
        currency: "EUR",
        totalAmount: methodTotal,
        settledAt: invoice.issuedAt ?? new Date(),
        notes: invoice.notes,
        createdByUserId: input.userId ?? null,
        allocations: {
          create: [
            {
              tenantId: input.tenantId,
              targetType: "INVOICE",
              invoiceId: invoice.id,
              amount: methodTotal,
            },
          ],
        },
        methods: {
          create: resolvedMethods.map((m) => ({
            tenantId: input.tenantId,
            paymentMethodId: m.paymentMethodId,
            methodCode: m.methodCode,
            amount: m.amount,
            changeAmount: m.changeAmount,
            externalRef: m.externalRef,
            giftCardId: m.giftCardId,
            loyaltyAccountId: m.loyaltyAccountId,
            usesClearing: m.usesClearing,
          })),
        },
      },
    });
    await tx.invoicePayment.updateMany({
      where: { invoiceId: invoice.id, tenantId: input.tenantId },
      data: { settlementId: row.id },
    });
    return row;
  });

  let issueJournalId: string | null = null;
  let settlementJournalId: string | null = null;
  try {
    const { tryPostInvoiceIssue } = await import("@/modules/ledger/service");
    const issue = await tryPostInvoiceIssue(db, {
      tenantId: input.tenantId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      total: toNumber(invoice.total),
      vatAmount: toNumber(invoice.vatAmount),
      glDebitAccount: invoice.series?.glDebitAccount,
      glCreditAccount: invoice.series?.glCreditAccount,
      glVatAccount: invoice.series?.glVatAccount,
      userId: input.userId,
      legalEntityId,
    });
    issueJournalId = issue?.id ?? null;
  } catch {
    issueJournalId = null;
  }

  try {
    const journal = await postSettlementJournal(db, {
      tenantId: input.tenantId,
      legalEntityId,
      settlementId: settlement.id,
      number: settlement.number,
      kind: "RECEIPT",
      methods: resolvedMethods,
      arOrApCode: invoice.series?.glDebitAccount || "30.00.00",
      userId: input.userId,
    });
    settlementJournalId = journal?.id ?? null;
    if (settlementJournalId) {
      await db.settlement.update({
        where: { id: settlement.id },
        data: { journalEntryId: settlementJournalId },
      });
    }
  } catch {
    settlementJournalId = null;
  }

  return {
    settlementId: settlement.id,
    issueJournalId,
    settlementJournalId,
  };
}
