import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  createAndPostJournal,
  ensureChartOfAccounts,
  ensureCurrentFiscalYear,
  findAccountByCode,
  LedgerError,
  round2,
} from "./service";
import { loadProfitAndLoss, loadTrialBalance } from "./reports";

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

/**
 * Year-end close:
 * 1) Close all open monthly periods of the year
 * 2) Post P&L close to 80.00.00 (Αποτελέσματα χρήσης)
 * 3) Close YEAR period
 * 4) Optionally create opening balances for next year (BS accounts → 89.00.00)
 */
export async function closeFiscalYear(
  db: Db,
  input: {
    tenantId: string;
    year: number;
    userId?: string | null;
    createOpenings?: boolean;
  },
) {
  await ensureChartOfAccounts(db, input.tenantId);
  await ensureCurrentFiscalYear(db, input.tenantId);

  const yearPeriod = await db.fiscalPeriod.findFirst({
    where: {
      tenantId: input.tenantId,
      kind: "YEAR",
      year: input.year,
    },
  });
  if (!yearPeriod) throw new LedgerError("Χρήση δεν βρέθηκε", 404);
  if (yearPeriod.status === "CLOSED") {
    throw new LedgerError("Η χρήση είναι ήδη κλειστή");
  }

  const existingClose = await db.journalEntry.findFirst({
    where: {
      tenantId: input.tenantId,
      sourceType: "year.close",
      sourceId: String(input.year),
      status: "POSTED",
    },
  });
  if (existingClose) {
    throw new LedgerError("Υπάρχει ήδη άρθρο κλεισίματος χρήσης");
  }

  const months = await db.fiscalPeriod.findMany({
    where: {
      tenantId: input.tenantId,
      kind: "MONTH",
      year: input.year,
      status: "OPEN",
    },
  });
  for (const m of months) {
    await closeFiscalPeriod(db, {
      tenantId: input.tenantId,
      periodId: m.id,
      userId: input.userId,
    });
  }

  const from = new Date(Date.UTC(input.year, 0, 1));
  const to = new Date(Date.UTC(input.year, 11, 31, 23, 59, 59, 999));
  const pnl = await loadProfitAndLoss(db, input.tenantId, { from, to });
  const result80 = await findAccountByCode(db, input.tenantId, "80.00.00");
  if (!result80) throw new LedgerError("Λογαριασμός 80.00.00 δεν βρέθηκε");

  const closeLines: Array<{
    glAccountId: string;
    debit?: number;
    credit?: number;
    memo: string;
  }> = [];

  for (const row of pnl.revenue) {
    const bal = round2(row.credit - row.debit);
    if (bal < 0.005) continue;
    closeLines.push({
      glAccountId: row.accountId,
      debit: bal,
      memo: `Κλείσιμο εσόδων ${input.year}`,
    });
  }
  for (const row of pnl.expense) {
    const bal = round2(row.debit - row.credit);
    if (bal < 0.005) continue;
    closeLines.push({
      glAccountId: row.accountId,
      credit: bal,
      memo: `Κλείσιμο εξόδων ${input.year}`,
    });
  }

  const net = round2(pnl.netIncome);
  if (net >= 0) {
    closeLines.push({
      glAccountId: result80.id,
      credit: net,
      memo: `Αποτέλεσμα χρήσης ${input.year}`,
    });
  } else {
    closeLines.push({
      glAccountId: result80.id,
      debit: Math.abs(net),
      memo: `Ζημία χρήσης ${input.year}`,
    });
  }

  // Temporarily reopen December (or year) so close journal can post
  const dec = await db.fiscalPeriod.findFirst({
    where: {
      tenantId: input.tenantId,
      kind: "MONTH",
      year: input.year,
      month: 12,
    },
  });
  if (dec && dec.status === "CLOSED") {
    await db.fiscalPeriod.update({
      where: { id: dec.id },
      data: { status: "OPEN", closedAt: null, closedByUserId: null },
    });
  }

  let closeJournal = null;
  if (closeLines.length >= 2) {
    closeJournal = await createAndPostJournal(db, {
      tenantId: input.tenantId,
      description: `Κλείσιμο χρήσης ${input.year} → 80.00.00`,
      sourceType: "year.close",
      sourceId: String(input.year),
      createdByUserId: input.userId,
      entryDate: to,
      lines: closeLines,
    });
  }

  if (dec) {
    await db.fiscalPeriod.update({
      where: { id: dec.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByUserId: input.userId ?? null,
      },
    });
  }

  await db.fiscalPeriod.update({
    where: { id: yearPeriod.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: input.userId ?? null,
    },
  });

  let openingJournal = null;
  if (input.createOpenings !== false) {
    const nextYear = input.year + 1;
    await ensureCurrentFiscalYear(db, input.tenantId);
    // ensure next year periods exist
    const nyCode = String(nextYear);
    await db.fiscalPeriod.upsert({
      where: {
        tenantId_code: { tenantId: input.tenantId, code: nyCode },
      },
      create: {
        tenantId: input.tenantId,
        code: nyCode,
        name: `Χρήση ${nextYear}`,
        year: nextYear,
        kind: "YEAR",
        startsAt: new Date(`${nextYear}-01-01T00:00:00.000Z`),
        endsAt: new Date(`${nextYear}-12-31T23:59:59.999Z`),
        status: "OPEN",
      },
      update: {},
    });
    for (let month = 1; month <= 12; month++) {
      const mCode = `${nextYear}-${String(month).padStart(2, "0")}`;
      await db.fiscalPeriod.upsert({
        where: {
          tenantId_code: { tenantId: input.tenantId, code: mCode },
        },
        create: {
          tenantId: input.tenantId,
          code: mCode,
          name: `${month}/${nextYear}`,
          year: nextYear,
          month,
          kind: "MONTH",
          startsAt: new Date(Date.UTC(nextYear, month - 1, 1)),
          endsAt: new Date(Date.UTC(nextYear, month, 0, 23, 59, 59, 999)),
          status: "OPEN",
        },
        update: {},
      });
    }

    const opening = await findAccountByCode(db, input.tenantId, "89.00.00");
    const tb = await loadTrialBalance(db, input.tenantId, { to });
    const bsRows = tb.filter(
      (r) =>
        (r.type === "ASSET" || r.type === "LIABILITY" || r.type === "EQUITY") &&
        Math.abs(r.balance) >= 0.005 &&
        r.code !== "89.00.00",
    );

    if (opening && bsRows.length) {
      const lines: Array<{
        glAccountId: string;
        debit?: number;
        credit?: number;
        memo: string;
      }> = [];
      let debitSum = 0;
      let creditSum = 0;
      for (const row of bsRows) {
        if (row.type === "ASSET") {
          if (row.balance > 0) {
            lines.push({
              glAccountId: row.accountId,
              debit: row.balance,
              memo: `Έναρξη ${nextYear}`,
            });
            debitSum = round2(debitSum + row.balance);
          } else {
            lines.push({
              glAccountId: row.accountId,
              credit: Math.abs(row.balance),
              memo: `Έναρξη ${nextYear}`,
            });
            creditSum = round2(creditSum + Math.abs(row.balance));
          }
        } else {
          // liability / equity — credit nature when positive balance
          if (row.balance > 0) {
            lines.push({
              glAccountId: row.accountId,
              credit: row.balance,
              memo: `Έναρξη ${nextYear}`,
            });
            creditSum = round2(creditSum + row.balance);
          } else {
            lines.push({
              glAccountId: row.accountId,
              debit: Math.abs(row.balance),
              memo: `Έναρξη ${nextYear}`,
            });
            debitSum = round2(debitSum + Math.abs(row.balance));
          }
        }
      }
      const plug = round2(debitSum - creditSum);
      if (Math.abs(plug) >= 0.005) {
        if (plug > 0) {
          lines.push({
            glAccountId: opening.id,
            credit: plug,
            memo: "Υπόλοιπα έναρξης",
          });
        } else {
          lines.push({
            glAccountId: opening.id,
            debit: Math.abs(plug),
            memo: "Υπόλοιπα έναρξης",
          });
        }
      }
      if (lines.length >= 2) {
        openingJournal = await createAndPostJournal(db, {
          tenantId: input.tenantId,
          description: `Υπόλοιπα έναρξης ${nextYear}`,
          sourceType: "year.opening",
          sourceId: String(nextYear),
          createdByUserId: input.userId,
          entryDate: new Date(Date.UTC(nextYear, 0, 1)),
          isOpening: true,
          lines,
        });
      }
    }
  }

  return {
    yearPeriod: await db.fiscalPeriod.findUniqueOrThrow({
      where: { id: yearPeriod.id },
    }),
    closeJournal,
    openingJournal,
    netIncome: net,
  };
}
