import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  defaultLoyaltyRules,
  earnPointsForSale,
  eurToRedeemPoints,
  pointsToEur,
  type LoyaltyRules,
} from "./rules";
import type {
  AdjustLoyaltyInput,
  OpenLoyaltyAccountInput,
  UpsertLoyaltyProgramInput,
} from "./schemas";

type Db = PrismaClient | Prisma.TransactionClient;

export class LoyaltyError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function getLoyaltyRules(
  db: Db,
  tenantId: string,
): Promise<LoyaltyRules> {
  const program = await db.loyaltyProgram.findUnique({
    where: { tenantId },
  });
  if (!program || !program.isActive) return defaultLoyaltyRules;
  return {
    earnPointsPerEur: program.earnPointsPerEur,
    redeemPointsPerEur: program.redeemPointsPerEur,
  };
}

export async function ensureLoyaltyProgram(db: Db, tenantId: string) {
  return db.loyaltyProgram.upsert({
    where: { tenantId },
    create: {
      tenantId,
      name: "Standard",
      earnPointsPerEur: defaultLoyaltyRules.earnPointsPerEur,
      redeemPointsPerEur: defaultLoyaltyRules.redeemPointsPerEur,
      isActive: true,
    },
    update: {},
  });
}

export async function upsertLoyaltyProgram(
  db: Db,
  input: { tenantId: string; data: UpsertLoyaltyProgramInput },
) {
  return db.loyaltyProgram.upsert({
    where: { tenantId: input.tenantId },
    create: {
      tenantId: input.tenantId,
      name: input.data.name,
      earnPointsPerEur: input.data.earnPointsPerEur,
      redeemPointsPerEur: input.data.redeemPointsPerEur,
      isActive: input.data.isActive ?? true,
    },
    update: {
      name: input.data.name,
      earnPointsPerEur: input.data.earnPointsPerEur,
      redeemPointsPerEur: input.data.redeemPointsPerEur,
      ...(input.data.isActive !== undefined
        ? { isActive: input.data.isActive }
        : {}),
    },
  });
}

export async function openLoyaltyAccount(
  db: Db,
  input: {
    tenantId: string;
    data: OpenLoyaltyAccountInput;
  },
) {
  const customer = await db.customer.findFirst({
    where: { id: input.data.customerId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!customer) throw new LoyaltyError("Ο πελάτης δεν βρέθηκε", 404);

  const existing = await db.loyaltyAccount.findUnique({
    where: {
      tenantId_customerId: {
        tenantId: input.tenantId,
        customerId: input.data.customerId,
      },
    },
  });
  if (existing) {
    throw new LoyaltyError("Υπάρχει ήδη λογαριασμός loyalty για τον πελάτη", 409);
  }

  const opening = input.data.openingPoints ?? 0;
  return db.loyaltyAccount.create({
    data: {
      tenantId: input.tenantId,
      customerId: input.data.customerId,
      tier: input.data.tier ?? "STANDARD",
      pointsBalance: opening,
      isActive: true,
      ...(opening > 0
        ? {
            ledger: {
              create: {
                tenantId: input.tenantId,
                kind: "ADJUST",
                points: opening,
                note: input.data.note || "Αρχικό υπόλοιπο",
              },
            },
          }
        : {}),
    },
    include: {
      customer: { select: { id: true, code: true, name: true, email: true } },
    },
  });
}

export async function adjustLoyaltyPoints(
  db: Db,
  input: {
    tenantId: string;
    accountId: string;
    data: AdjustLoyaltyInput;
  },
) {
  const account = await db.loyaltyAccount.findFirst({
    where: { id: input.accountId, tenantId: input.tenantId },
  });
  if (!account) throw new LoyaltyError("Ο λογαριασμός δεν βρέθηκε", 404);

  const next = account.pointsBalance + input.data.points;
  if (next < 0) {
    throw new LoyaltyError("Το υπόλοιπο πόντων δεν μπορεί να γίνει αρνητικό");
  }

  return db.loyaltyAccount.update({
    where: { id: account.id },
    data: {
      pointsBalance: next,
      ledger: {
        create: {
          tenantId: input.tenantId,
          kind: "ADJUST",
          points: input.data.points,
          note: input.data.note,
        },
      },
    },
    include: {
      customer: { select: { id: true, code: true, name: true, email: true } },
      ledger: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
}

export async function redeemLoyaltyPoints(
  db: Db,
  input: {
    tenantId: string;
    accountId: string;
    points: number;
    invoiceId?: string;
    note?: string;
    rules?: LoyaltyRules;
  },
) {
  const account = await db.loyaltyAccount.findFirst({
    where: { id: input.accountId, tenantId: input.tenantId },
  });
  if (!account || !account.isActive) {
    throw new LoyaltyError("Δεν υπάρχει ενεργός λογαριασμός loyalty");
  }
  if (input.points <= 0) throw new LoyaltyError("Μη έγκυροι πόντοι");
  if (input.points > account.pointsBalance) {
    throw new LoyaltyError("Ανεπαρκείς πόντοι loyalty");
  }

  return db.loyaltyAccount.update({
    where: { id: account.id },
    data: {
      pointsBalance: { decrement: input.points },
      ledger: {
        create: {
          tenantId: input.tenantId,
          kind: "REDEEM",
          points: -input.points,
          invoiceId: input.invoiceId ?? null,
          note: input.note ?? `Redeem ${input.points} pts`,
        },
      },
    },
  });
}

export async function earnLoyaltyPoints(
  db: Db,
  input: {
    tenantId: string;
    accountId: string;
    saleTotalEur: number;
    invoiceId?: string;
    rules?: LoyaltyRules;
  },
) {
  const rules = input.rules ?? (await getLoyaltyRules(db, input.tenantId));
  const pts = earnPointsForSale(input.saleTotalEur, rules);
  if (pts <= 0) return null;

  return db.loyaltyAccount.update({
    where: { id: input.accountId },
    data: {
      pointsBalance: { increment: pts },
      ledger: {
        create: {
          tenantId: input.tenantId,
          kind: "EARN",
          points: pts,
          invoiceId: input.invoiceId ?? null,
          note: `Earn from sale ${input.saleTotalEur.toFixed(2)} €`,
        },
      },
    },
  });
}

export { pointsToEur, eurToRedeemPoints, earnPointsForSale };
