import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ensureCurrentFiscalYear, LedgerError } from "./service";

type Db = PrismaClient | Prisma.TransactionClient;

export async function listFiscalPeriods(
  db: Db,
  tenantId: string,
  opts?: { year?: number; kind?: "YEAR" | "MONTH" },
) {
  await ensureCurrentFiscalYear(db, tenantId);
  return db.fiscalPeriod.findMany({
    where: {
      tenantId,
      ...(opts?.year ? { year: opts.year } : {}),
      ...(opts?.kind ? { kind: opts.kind } : {}),
    },
    orderBy: [{ year: "desc" }, { kind: "asc" }, { month: "asc" }],
  });
}

export async function closeFiscalPeriod(
  db: Db,
  input: { tenantId: string; periodId: string; userId?: string | null },
) {
  const period = await db.fiscalPeriod.findFirst({
    where: { id: input.periodId, tenantId: input.tenantId },
  });
  if (!period) throw new LedgerError("Περίοδος δεν βρέθηκε", 404);
  if (period.status === "CLOSED") {
    throw new LedgerError("Η περίοδος είναι ήδη κλειστή");
  }

  const drafts = await db.journalEntry.count({
    where: {
      tenantId: input.tenantId,
      fiscalPeriodId: period.id,
      status: "DRAFT",
    },
  });
  if (drafts > 0) {
    throw new LedgerError(
      `Υπάρχουν ${drafts} πρόχειρα άρθρα στην περίοδο — οριστικοποιήστε ή ακυρώστε τα`,
    );
  }

  return db.fiscalPeriod.update({
    where: { id: period.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: input.userId ?? null,
    },
  });
}

export async function reopenFiscalPeriod(
  db: Db,
  input: { tenantId: string; periodId: string },
) {
  const period = await db.fiscalPeriod.findFirst({
    where: { id: input.periodId, tenantId: input.tenantId },
  });
  if (!period) throw new LedgerError("Περίοδος δεν βρέθηκε", 404);
  if (period.status !== "CLOSED") {
    throw new LedgerError("Η περίοδος δεν είναι κλειστή");
  }
  return db.fiscalPeriod.update({
    where: { id: period.id },
    data: {
      status: "OPEN",
      closedAt: null,
      closedByUserId: null,
    },
  });
}
