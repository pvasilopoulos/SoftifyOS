import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  createAndPostJournal,
  LedgerError,
  round2,
} from "./service";

type Db = PrismaClient | Prisma.TransactionClient;

export async function ensureDefaultLegalEntity(
  db: Db,
  tenantId: string,
  tenantName: string,
) {
  const existing = await db.legalEntity.findFirst({
    where: { tenantId, isDefault: true },
  });
  if (existing) return existing;
  return db.legalEntity.upsert({
    where: { tenantId_code: { tenantId, code: "MAIN" } },
    create: {
      tenantId,
      code: "MAIN",
      name: tenantName || "Κύρια εταιρεία",
      isDefault: true,
      isActive: true,
    },
    update: { isDefault: true, isActive: true },
  });
}

export async function listLegalEntities(db: Db, tenantId: string) {
  return db.legalEntity.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
  });
}

export async function upsertLegalEntity(
  db: Db,
  input: {
    tenantId: string;
    code: string;
    name: string;
    vatNumber?: string | null;
    isDefault?: boolean;
  },
) {
  if (input.isDefault) {
    await db.legalEntity.updateMany({
      where: { tenantId: input.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }
  return db.legalEntity.upsert({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.code },
    },
    create: {
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      vatNumber: input.vatNumber ?? null,
      isDefault: !!input.isDefault,
      isActive: true,
    },
    update: {
      name: input.name,
      vatNumber: input.vatNumber ?? null,
      isDefault: input.isDefault ?? undefined,
      isActive: true,
    },
  });
}

export async function listCostCenters(db: Db, tenantId: string) {
  return db.costCenter.findMany({
    where: { tenantId },
    orderBy: { code: "asc" },
  });
}

export async function upsertCostCenter(
  db: Db,
  input: {
    tenantId: string;
    code: string;
    name: string;
    parentId?: string | null;
  },
) {
  return db.costCenter.upsert({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.code },
    },
    create: {
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      parentId: input.parentId ?? null,
      isActive: true,
    },
    update: {
      name: input.name,
      parentId: input.parentId ?? undefined,
      isActive: true,
    },
  });
}

/** Analytical report: balances by cost center */
export async function loadCostCenterReport(
  db: Db,
  tenantId: string,
  opts?: { from?: Date | null; to?: Date | null },
) {
  const centers = await listCostCenters(db, tenantId);
  const lines = await db.journalLine.findMany({
    where: {
      tenantId,
      costCenterId: { not: null },
      journalEntry: {
        tenantId,
        status: "POSTED",
        ...(opts?.from || opts?.to
          ? {
              entryDate: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
    },
    select: {
      costCenterId: true,
      debit: true,
      credit: true,
      glAccount: { select: { type: true } },
    },
  });

  return centers.map((c) => {
    const mine = lines.filter((l) => l.costCenterId === c.id);
    const expense = round2(
      mine
        .filter((l) => l.glAccount.type === "EXPENSE")
        .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
    );
    const revenue = round2(
      mine
        .filter((l) => l.glAccount.type === "REVENUE")
        .reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0),
    );
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      expense,
      revenue,
      result: round2(revenue - expense),
    };
  });
}

export async function requireCostCenter(
  db: Db,
  tenantId: string,
  id: string | null | undefined,
) {
  if (!id) return null;
  const cc = await db.costCenter.findFirst({ where: { id, tenantId } });
  if (!cc) throw new LedgerError("Κέντρο κόστους δεν βρέθηκε", 404);
  return cc;
}

export async function ensureDefaultParallelLedger(db: Db, tenantId: string) {
  const existing = await db.parallelLedger.findFirst({
    where: { tenantId, isDefault: true },
  });
  if (existing) return existing;
  return db.parallelLedger.upsert({
    where: { tenantId_code: { tenantId, code: "STAT" } },
    create: {
      tenantId,
      code: "STAT",
      name: "Νόμιμα βιβλία",
      kind: "STATUTORY",
      isDefault: true,
      isActive: true,
    },
    update: { isDefault: true, isActive: true },
  });
}

export async function listParallelLedgers(db: Db, tenantId: string) {
  await ensureDefaultParallelLedger(db, tenantId);
  return db.parallelLedger.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
  });
}

