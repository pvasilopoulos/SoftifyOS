import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  createAndPostJournal,
  findAccountByCode,
  LedgerError,
  round2,
} from "./service";

type Db = PrismaClient | Prisma.TransactionClient;

export async function listFixedAssets(db: Db, tenantId: string) {
  return db.fixedAsset.findMany({
    where: { tenantId },
    include: {
      glAssetAccount: { select: { code: true, name: true } },
      costCenter: { select: { code: true, name: true } },
      legalEntity: { select: { code: true, name: true } },
      movements: { orderBy: { movedAt: "desc" }, take: 5 },
    },
    orderBy: { code: "asc" },
  });
}

export async function createFixedAsset(
  db: Db,
  input: {
    tenantId: string;
    code: string;
    name: string;
    acquisitionDate: Date;
    acquisitionCost: number;
    residualValue?: number;
    usefulLifeMonths?: number;
    costCenterId?: string | null;
    legalEntityId?: string | null;
    notes?: string | null;
    userId?: string | null;
    postAcquisition?: boolean;
  },
) {
  const assetAcc = await findAccountByCode(db, input.tenantId, "10.00.00");
  const accumAcc = await findAccountByCode(db, input.tenantId, "10.00.01");
  const expAcc = await findAccountByCode(db, input.tenantId, "66.00.00");
  if (!assetAcc || !accumAcc || !expAcc) {
    throw new LedgerError("Λείπουν λογαριασμοί παγίων στο σχέδιο λογαριασμών");
  }

  const asset = await db.fixedAsset.create({
    data: {
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      acquisitionDate: input.acquisitionDate,
      acquisitionCost: input.acquisitionCost,
      residualValue: input.residualValue ?? 0,
      usefulLifeMonths: input.usefulLifeMonths ?? 60,
      glAssetAccountId: assetAcc.id,
      glAccumDeprAccountId: accumAcc.id,
      glDeprExpenseAccountId: expAcc.id,
      costCenterId: input.costCenterId ?? null,
      legalEntityId: input.legalEntityId ?? null,
      notes: input.notes ?? null,
      status: "ACTIVE",
    },
  });

  let journalId: string | null = null;
  if (input.postAcquisition !== false) {
    const cash = await findAccountByCode(db, input.tenantId, "38.00.00");
    if (!cash) throw new LedgerError("Λείπει λογαριασμός ταμείου 38.00.00");
    const journal = await createAndPostJournal(db, {
      tenantId: input.tenantId,
      description: `Απόκτηση παγίου ${asset.code}`,
      sourceType: "fixed_asset.acquire",
      sourceId: asset.id,
      createdByUserId: input.userId,
      entryDate: input.acquisitionDate,
      lines: [
        {
          glAccountId: assetAcc.id,
          debit: input.acquisitionCost,
          memo: asset.name,
          costCenterId: input.costCenterId,
          legalEntityId: input.legalEntityId,
        },
        {
          glAccountId: cash.id,
          credit: input.acquisitionCost,
          memo: "Πληρωμή παγίου",
          legalEntityId: input.legalEntityId,
        },
      ],
    });
    journalId = journal.id;
    await db.fixedAssetMovement.create({
      data: {
        tenantId: input.tenantId,
        fixedAssetId: asset.id,
        kind: "ACQUIRE",
        amount: input.acquisitionCost,
        movedAt: input.acquisitionDate,
        memo: "Απόκτηση",
        journalEntryId: journalId,
      },
    });
  }

  return { asset, journalId };
}

export function monthlyDepreciation(asset: {
  acquisitionCost: unknown;
  residualValue: unknown;
  usefulLifeMonths: number;
}) {
  const cost = Number(asset.acquisitionCost);
  const residual = Number(asset.residualValue);
  const months = Math.max(1, asset.usefulLifeMonths);
  return round2(Math.max(0, (cost - residual) / months));
}

export async function postMonthlyDepreciation(
  db: Db,
  input: {
    tenantId: string;
    fixedAssetId: string;
    userId?: string | null;
    asOf?: Date;
  },
) {
  const asset = await db.fixedAsset.findFirst({
    where: { id: input.fixedAssetId, tenantId: input.tenantId },
  });
  if (!asset) throw new LedgerError("Πάγιο δεν βρέθηκε", 404);
  if (asset.status !== "ACTIVE") {
    throw new LedgerError("Το πάγιο δεν είναι ενεργό");
  }

  const amount = monthlyDepreciation(asset);
  if (amount <= 0) throw new LedgerError("Μηδενική απόσβεση");

  const asOf = input.asOf ?? new Date();
  const journal = await createAndPostJournal(db, {
    tenantId: input.tenantId,
    description: `Απόσβεση ${asset.code}`,
    sourceType: "fixed_asset.depreciate",
    sourceId: `${asset.id}:${asOf.toISOString().slice(0, 7)}`,
    createdByUserId: input.userId,
    entryDate: asOf,
    lines: [
      {
        glAccountId: asset.glDeprExpenseAccountId,
        debit: amount,
        memo: "Απόσβεση",
        costCenterId: asset.costCenterId,
        legalEntityId: asset.legalEntityId,
      },
      {
        glAccountId: asset.glAccumDeprAccountId,
        credit: amount,
        memo: "Συσσωρευμένες αποσβέσεις",
        legalEntityId: asset.legalEntityId,
      },
    ],
  });

  await db.fixedAssetMovement.create({
    data: {
      tenantId: input.tenantId,
      fixedAssetId: asset.id,
      kind: "DEPRECIATE",
      amount,
      movedAt: asOf,
      memo: "Μηνιαία απόσβεση",
      journalEntryId: journal.id,
    },
  });

  return { amount, journal };
}
