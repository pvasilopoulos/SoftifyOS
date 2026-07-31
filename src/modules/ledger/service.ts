import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_GL_ACCOUNTS } from "./defaults";

type Db = PrismaClient | Prisma.TransactionClient;

export class LedgerError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function ensureChartOfAccounts(db: Db, tenantId: string) {
  for (const row of DEFAULT_GL_ACCOUNTS) {
    await db.glAccount.upsert({
      where: { tenantId_code: { tenantId, code: row.code } },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        type: row.type,
        isPostable: row.isPostable ?? true,
        isSystem: true,
        isActive: true,
      },
      update: {},
    });
  }
}

export async function ensureCurrentFiscalYear(db: Db, tenantId: string) {
  const year = new Date().getFullYear();
  const code = String(year);
  return db.fiscalPeriod.upsert({
    where: { tenantId_code: { tenantId, code } },
    create: {
      tenantId,
      code,
      name: `Χρήση ${year}`,
      year,
      startsAt: new Date(`${year}-01-01T00:00:00.000Z`),
      endsAt: new Date(`${year}-12-31T23:59:59.999Z`),
      status: "OPEN",
    },
    update: {},
  });
}

export async function listGlAccounts(
  db: Db,
  tenantId: string,
  opts?: { activeOnly?: boolean; postableOnly?: boolean },
) {
  await ensureChartOfAccounts(db, tenantId);
  return db.glAccount.findMany({
    where: {
      tenantId,
      ...(opts?.activeOnly ? { isActive: true } : {}),
      ...(opts?.postableOnly ? { isPostable: true, isActive: true } : {}),
    },
    orderBy: { code: "asc" },
  });
}

export async function nextJournalNumber(db: Db, tenantId: string) {
  const year = new Date().getFullYear();
  const prefix = `ΗΜ-${year}-`;
  const last = await db.journalEntry.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const seq = last
    ? Number(last.number.slice(prefix.length)) + 1 || 1
    : 1;
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

export type JournalLineInput = {
  glAccountId: string;
  debit?: number;
  credit?: number;
  memo?: string | null;
};

export async function createAndPostJournal(
  db: Db,
  input: {
    tenantId: string;
    description?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    createdByUserId?: string | null;
    lines: JournalLineInput[];
  },
) {
  const lines = input.lines
    .map((l) => ({
      glAccountId: l.glAccountId,
      debit: round2(Math.max(0, l.debit ?? 0)),
      credit: round2(Math.max(0, l.credit ?? 0)),
      memo: l.memo ?? null,
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);

  if (lines.length < 2) {
    throw new LedgerError("Απαιτούνται τουλάχιστον 2 γραμμές ημερολογίου");
  }

  for (const l of lines) {
    if (l.debit > 0 && l.credit > 0) {
      throw new LedgerError("Κάθε γραμμή έχει είτε χρέωση είτε πίστωση");
    }
  }

  const debitSum = round2(lines.reduce((s, l) => s + l.debit, 0));
  const creditSum = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(debitSum - creditSum) > 0.001) {
    throw new LedgerError(
      `Μη ισοσκελισμένο άρθρο (Χρέωση ${debitSum.toFixed(2)} ≠ Πίστωση ${creditSum.toFixed(2)})`,
    );
  }

  const accountIds = [...new Set(lines.map((l) => l.glAccountId))];
  const accounts = await db.glAccount.findMany({
    where: {
      tenantId: input.tenantId,
      id: { in: accountIds },
      isActive: true,
      isPostable: true,
    },
    select: { id: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new LedgerError("Μη έγκυρος ή μη-postable λογαριασμός");
  }

  const period = await ensureCurrentFiscalYear(db, input.tenantId);
  if (period.status !== "OPEN") {
    throw new LedgerError("Η λογιστική χρήση είναι κλειστή", 409);
  }

  const number = await nextJournalNumber(db, input.tenantId);
  const now = new Date();

  return db.journalEntry.create({
    data: {
      tenantId: input.tenantId,
      number,
      status: "POSTED",
      description: input.description ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      fiscalPeriodId: period.id,
      postedAt: now,
      createdByUserId: input.createdByUserId ?? null,
      lines: {
        create: lines.map((l, i) => ({
          tenantId: input.tenantId,
          glAccountId: l.glAccountId,
          lineNo: i + 1,
          memo: l.memo,
          debit: l.debit,
          credit: l.credit,
        })),
      },
    },
    include: {
      lines: {
        include: { glAccount: { select: { id: true, code: true, name: true } } },
        orderBy: { lineNo: "asc" },
      },
    },
  });
}

export async function findAccountByCode(
  db: Db,
  tenantId: string,
  code: string | null | undefined,
) {
  if (!code) return null;
  await ensureChartOfAccounts(db, tenantId);
  return db.glAccount.findFirst({
    where: { tenantId, code, isActive: true },
  });
}

/** Best-effort invoice issue posting from series GL string codes */
export async function tryPostInvoiceIssue(
  db: Db,
  input: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    total: number;
    vatAmount: number;
    glDebitAccount?: string | null;
    glCreditAccount?: string | null;
    glVatAccount?: string | null;
    userId?: string | null;
  },
) {
  const debit = await findAccountByCode(db, input.tenantId, input.glDebitAccount);
  const credit = await findAccountByCode(
    db,
    input.tenantId,
    input.glCreditAccount,
  );
  const vat = await findAccountByCode(db, input.tenantId, input.glVatAccount);
  if (!debit || !credit) return null;

  const net = round2(input.total - input.vatAmount);
  const lines: JournalLineInput[] = [
    { glAccountId: debit.id, debit: input.total, memo: "Πελάτες" },
    { glAccountId: credit.id, credit: net, memo: "Πωλήσεις" },
  ];
  if (vat && input.vatAmount > 0) {
    lines.push({
      glAccountId: vat.id,
      credit: input.vatAmount,
      memo: "ΦΠΑ",
    });
  } else if (input.vatAmount > 0) {
    // fold VAT into revenue if no VAT account
    lines[1]!.credit = input.total;
  }

  return createAndPostJournal(db, {
    tenantId: input.tenantId,
    description: `Έκδοση ${input.invoiceNumber}`,
    sourceType: "invoice.issue",
    sourceId: input.invoiceId,
    createdByUserId: input.userId,
    lines,
  });
}

/** Best-effort cash collection: Dr Cash / Cr AR */
export async function tryPostInvoiceCollect(
  db: Db,
  input: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    amount: number;
    glCashAccount?: string | null;
    glArAccount?: string | null;
    userId?: string | null;
  },
) {
  if (input.amount <= 0) return null;
  const cash = await findAccountByCode(
    db,
    input.tenantId,
    input.glCashAccount ?? "38.00.00",
  );
  const ar = await findAccountByCode(
    db,
    input.tenantId,
    input.glArAccount ?? "30.00.00",
  );
  if (!cash || !ar) return null;

  return createAndPostJournal(db, {
    tenantId: input.tenantId,
    description: `Είσπραξη ${input.invoiceNumber}`,
    sourceType: "invoice.collect",
    sourceId: input.invoiceId,
    createdByUserId: input.userId,
    lines: [
      { glAccountId: cash.id, debit: input.amount, memo: "Ταμείο / Τράπεζα" },
      { glAccountId: ar.id, credit: input.amount, memo: "Πελάτες" },
    ],
  });
}
