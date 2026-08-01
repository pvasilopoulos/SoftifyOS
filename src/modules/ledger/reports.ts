import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ensureChartOfAccounts, round2 } from "./service";

type Db = PrismaClient | Prisma.TransactionClient;

function toNum(v: unknown) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v);
}

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  reportGroup: string | null;
  debit: number;
  credit: number;
  balance: number;
};

export async function loadTrialBalance(
  db: Db,
  tenantId: string,
  opts?: {
    from?: Date | null;
    to?: Date | null;
    legalEntityId?: string | null;
    includeOpening?: boolean;
  },
): Promise<TrialBalanceRow[]> {
  await ensureChartOfAccounts(db, tenantId);

  const lines = await db.journalLine.findMany({
    where: {
      tenantId,
      ...(opts?.legalEntityId
        ? { legalEntityId: opts.legalEntityId }
        : {}),
      journalEntry: {
        tenantId,
        status: "POSTED",
        ...(opts?.includeOpening === false ? { isOpening: false } : {}),
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
      debit: true,
      credit: true,
      glAccount: {
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          reportGroup: true,
        },
      },
    },
  });

  const map = new Map<string, TrialBalanceRow>();
  for (const l of lines) {
    const key = l.glAccount.id;
    const cur = map.get(key) ?? {
      accountId: l.glAccount.id,
      code: l.glAccount.code,
      name: l.glAccount.name,
      type: l.glAccount.type,
      reportGroup: l.glAccount.reportGroup,
      debit: 0,
      credit: 0,
      balance: 0,
    };
    cur.debit = round2(cur.debit + toNum(l.debit));
    cur.credit = round2(cur.credit + toNum(l.credit));
    map.set(key, cur);
  }

  return [...map.values()]
    .map((r) => ({
      ...r,
      balance: round2(r.debit - r.credit),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, "el"));
}

export async function loadAccountCard(
  db: Db,
  tenantId: string,
  accountId: string,
  opts?: { from?: Date | null; to?: Date | null },
) {
  const account = await db.glAccount.findFirst({
    where: { id: accountId, tenantId },
  });
  if (!account) return null;

  const lines = await db.journalLine.findMany({
    where: {
      tenantId,
      glAccountId: accountId,
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
    include: {
      journalEntry: {
        select: {
          id: true,
          number: true,
          entryDate: true,
          description: true,
          sourceType: true,
        },
      },
      costCenter: { select: { code: true, name: true } },
    },
    orderBy: [
      { journalEntry: { entryDate: "asc" } },
      { lineNo: "asc" },
    ],
  });

  let running = 0;
  const movements = lines.map((l) => {
    const debit = toNum(l.debit);
    const credit = toNum(l.credit);
    running = round2(running + debit - credit);
    return {
      id: l.id,
      journalId: l.journalEntry.id,
      number: l.journalEntry.number,
      entryDate: l.journalEntry.entryDate,
      description: l.journalEntry.description,
      sourceType: l.journalEntry.sourceType,
      memo: l.memo,
      debit,
      credit,
      balance: running,
      costCenter: l.costCenter,
    };
  });

  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
    },
    movements,
    totals: {
      debit: round2(movements.reduce((s, m) => s + m.debit, 0)),
      credit: round2(movements.reduce((s, m) => s + m.credit, 0)),
      balance: running,
    },
  };
}

export async function loadProfitAndLoss(
  db: Db,
  tenantId: string,
  opts?: { from?: Date | null; to?: Date | null; legalEntityId?: string | null },
) {
  const rows = await loadTrialBalance(db, tenantId, {
    ...opts,
    includeOpening: false,
  });
  const revenue = rows.filter(
    (r) => r.type === "REVENUE" || r.reportGroup === "PL_REVENUE",
  );
  const expense = rows.filter(
    (r) =>
      r.type === "EXPENSE" ||
      r.reportGroup === "PL_EXPENSE" ||
      r.reportGroup === "PL_COGS",
  );
  const revenueTotal = round2(
    revenue.reduce((s, r) => s + (r.credit - r.debit), 0),
  );
  const expenseTotal = round2(
    expense.reduce((s, r) => s + (r.debit - r.credit), 0),
  );
  return {
    revenue,
    expense,
    revenueTotal,
    expenseTotal,
    netIncome: round2(revenueTotal - expenseTotal),
  };
}

export async function loadBalanceSheet(
  db: Db,
  tenantId: string,
  opts?: { asOf?: Date | null; legalEntityId?: string | null },
) {
  const rows = await loadTrialBalance(db, tenantId, {
    to: opts?.asOf ?? null,
    legalEntityId: opts?.legalEntityId,
    includeOpening: true,
  });
  const pl = await loadProfitAndLoss(db, tenantId, {
    to: opts?.asOf ?? null,
    legalEntityId: opts?.legalEntityId,
  });

  const assets = rows.filter(
    (r) => r.type === "ASSET" || r.reportGroup === "BS_ASSET",
  );
  const liabilities = rows.filter(
    (r) => r.type === "LIABILITY" || r.reportGroup === "BS_LIABILITY",
  );
  const equity = rows.filter(
    (r) => r.type === "EQUITY" || r.reportGroup === "BS_EQUITY",
  );

  const assetTotal = round2(assets.reduce((s, r) => s + r.balance, 0));
  const liabilityTotal = round2(
    liabilities.reduce((s, r) => s + (r.credit - r.debit), 0),
  );
  const equityTotal = round2(
    equity.reduce((s, r) => s + (r.credit - r.debit), 0) + pl.netIncome,
  );

  return {
    assets,
    liabilities,
    equity,
    netIncome: pl.netIncome,
    assetTotal,
    liabilityTotal,
    equityTotal,
    balanced: Math.abs(assetTotal - (liabilityTotal + equityTotal)) < 0.02,
  };
}

/** Multi-entity consolidation: per-entity + group totals */
export async function loadConsolidationTrialBalance(
  db: Db,
  tenantId: string,
  opts?: { from?: Date | null; to?: Date | null },
) {
  const entities = await db.legalEntity.findMany({
    where: { tenantId, isActive: true },
    orderBy: { code: "asc" },
  });
  const byEntity = await Promise.all(
    entities.map(async (e) => ({
      entity: {
        id: e.id,
        code: e.code,
        name: e.name,
        isDefault: e.isDefault,
      },
      rows: await loadTrialBalance(db, tenantId, {
        ...opts,
        legalEntityId: e.id,
      }),
    })),
  );
  const consolidated = await loadTrialBalance(db, tenantId, opts);
  return { entities: byEntity, consolidated };
}
