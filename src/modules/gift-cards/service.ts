import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { roundMoney, toNumber } from "@/modules/sales/invoice-utils";
import type { AdjustGiftCardInput, IssueGiftCardInput } from "./schemas";

type Db = PrismaClient | Prisma.TransactionClient;

export class GiftCardError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
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
  const card = await db.giftCard.create({
    data: {
      tenantId: input.tenantId,
      code,
      initialBalance: balance,
      balance,
      customerId: input.data.customerId || null,
      expiresAt: input.data.expiresAt ? new Date(input.data.expiresAt) : null,
      notes: input.data.notes || null,
      status: "ACTIVE",
      ledger: {
        create: {
          tenantId: input.tenantId,
          kind: "ISSUE",
          amount: balance,
          balanceAfter: balance,
          note: input.data.notes || "Έκδοση δωροκάρτας",
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
  const card = await db.giftCard.findFirst({
    where: { id: input.giftCardId, tenantId: input.tenantId },
  });
  if (!card) throw new GiftCardError("Η δωροκάρτα δεν βρέθηκε", 404);
  if (card.status !== "ACTIVE") {
    throw new GiftCardError(`Η δωροκάρτα είναι ${card.status}`);
  }
  if (card.expiresAt && card.expiresAt < new Date()) {
    await db.giftCard.update({
      where: { id: card.id },
      data: { status: "EXPIRED" },
    });
    throw new GiftCardError("Η δωροκάρτα έχει λήξει");
  }

  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new GiftCardError("Μη έγκυρο ποσό εξαργύρωσης");
  const bal = toNumber(card.balance);
  if (bal + 0.001 < amount) {
    throw new GiftCardError(
      `Ανεπαρκές υπόλοιπο (${bal.toFixed(2)} €)`,
    );
  }

  const newBal = roundMoney(bal - amount);
  const updated = await db.giftCard.update({
    where: { id: card.id },
    data: {
      balance: newBal,
      status: newBal <= 0 ? "DEPLETED" : "ACTIVE",
      ledger: {
        create: {
          tenantId: input.tenantId,
          kind: "REDEEM",
          amount: -amount,
          balanceAfter: newBal,
          invoiceId: input.invoiceId ?? null,
          note: input.note ?? `Εξαργύρωση ${amount.toFixed(2)} €`,
          createdByUserId: input.userId ?? null,
        },
      },
    },
  });

  return updated;
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
