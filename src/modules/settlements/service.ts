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

/** Pro-rate `amount` across weight parts; last bucket absorbs rounding drift. */
function distributeAmountAcross(weights: number[], amount: number): number[] {
  if (weights.length === 0) return [];
  const sum = round2(weights.reduce((s, w) => s + w, 0));
  if (sum <= 0) return weights.map(() => 0);
  const shares = weights.map((w) => round2((amount * w) / sum));
  const drift = round2(amount - shares.reduce((s, x) => s + x, 0));
  if (drift !== 0) {
    shares[shares.length - 1] = round2((shares[shares.length - 1] ?? 0) + drift);
  }
  return shares;
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

type SeriesSettlementPolicy = {
  allowPartialSettlement: boolean;
  allowOverpayment: boolean;
  allowMultiTender: boolean;
  maxTenderLines: number;
  allowMultiDocumentSettlement: boolean;
  allowCreditNoteOffset: boolean;
  allowOnAccount: boolean;
  allowWriteOff: boolean;
  writeOffMaxAmount: number;
  settlementTolerance: number;
  allowCashChange: boolean;
  allowGiftCardTender: boolean;
  allowLoyaltyTender: boolean;
  requireExternalRef: boolean;
  settlementClearingMode: string;
  settlementValueDateMode: string;
  autoPostSettlementJournal: boolean;
  allowVoidSettlement: boolean;
  allowBankMatch: boolean;
  glDebitAccount: string | null;
  id: string;
};

const SERIES_SETTLEMENT_SELECT = {
  id: true,
  glDebitAccount: true,
  allowPartialSettlement: true,
  allowOverpayment: true,
  allowMultiTender: true,
  maxTenderLines: true,
  allowMultiDocumentSettlement: true,
  allowCreditNoteOffset: true,
  allowOnAccount: true,
  allowWriteOff: true,
  writeOffMaxAmount: true,
  settlementTolerance: true,
  allowCashChange: true,
  allowGiftCardTender: true,
  allowLoyaltyTender: true,
  requireExternalRef: true,
  settlementClearingMode: true,
  settlementValueDateMode: true,
  autoPostSettlementJournal: true,
  allowVoidSettlement: true,
  allowBankMatch: true,
} as const;

function policyFromSeries(
  series: {
    id: string;
    glDebitAccount: string | null;
    allowPartialSettlement: boolean;
    allowOverpayment?: boolean;
    allowMultiTender: boolean;
    maxTenderLines?: number;
    allowMultiDocumentSettlement: boolean;
    allowCreditNoteOffset?: boolean;
    allowOnAccount: boolean;
    allowWriteOff?: boolean;
    writeOffMaxAmount?: unknown;
    settlementTolerance?: unknown;
    allowCashChange?: boolean;
    allowGiftCardTender?: boolean;
    allowLoyaltyTender?: boolean;
    requireExternalRef?: boolean;
    settlementClearingMode: string;
    settlementValueDateMode?: string;
    autoPostSettlementJournal?: boolean;
    allowVoidSettlement?: boolean;
    allowBankMatch?: boolean;
  } | null,
): SeriesSettlementPolicy {
  return {
    id: series?.id ?? "",
    glDebitAccount: series?.glDebitAccount ?? null,
    allowPartialSettlement: series?.allowPartialSettlement ?? true,
    allowOverpayment: series?.allowOverpayment ?? false,
    allowMultiTender: series?.allowMultiTender ?? true,
    maxTenderLines: series?.maxTenderLines ?? 10,
    allowMultiDocumentSettlement: series?.allowMultiDocumentSettlement ?? false,
    allowCreditNoteOffset: series?.allowCreditNoteOffset ?? true,
    allowOnAccount: series?.allowOnAccount ?? false,
    allowWriteOff: series?.allowWriteOff ?? false,
    writeOffMaxAmount: toNumber(series?.writeOffMaxAmount ?? 0),
    settlementTolerance: toNumber(series?.settlementTolerance ?? 0.01),
    allowCashChange: series?.allowCashChange ?? true,
    allowGiftCardTender: series?.allowGiftCardTender ?? true,
    allowLoyaltyTender: series?.allowLoyaltyTender ?? true,
    requireExternalRef: series?.requireExternalRef ?? false,
    settlementClearingMode: series?.settlementClearingMode ?? "IMMEDIATE",
    settlementValueDateMode: series?.settlementValueDateMode ?? "PAYMENT_DATE",
    autoPostSettlementJournal: series?.autoPostSettlementJournal ?? true,
    allowVoidSettlement: series?.allowVoidSettlement ?? true,
    allowBankMatch: series?.allowBankMatch ?? true,
  };
}

async function resolveMethods(
  db: Db,
  input: {
    tenantId: string;
    seriesId: string | null;
    methods: CreateReceiptSettlementInput["methods"];
    policy: SeriesSettlementPolicy;
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
  if (!input.policy.allowMultiTender && input.methods.length > 1) {
    throw new SettlementError(
      "Η σειρά δεν επιτρέπει πολλαπλούς τρόπους πληρωμής",
      400,
    );
  }
  if (input.methods.length > input.policy.maxTenderLines) {
    throw new SettlementError(
      `Μέγιστος αριθμός τρόπων: ${input.policy.maxTenderLines}`,
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
    const changeAmount = round2(m.changeAmount ?? 0);
    if (changeAmount > 0 && !input.policy.allowCashChange) {
      throw new SettlementError(
        "Η σειρά δεν επιτρέπει ρέστα μετρητών",
        400,
      );
    }
    if (m.giftCardId && !input.policy.allowGiftCardTender) {
      throw new SettlementError(
        "Η σειρά δεν επιτρέπει εξόφληση με δωροκάρτα",
        400,
      );
    }
    if (m.loyaltyAccountId && !input.policy.allowLoyaltyTender) {
      throw new SettlementError(
        "Η σειρά δεν επιτρέπει εξόφληση με πόντους loyalty",
        400,
      );
    }
    if (
      input.policy.requireExternalRef &&
      !String(m.externalRef ?? "").trim()
    ) {
      throw new SettlementError(
        `Απαιτείται αναφορά για τον τρόπο ${method.code}`,
        400,
      );
    }
    const useClearing =
      input.policy.settlementClearingMode === "CLEARING" &&
      Boolean(pm?.glClearingAccount) &&
      (pm?.kind === "CARD" || Boolean(pm?.glClearingAccount));
    resolved.push({
      paymentMethodId: method.id,
      methodCode: method.code,
      amount: round2(m.amount),
      changeAmount,
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
      series: { select: SERIES_SETTLEMENT_SELECT },
    },
  });
  if (invoices.length !== invoiceIds.length) {
    throw new SettlementError("Παραστατικό δεν βρέθηκε", 404);
  }

  const policy = policyFromSeries(invoices[0]?.series ?? null);
  if (!policy.allowMultiDocumentSettlement && allocations.length > 1) {
    throw new SettlementError(
      "Η σειρά δεν επιτρέπει εξόφληση πολλών παραστατικών",
      400,
    );
  }
  if (
    !policy.allowCreditNoteOffset &&
    allocations.some(
      (a) =>
        a.targetType === "CREDIT_NOTE" ||
        invoices.find((i) => i.id === a.invoiceId)?.kind === "SALES_CREDIT",
    )
  ) {
    throw new SettlementError(
      "Η σειρά δεν επιτρέπει συμψηφισμό πιστωτικών",
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
  const tol = policy.settlementTolerance;
  if (Math.abs(methodTotal - allocTotal) > tol + 0.0001) {
    throw new SettlementError(
      `Άθροισμα τρόπων (${methodTotal.toFixed(2)}) ≠ κατανομής (${allocTotal.toFixed(2)})`,
      400,
    );
  }

  for (const a of allocations) {
    if (a.targetType === "ON_ACCOUNT" || !a.invoiceId) {
      if (!policy.allowOnAccount) {
        throw new SettlementError(
          "Η σειρά δεν επιτρέπει πίστωση σε λογαριασμό πελάτη",
          400,
        );
      }
      continue;
    }
    const inv = invoices.find((i) => i.id === a.invoiceId)!;
    const balance = round2(toNumber(inv.total) - toNumber(inv.paidAmount));
    if (a.amount > balance + tol) {
      if (!policy.allowOverpayment && !policy.allowOnAccount) {
        throw new SettlementError(
          `Ποσό υπερβαίνει υπόλοιπο ${inv.number} (${balance.toFixed(2)})`,
          400,
        );
      }
    }
    const shortfall = round2(balance - a.amount);
    if (shortfall > tol && !policy.allowPartialSettlement) {
      if (
        !(
          policy.allowWriteOff &&
          shortfall <= policy.writeOffMaxAmount + 0.0001
        )
      ) {
        throw new SettlementError("Η σειρά απαιτεί ολική εξόφληση", 400);
      }
    }
  }

  const legalEntityId =
    input.data.legalEntityId ||
    input.legalEntityId ||
    invoices[0]!.legalEntityId;

  const resolvedMethods = await resolveMethods(db, {
    tenantId: input.tenantId,
    seriesId: policy.id || invoices[0]!.seriesId,
    methods: input.data.methods,
    policy,
  });

  const number = await nextSettlementNumber(db, input.tenantId, "RECEIPT");
  let settledAt = input.data.settledAt
    ? new Date(input.data.settledAt)
    : new Date();
  if (
    policy.settlementValueDateMode === "DOCUMENT_DATE" &&
    invoices[0]?.issuedAt
  ) {
    settledAt = invoices[0].issuedAt;
  }

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

    const invoiceAllocs = allocations.filter((a) => a.invoiceId);
    const allocAmounts = invoiceAllocs.map((a) => a.amount);

    for (const a of invoiceAllocs) {
      const inv = invoices.find((i) => i.id === a.invoiceId);
      if (!inv) continue;
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
    }

    // One InvoicePayment per tender (like POS) — pro-rate across multi-doc allocations.
    // Previously only the primary method was mirrored, so «διπλή είσπραξη» collapsed to one CASH.
    for (let mi = 0; mi < resolvedMethods.length; mi += 1) {
      const m = resolvedMethods[mi]!;
      const shares = distributeAmountAcross(allocAmounts, m.amount);
      for (let ai = 0; ai < invoiceAllocs.length; ai += 1) {
        const amt = shares[ai] ?? 0;
        if (amt <= 0) continue;
        const a = invoiceAllocs[ai]!;
        await tx.invoicePayment.create({
          data: {
            tenantId: input.tenantId,
            invoiceId: a.invoiceId!,
            settlementId: row.id,
            amount: amt,
            method: m.methodCode,
            paymentMethodId: m.paymentMethodId,
            note: input.data.notes ?? null,
            // Change / refs stay on the first allocation of each tender
            changeAmount: ai === 0 ? m.changeAmount : 0,
            externalRef: ai === 0 ? m.externalRef : null,
            giftCardId: ai === 0 ? m.giftCardId : null,
            loyaltyAccountId: ai === 0 ? m.loyaltyAccountId : null,
            paidAt: settledAt,
          },
        });
      }
    }

    return row;
  });

  let journalId: string | null = null;
  try {
    if (!policy.autoPostSettlementJournal) {
      return { settlement, journalId: null };
    }
    const journal = await postSettlementJournal(db, {
      tenantId: input.tenantId,
      legalEntityId,
      settlementId: settlement.id,
      number: settlement.number,
      kind: "RECEIPT",
      methods: resolvedMethods,
      arOrApCode: policy.glDebitAccount || "30.00.00",
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

/**
 * Rebuild InvoicePayment mirrors from Settlement method lines when an older
 * bug collapsed multi-tender receipts into a single primary-method row.
 */
export async function repairCollapsedInvoicePaymentMirrors(
  db: PrismaClient,
  tenantId: string,
) {
  const settlements = await db.settlement.findMany({
    where: { tenantId, kind: "RECEIPT", status: "POSTED" },
    include: {
      methods: { orderBy: { createdAt: "asc" } },
      allocations: {
        where: { invoiceId: { not: null } },
        orderBy: { createdAt: "asc" },
      },
      invoicePayments: true,
    },
    take: 2000,
  });

  let repaired = 0;
  for (const s of settlements) {
    if (s.methods.length <= 1) continue;
    if (s.allocations.length === 0) continue;
    // Old bug: one payment per allocation (primary only) instead of per tender
    const expected = s.methods.length * s.allocations.length;
    if (s.invoicePayments.length >= expected) continue;
    // Also catch single-invoice multi-tender collapsed to 1 row
    if (
      s.invoicePayments.length >= s.methods.length &&
      s.allocations.length === 1
    ) {
      continue;
    }

    await db.$transaction(async (tx) => {
      await tx.invoicePayment.deleteMany({
        where: { tenantId, settlementId: s.id },
      });
      const allocAmounts = s.allocations.map((a) => toNumber(a.amount));
      for (let mi = 0; mi < s.methods.length; mi += 1) {
        const m = s.methods[mi]!;
        const shares = distributeAmountAcross(
          allocAmounts,
          toNumber(m.amount),
        );
        for (let ai = 0; ai < s.allocations.length; ai += 1) {
          const amt = shares[ai] ?? 0;
          if (amt <= 0) continue;
          const a = s.allocations[ai]!;
          if (!a.invoiceId) continue;
          await tx.invoicePayment.create({
            data: {
              tenantId,
              invoiceId: a.invoiceId,
              settlementId: s.id,
              amount: amt,
              method: m.methodCode,
              paymentMethodId: m.paymentMethodId,
              changeAmount: ai === 0 ? toNumber(m.changeAmount) : 0,
              externalRef: ai === 0 ? m.externalRef : null,
              giftCardId: ai === 0 ? m.giftCardId : null,
              loyaltyAccountId: ai === 0 ? m.loyaltyAccountId : null,
              paidAt: s.settledAt,
            },
          });
        }
      }
    });
    repaired += 1;
  }

  return { scanned: settlements.length, repaired };
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
  const apPolicy = policyFromSeries(null);
  const resolvedMethods = await resolveMethods(db, {
    tenantId: input.tenantId,
    seriesId: null,
    methods: input.data.methods,
    policy: apPolicy,
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

  // Enforce series allowVoidSettlement for AR receipts
  if (settlement.kind === "RECEIPT") {
    const allocInv = settlement.allocations.find((a) => a.invoiceId)?.invoiceId;
    if (allocInv) {
      const inv = await db.invoice.findFirst({
        where: { id: allocInv, tenantId: input.tenantId },
        select: {
          series: { select: { allowVoidSettlement: true } },
        },
      });
      if (inv?.series && inv.series.allowVoidSettlement === false) {
        throw new SettlementError(
          "Η σειρά δεν επιτρέπει ακύρωση εξόφλησης",
          400,
        );
      }
    }
  }

  // Reverse GL first so we never leave VOIDED AR without matching books.
  if (settlement.journalEntryId) {
    try {
      const { reverseJournal } = await import("@/modules/ledger/service");
      await reverseJournal(db, {
        tenantId: input.tenantId,
        journalId: settlement.journalEntryId,
        createdByUserId: input.userId,
        description: `Ακύρωση εξόφλησης ${settlement.number}`,
      });
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Αποτυχία αντιστροφής άρθρου";
      throw new SettlementError(
        `Δεν ακυρώθηκε η εξόφληση — απέτυχε η αντιστροφή GL: ${msg}`,
        400,
      );
    }
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
      allocations: {
        include: {
          invoice: { select: { id: true, number: true } },
          purchaseInvoice: { select: { id: true, number: true } },
        },
      },
      methods: true,
    },
    orderBy: [{ settledAt: "desc" }, { createdAt: "desc" }],
    take: opts?.take ?? 100,
  });
}

type SerializableSettlement = {
  id: string;
  number: string;
  kind: string;
  status: string;
  partyType: string;
  customerId: string | null;
  supplierId: string | null;
  customer: { id: string; name: string; code: string } | null;
  supplier: { id: string; name: string; code: string } | null;
  legalEntityId: string | null;
  totalAmount: unknown;
  settledAt: Date;
  reference: string | null;
  notes: string | null;
  journalEntryId: string | null;
  voidedAt: Date | null;
  createdAt: Date;
  allocations: Array<{
    id: string;
    targetType: string;
    invoiceId: string | null;
    purchaseInvoiceId: string | null;
    amount: unknown;
    invoice?: { id: string; number: string } | null;
    purchaseInvoice?: { id: string; number: string } | null;
  }>;
  methods: Array<{
    id: string;
    paymentMethodId: string | null;
    methodCode: string;
    amount: unknown;
    changeAmount: unknown;
    usesClearing: boolean;
    externalRef: string | null;
  }>;
};

export function serializeSettlement(s: SerializableSettlement) {
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
      invoice: a.invoice ?? null,
      purchaseInvoice: a.purchaseInvoice ?? null,
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