export async function upsertParallelLedger(
  db: Db,
  input: {
    tenantId: string;
    code: string;
    name: string;
    kind?: string;
    isDefault?: boolean;
  },
) {
  if (input.isDefault) {
    await db.parallelLedger.updateMany({
      where: { tenantId: input.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }
  return db.parallelLedger.upsert({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.code },
    },
    create: {
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      kind: input.kind ?? "MANAGEMENT",
      isDefault: !!input.isDefault,
      isActive: true,
    },
    update: {
      name: input.name,
      kind: input.kind ?? undefined,
      isDefault: input.isDefault ?? undefined,
      isActive: true,
    },
  });
}

/** Post cost allocation: credit source CC, debit target CCs on same GL account */
export async function createAndPostCostAllocation(
  db: Db,
  input: {
    tenantId: string;
    code: string;
    name: string;
    method?: "EQUAL" | "PERCENT" | "DRIVER";
    sourceCostCenterId: string;
    glAccountId: string;
    amount: number;
    targets: Array<{ costCenterId: string; weight: number }>;
    userId?: string | null;
  },
) {
  if (input.amount <= 0) throw new LedgerError("Το ποσό πρέπει να είναι > 0");
  if (!input.targets.length) {
    throw new LedgerError("Απαιτείται τουλάχιστον ένας στόχος κατανομής");
  }
  await requireCostCenter(db, input.tenantId, input.sourceCostCenterId);
  const account = await db.glAccount.findFirst({
    where: {
      id: input.glAccountId,
      tenantId: input.tenantId,
      isPostable: true,
    },
  });
  if (!account) throw new LedgerError("Λογαριασμός δεν βρέθηκε", 404);

  const method = input.method ?? "PERCENT";
  let weights = input.targets.map((t) => ({
    ...t,
    weight: Math.max(0, t.weight),
  }));
  if (method === "EQUAL") {
    weights = weights.map((t) => ({ ...t, weight: 1 }));
  }
  const weightSum = weights.reduce((s, t) => s + t.weight, 0);
  if (weightSum <= 0) throw new LedgerError("Άθροισμα βαρών πρέπει να είναι > 0");

  const allocated: Array<{ costCenterId: string; weight: number; amount: number }> =
    [];
  let remaining = round2(input.amount);
  weights.forEach((t, idx) => {
    const amt =
      idx === weights.length - 1
        ? remaining
        : round2((input.amount * t.weight) / weightSum);
    remaining = round2(remaining - (idx === weights.length - 1 ? 0 : amt));
    allocated.push({
      costCenterId: t.costCenterId,
      weight: t.weight,
      amount: amt,
    });
  });

  const journal = await createAndPostJournal(db, {
    tenantId: input.tenantId,
    description: `Κατανομή ${input.code}: ${input.name}`,
    sourceType: "cost.allocation",
    sourceId: input.code,
    createdByUserId: input.userId,
    lines: [
      {
        glAccountId: account.id,
        credit: input.amount,
        memo: "Από κέντρο κόστους",
        costCenterId: input.sourceCostCenterId,
      },
      ...allocated.map((t) => ({
        glAccountId: account.id,
        debit: t.amount,
        memo: "Κατανομή σε κέντρο",
        costCenterId: t.costCenterId,
      })),
    ],
  });

  const allocation = await db.costAllocation.create({
    data: {
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      method,
      sourceCostCenterId: input.sourceCostCenterId,
      glAccountId: account.id,
      amount: input.amount,
      status: "POSTED",
      journalEntryId: journal.id,
      postedAt: new Date(),
      targets: {
        create: allocated.map((t) => ({
          tenantId: input.tenantId,
          costCenterId: t.costCenterId,
          weight: t.weight,
          amount: t.amount,
        })),
      },
    },
    include: { targets: true, journalEntry: { select: { id: true, number: true } } },
  });

  return allocation;
}

export async function listCostAllocations(db: Db, tenantId: string) {
  return db.costAllocation.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      sourceCostCenter: { select: { code: true, name: true } },
      glAccount: { select: { code: true, name: true } },
      targets: {
        include: { costCenter: { select: { code: true, name: true } } },
      },
      journalEntry: { select: { id: true, number: true } },
    },
  });
}

