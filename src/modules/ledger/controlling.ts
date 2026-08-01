import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { LedgerError, round2 } from "./service";

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
