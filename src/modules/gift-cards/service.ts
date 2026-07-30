import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { roundMoney, toNumber } from "@/modules/sales/invoice-utils";
import {
  DEFAULT_GIFT_CARD_ACCOUNTS,
  postingForGiftCardMovement,
} from "./accounting";
import type {
  AdjustGiftCardInput,
  IssueGiftCardInput,
  PatchGiftCardAccountingInput,
} from "./schemas";

type Db = PrismaClient | Prisma.TransactionClient;

export class GiftCardError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function resolveAccounts(data: {
  glLiabilityAccount?: string | null;
  glCashAccount?: string | null;
  glRedeemContraAccount?: string | null;
}) {
  return {
    glLiabilityAccount:
      data.glLiabilityAccount?.trim() ||
      DEFAULT_GIFT_CARD_ACCOUNTS.glLiabilityAccount,
    glCashAccount:
      data.glCashAccount?.trim() || DEFAULT_GIFT_CARD_ACCOUNTS.glCashAccount,
    glRedeemContraAccount:
      data.glRedeemContraAccount?.trim() ||
      DEFAULT_GIFT_CARD_ACCOUNTS.glRedeemContraAccount,
  };
}

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function issueGiftCard(
  db: Db,
  input: {
    tenantId: string;
    userId?: string;
    data: IssueGiftCardInput;
  },
) {
  const code = input.data.code;
  const existing = await db.giftCard.findUnique({
    where: { tenantId_code: { tenantId: input.tenantId, code } },
  });
  if (existing) {
    throw new GiftCardError(`Υπάρχει ήδη δωροκάρτα με κωδικό ${code}`, 409);
  }

  if (input.data.customerId) {
    const customer = await db.customer.findFirst({
      where: { id: input.data.customerId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!customer) throw new GiftCardError("Ο πελάτης δεν βρέθηκε", 404);
  }

  const balance = roundMoney(input.data.initialBalance);
  const accounts = resolveAccounts(input.data);
  const posting = postingForGiftCardMovement("ISSUE", accounts, balance);

  const card = await db.giftCard.create({
    data: {
      tenantId: input.tenantId,
      code,
      initialBalance: balance,
      balance,
      customerId: input.data.customerId || null,
      expiresAt: input.data.expiresAt ? new Date(input.data.expiresAt) : null,
      notes: input.data.notes || null,
      glLiabilityAccount: accounts.glLiabilityAccount,
      glCashAccount: accounts.glCashAccount,
      glRedeemContraAccount: accounts.glRedeemContraAccount,
      costCenter: emptyToNull(input.data.costCenter),
      accountingCode: emptyToNull(input.data.accountingCode),
      status: "ACTIVE",
      ledger: {
        create: {
          tenantId: input.tenantId,
          kind: "ISSUE",
          amount: balance,
          balanceAfter: balance,
          note: input.data.notes || "Έκδοση δωροκάρτας",
          glDebitAccount: posting.glDebitAccount,
          glCreditAccount: posting.glCreditAccount,
          createdByUserId: input.userId ?? null,
        },
      },
    },
    include: {
      customer: { select: { id: true, code: true, name: true } },
    },
  });

  return card;
}

/**
 * Atomic redeem: UPDATE … WHERE balance >= amount so concurrent checkouts
 * cannot double-spend. Always writes a REDEEM ledger row with GL snapshot.
 */
export async function redeemGiftCard(
  db: Db,
  input: {
    tenantId: string;
    giftCardId: string;
    amount: number;
    invoiceId?: string;
    userId?: string;
    note?: string;
  },
) {
  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new GiftCardError("Μη έγκυρο ποσό εξαργύρωσης");

  const card = await db.giftCard.findFirst({
    where: { id: input.giftCardId, tenantId: input.tenantId },
  });
  if (!card) throw new GiftCardError("Η δωροκάρτα δεν βρέθηκε", 404);
  if (card.status === "VOID") {
    throw new GiftCardError("Η δωροκάρτα είναι άκυρη");
  }
  if (card.status === "DEPLETED") {
    throw new GiftCardError("Η δωροκάρτα έχει εξαντληθεί");
  }
  if (card.status === "EXPIRED" || (card.expiresAt && card.expiresAt < new Date())) {
    if (card.status !== "EXPIRED") {
      const bal = toNumber(card.balance);
      const posting = postingForGiftCardMovement("EXPIRE", card, -bal);
      await db.giftCard.update({
        where: { id: card.id },
        data: {
          status: "EXPIRED",
          ...(bal > 0
            ? {
                balance: 0,
                ledger: {
                  create: {
                    tenantId: input.tenantId,
                    kind: "EXPIRE",
                    amount: -bal,
                    balanceAfter: 0,
                    note: "Αυτόματη λήξη",
                    glDebitAccount: posting.glDebitAccount,
                    glCreditAccount: posting.glCreditAccount,
                    createdByUserId: input.userId ?? null,
                  },
                },
              }
            : {}),
        },
      });
    }
    throw new GiftCardError("Η δωροκάρτα έχει λήξει");
  }
  if (card.status !== "ACTIVE") {
    throw new GiftCardError(`Η δωροκάρτα είναι ${card.status}`);
  }

  const rows = await db.$queryRaw<
    Array<{ id: string; balance: Prisma.Decimal; status: string }>
  >(Prisma.sql`
    UPDATE "gift_cards"
    SET
      "balance" = "balance" - ${amount},
      "status" = CASE
        WHEN "balance" - ${amount} <= 0 THEN CAST('DEPLETED' AS "GiftCardStatus")
        ELSE CAST('ACTIVE' AS "GiftCardStatus")
      END,
      "updatedAt" = NOW()
    WHERE "id" = ${input.giftCardId}
      AND "tenantId" = ${input.tenantId}
      AND "status" = CAST('ACTIVE' AS "GiftCardStatus")
      AND "balance" >= ${amount}
      AND ("expiresAt" IS NULL OR "expiresAt" >= NOW())
    RETURNING "id", "balance", "status"
  `);

  if (rows.length === 0) {
    const fresh = await db.giftCard.findFirst({
      where: { id: input.giftCardId, tenantId: input.tenantId },
    });
    const bal = fresh ? toNumber(fresh.balance) : 0;
    throw new GiftCardError(
      `Ανεπαρκές υπόλοιπο ή η κάρτα δεν είναι διαθέσιμη (${bal.toFixed(2)} €)`,
    );
  }

  const newBal = toNumber(rows[0]!.balance);
  const posting = postingForGiftCardMovement("REDEEM", card, -amount);

  await db.giftCardLedger.create({
    data: {
      tenantId: input.tenantId,
      giftCardId: card.id,
      kind: "REDEEM",
      amount: -amount,
      balanceAfter: newBal,
      invoiceId: input.invoiceId ?? null,
      note: input.note ?? `Εξαργύρωση ${amount.toFixed(2)} €`,
      glDebitAccount: posting.glDebitAccount,
      glCreditAccount: posting.glCreditAccount,
      createdByUserId: input.userId ?? null,
    },
  });

  return {
    ...card,
    balance: rows[0]!.balance,
    status: rows[0]!.status as typeof card.status,
  };
}

export async function adjustGiftCard(
  db: Db,
  input: {
    tenantId: string;
    giftCardId: string;
    userId?: string;
    data: AdjustGiftCardInput;
  },
) {
  const card = await db.giftCard.findFirst({
    where: { id: input.giftCardId, tenantId: input.tenantId },
  });
  if (!card) throw new GiftCardError("Η δωροκάρτα δεν βρέθηκε", 404);
  if (card.status === "VOID") {
    throw new GiftCardError("Δεν γίνεται προσαρμογή σε άκυρη δωροκάρτα");
  }

  const delta = roundMoney(input.data.amount);
  const newBal = roundMoney(toNumber(card.balance) + delta);
  if (newBal < 0) {
    throw new GiftCardError("Το υπόλοιπο δεν μπορεί να γίνει αρνητικό");
  }

  const posting = postingForGiftCardMovement("ADJUST", card, delta);

  return db.giftCard.update({
    where: { id: card.id },
    data: {
      balance: newBal,
      status: newBal <= 0 ? "DEPLETED" : "ACTIVE",
      ledger: {
        create: {
          tenantId: input.tenantId,
          kind: "ADJUST",
          amount: delta,
          balanceAfter: newBal,
          note: input.data.note,
          glDebitAccount: posting.glDebitAccount,
          glCreditAccount: posting.glCreditAccount,
          createdByUserId: input.userId ?? null,
        },
      },
    },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      ledger: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}

export async function voidGiftCard(
  db: Db,
  input: {
    tenantId: string;
    giftCardId: string;
    userId?: string;
    note?: string | null;
  },
) {
  const card = await db.giftCard.findFirst({
    where: { id: input.giftCardId, tenantId: input.tenantId },
  });
  if (!card) throw new GiftCardError("Η δωροκάρτα δεν βρέθηκε", 404);
  if (card.status === "VOID") {
    throw new GiftCardError("Η δωροκάρτα είναι ήδη άκυρη");
  }

  const bal = toNumber(card.balance);
  const posting = postingForGiftCardMovement("VOID", card, -bal);

  return db.giftCard.update({
    where: { id: card.id },
    data: {
      status: "VOID",
      balance: 0,
      ledger: {
        create: {
          tenantId: input.tenantId,
          kind: "VOID",
          amount: -bal,
          balanceAfter: 0,
          note: input.note || "Ακύρωση δωροκάρτας",
          glDebitAccount: posting.glDebitAccount,
          glCreditAccount: posting.glCreditAccount,
          createdByUserId: input.userId ?? null,
        },
      },
    },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      ledger: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}

export async function updateGiftCardAccounting(
  db: Db,
  input: {
    tenantId: string;
    giftCardId: string;
    data: PatchGiftCardAccountingInput;
  },
) {
  const card = await db.giftCard.findFirst({
    where: { id: input.giftCardId, tenantId: input.tenantId },
  });
  if (!card) throw new GiftCardError("Η δωροκάρτα δεν βρέθηκε", 404);

  return db.giftCard.update({
    where: { id: card.id },
    data: {
      ...(input.data.glLiabilityAccount !== undefined
        ? {
            glLiabilityAccount:
              emptyToNull(input.data.glLiabilityAccount) ??
              DEFAULT_GIFT_CARD_ACCOUNTS.glLiabilityAccount,
          }
        : {}),
      ...(input.data.glCashAccount !== undefined
        ? {
            glCashAccount:
              emptyToNull(input.data.glCashAccount) ??
              DEFAULT_GIFT_CARD_ACCOUNTS.glCashAccount,
          }
        : {}),
      ...(input.data.glRedeemContraAccount !== undefined
        ? {
            glRedeemContraAccount:
              emptyToNull(input.data.glRedeemContraAccount) ??
              DEFAULT_GIFT_CARD_ACCOUNTS.glRedeemContraAccount,
          }
        : {}),
      ...(input.data.costCenter !== undefined
        ? { costCenter: emptyToNull(input.data.costCenter) }
        : {}),
      ...(input.data.accountingCode !== undefined
        ? { accountingCode: emptyToNull(input.data.accountingCode) }
        : {}),
    },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      ledger: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
}