/** Match intercompany balances between two legal entities and optionally eliminate */
export async function createIntercompanyMatch(
  db: Db,
  input: {
    tenantId: string;
    code: string;
    legalEntityAId: string;
    legalEntityBId: string;
    lineAId?: string | null;
    lineBId?: string | null;
    amount: number;
    notes?: string | null;
    eliminate?: boolean;
    userId?: string | null;
  },
) {
  if (input.legalEntityAId === input.legalEntityBId) {
    throw new LedgerError("Οι οντότητες πρέπει να διαφέρουν");
  }
  const [a, b] = await Promise.all([
    db.legalEntity.findFirst({
      where: { id: input.legalEntityAId, tenantId: input.tenantId },
    }),
    db.legalEntity.findFirst({
      where: { id: input.legalEntityBId, tenantId: input.tenantId },
    }),
  ]);
  if (!a || !b) throw new LedgerError("Νομική οντότητα δεν βρέθηκε", 404);

  let amountA = input.amount;
  let amountB = input.amount;
  if (input.lineAId) {
    const la = await db.journalLine.findFirst({
      where: { id: input.lineAId, tenantId: input.tenantId },
    });
    if (!la) throw new LedgerError("Γραμμή Α δεν βρέθηκε", 404);
    amountA = round2(Math.abs(Number(la.debit) - Number(la.credit)));
  }
  if (input.lineBId) {
    const lb = await db.journalLine.findFirst({
      where: { id: input.lineBId, tenantId: input.tenantId },
    });
    if (!lb) throw new LedgerError("Γραμμή Β δεν βρέθηκε", 404);
    amountB = round2(Math.abs(Number(lb.debit) - Number(lb.credit)));
  }

  const amount = round2(Math.min(amountA, amountB, input.amount));
  const difference = round2(Math.abs(amountA - amountB));
  let status = difference < 0.02 ? "MATCHED" : "OPEN";
  let journalEntryId: string | null = null;

  if (input.eliminate && status === "MATCHED") {
    // Soft elimination marker journal on consolidation clearing (80.00.00 plug)
    const clear = await db.glAccount.findFirst({
      where: { tenantId: input.tenantId, code: "80.00.00", isActive: true },
    });
    if (clear && amount > 0) {
      const journal = await createAndPostJournal(db, {
        tenantId: input.tenantId,
        description: `IC elimination ${input.code}`,
        sourceType: "intercompany.eliminate",
        sourceId: input.code,
        createdByUserId: input.userId,
        lines: [
          {
            glAccountId: clear.id,
            debit: amount,
            memo: `Elim ${a.code}→${b.code}`,
            legalEntityId: a.id,
          },
          {
            glAccountId: clear.id,
            credit: amount,
            memo: `Elim ${b.code}→${a.code}`,
            legalEntityId: b.id,
          },
        ],
      });
      journalEntryId = journal.id;
      status = "ELIMINATED";
    }
  }

  return db.intercompanyMatch.create({
    data: {
      tenantId: input.tenantId,
      code: input.code,
      legalEntityAId: a.id,
      legalEntityBId: b.id,
      amount,
      difference,
      status,
      journalEntryId,
      notes: input.notes ?? null,
      matchedAt: status === "OPEN" ? null : new Date(),
      lines: {
        create: [
          {
            tenantId: input.tenantId,
            lineAId: input.lineAId ?? null,
            lineBId: input.lineBId ?? null,
            amount,
          },
        ],
      },
    },
    include: {
      legalEntityA: { select: { code: true, name: true } },
      legalEntityB: { select: { code: true, name: true } },
      lines: true,
      journalEntry: { select: { id: true, number: true } },
    },
  });
}

export async function listIntercompanyMatches(db: Db, tenantId: string) {
  return db.intercompanyMatch.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      legalEntityA: { select: { code: true, name: true } },
      legalEntityB: { select: { code: true, name: true } },
      journalEntry: { select: { id: true, number: true } },
    },
  });
}
