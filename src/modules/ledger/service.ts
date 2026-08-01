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

export function round2(n: number) {
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
        reportGroup: row.reportGroup ?? null,
        isPostable: row.isPostable ?? true,
        isSystem: true,
        isActive: true,
      },
      update: {
        reportGroup: row.reportGroup ?? undefined,
      },
    });
  }
}

/** Ensure calendar year + 12 monthly periods exist */
export async function ensureCurrentFiscalYear(db: Db, tenantId: string) {
  const year = new Date().getFullYear();
  const code = String(year);
  const yearPeriod = await db.fiscalPeriod.upsert({
    where: { tenantId_code: { tenantId, code } },
    create: {
      tenantId,
      code,
      name: `Χρήση ${year}`,
      year,
      kind: "YEAR",
      startsAt: new Date(`${year}-01-01T00:00:00.000Z`),
      endsAt: new Date(`${year}-12-31T23:59:59.999Z`),
      status: "OPEN",
    },
    update: {},
  });

  for (let month = 1; month <= 12; month++) {
    const mCode = `${year}-${String(month).padStart(2, "0")}`;
    const startsAt = new Date(Date.UTC(year, month - 1, 1));
    const endsAt = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    await db.fiscalPeriod.upsert({
      where: { tenantId_code: { tenantId, code: mCode } },
      create: {
        tenantId,
        code: mCode,
        name: `${month}/${year}`,
        year,
        month,
        kind: "MONTH",
        startsAt,
        endsAt,
        status: "OPEN",
      },
      update: {},
    });
  }

  return yearPeriod;
}

export async function resolveOpenPeriodForDate(
  db: Db,
  tenantId: string,
  entryDate: Date,
) {
  await ensureCurrentFiscalYear(db, tenantId);
  const month = entryDate.getUTCMonth() + 1;
  const year = entryDate.getUTCFullYear();
  const mCode = `${year}-${String(month).padStart(2, "0")}`;
  const monthly = await db.fiscalPeriod.findUnique({
    where: { tenantId_code: { tenantId, code: mCode } },
  });
  if (monthly) {
    if (monthly.status !== "OPEN") {
      throw new LedgerError(`Η περίοδος ${monthly.code} είναι κλειστή`, 409);
    }
    return monthly;
  }
  const yearly = await db.fiscalPeriod.findUnique({
    where: { tenantId_code: { tenantId, code: String(year) } },
  });
  if (!yearly || yearly.status !== "OPEN") {
    throw new LedgerError("Η λογιστική χρήση είναι κλειστή", 409);
  }
  return yearly;
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
  costCenterId?: string | null;
  legalEntityId?: string | null;
};

function normalizeLines(lines: JournalLineInput[]) {
  const normalized = lines
    .map((l) => ({
      glAccountId: l.glAccountId,
      debit: round2(Math.max(0, l.debit ?? 0)),
      credit: round2(Math.max(0, l.credit ?? 0)),
      memo: l.memo ?? null,
      costCenterId: l.costCenterId ?? null,
      legalEntityId: l.legalEntityId ?? null,
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);

  if (normalized.length < 2) {
    throw new LedgerError("Απαιτούνται τουλάχιστον 2 γραμμές ημερολογίου");
  }
  for (const l of normalized) {
    if (l.debit > 0 && l.credit > 0) {
      throw new LedgerError("Κάθε γραμμή έχει είτε χρέωση είτε πίστωση");
    }
  }
  const debitSum = round2(normalized.reduce((s, l) => s + l.debit, 0));
  const creditSum = round2(normalized.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(debitSum - creditSum) > 0.001) {
    throw new LedgerError(
      `Μη ισοσκελισμένο άρθρο (Χρέωση ${debitSum.toFixed(2)} ≠ Πίστωση ${creditSum.toFixed(2)})`,
    );
  }
  return normalized;
}

async function assertPostableAccounts(
  db: Db,
  tenantId: string,
  lines: ReturnType<typeof normalizeLines>,
) {
  const accountIds = [...new Set(lines.map((l) => l.glAccountId))];
  const accounts = await db.glAccount.findMany({
    where: {
      tenantId,
      id: { in: accountIds },
      isActive: true,
      isPostable: true,
    },
    select: { id: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new LedgerError("Μη έγκυρος ή μη-postable λογαριασμός");
  }
}

const journalInclude = {
  lines: {
    include: {
      glAccount: { select: { id: true, code: true, name: true, type: true } },
      costCenter: { select: { id: true, code: true, name: true } },
      legalEntity: { select: { id: true, code: true, name: true } },
    },
    orderBy: { lineNo: "asc" as const },
  },
  fiscalPeriod: { select: { id: true, code: true, name: true, status: true } },
};

export async function createJournal(
  db: Db,
  input: {
    tenantId: string;
    description?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    createdByUserId?: string | null;
    entryDate?: Date | null;
    isOpening?: boolean;
    post?: boolean;
    lines: JournalLineInput[];
  },
) {
  const lines = normalizeLines(input.lines);
  await assertPostableAccounts(db, input.tenantId, lines);

  const entryDate = input.entryDate ?? new Date();
  const period = await resolveOpenPeriodForDate(db, input.tenantId, entryDate);
  const number = await nextJournalNumber(db, input.tenantId);
  const post = input.post !== false;
  const now = new Date();

  return db.journalEntry.create({
    data: {
      tenantId: input.tenantId,
      number,
      status: post ? "POSTED" : "DRAFT",
      description: input.description ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      fiscalPeriodId: period.id,
      entryDate,
      isOpening: !!input.isOpening,
      postedAt: post ? now : null,
      createdByUserId: input.createdByUserId ?? null,
      lines: {
        create: lines.map((l, i) => ({
          tenantId: input.tenantId,
          glAccountId: l.glAccountId,
          costCenterId: l.costCenterId,
          legalEntityId: l.legalEntityId,
          lineNo: i + 1,
          memo: l.memo,
          debit: l.debit,
          credit: l.credit,
        })),
      },
    },
    include: journalInclude,
  });
}

/** Backward-compatible: always posts */
export async function createAndPostJournal(
  db: Db,
  input: {
    tenantId: string;
    description?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    createdByUserId?: string | null;
    entryDate?: Date | null;
    isOpening?: boolean;
    lines: JournalLineInput[];
  },
) {
  return createJournal(db, { ...input, post: true });
}

export async function postJournal(
  db: Db,
  tenantId: string,
  journalId: string,
) {
  const journal = await db.journalEntry.findFirst({
    where: { id: journalId, tenantId },
    include: { lines: true },
  });
  if (!journal) throw new LedgerError("Άρθρο δεν βρέθηκε", 404);
  if (journal.status !== "DRAFT") {
    throw new LedgerError("Μόνο πρόχειρα άρθρα οριστικοποιούνται");
  }
  const entryDate = journal.entryDate;
  await resolveOpenPeriodForDate(db, tenantId, entryDate);
  return db.journalEntry.update({
    where: { id: journal.id },
    data: { status: "POSTED", postedAt: new Date() },
    include: journalInclude,
  });
}

export async function voidJournal(
  db: Db,
  tenantId: string,
  journalId: string,
) {
  const journal = await db.journalEntry.findFirst({
    where: { id: journalId, tenantId },
  });
  if (!journal) throw new LedgerError("Άρθρο δεν βρέθηκε", 404);
  if (journal.status === "VOID") {
    throw new LedgerError("Το άρθρο είναι ήδη άκυρο");
  }
  if (journal.status === "POSTED") {
    throw new LedgerError(
      "Οριστικοποιημένο άρθρο ακυρώνεται με αντιστροφή (reverse)",
    );
  }
  return db.journalEntry.update({
    where: { id: journal.id },
    data: { status: "VOID", voidedAt: new Date() },
    include: journalInclude,
  });
}

/** Create reversing posted journal and link both ways */
export async function reverseJournal(
  db: Db,
  input: {
    tenantId: string;
    journalId: string;
    createdByUserId?: string | null;
    description?: string | null;
  },
) {
  const original = await db.journalEntry.findFirst({
    where: { id: input.journalId, tenantId: input.tenantId },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!original) throw new LedgerError("Άρθρο δεν βρέθηκε", 404);
  if (original.status !== "POSTED") {
    throw new LedgerError("Μόνο οριστικοποιημένα άρθρα αντιστρέφονται");
  }
  const existingReverse = await db.journalEntry.findFirst({
    where: { tenantId: input.tenantId, reversesId: original.id },
  });
  if (existingReverse) {
    throw new LedgerError("Το άρθρο έχει ήδη αντιστραφεί");
  }

  const reverse = await createAndPostJournal(db, {
    tenantId: input.tenantId,
    description:
      input.description ?? `Αντιστροφή ${original.number}`,
    sourceType: "journal.reverse",
    sourceId: original.id,
    createdByUserId: input.createdByUserId,
    lines: original.lines.map((l) => ({
      glAccountId: l.glAccountId,
      debit: Number(l.credit),
      credit: Number(l.debit),
      memo: l.memo,
      costCenterId: l.costCenterId,
      legalEntityId: l.legalEntityId,
    })),
  });

  await db.journalEntry.update({
    where: { id: reverse.id },
    data: { reversesId: original.id },
  });

  return db.journalEntry.findUniqueOrThrow({
    where: { id: reverse.id },
    include: journalInclude,
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

/** Find existing posted journal for source to keep posting idempotent */
export async function findPostedBySource(
  db: Db,
  tenantId: string,
  sourceType: string,
  sourceId: string,
) {
  return db.journalEntry.findFirst({
    where: {
      tenantId,
      sourceType,
      sourceId,
      status: "POSTED",
      reversesId: null,
    },
    orderBy: { postedAt: "desc" },
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
  const existing = await findPostedBySource(
    db,
    input.tenantId,
    "invoice.issue",
    input.invoiceId,
  );
  if (existing) return existing;

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
    paymentId?: string | null;
    glCashAccount?: string | null;
    glArAccount?: string | null;
    userId?: string | null;
  },
) {
  if (input.amount <= 0) return null;
  const sourceId = input.paymentId ?? input.invoiceId;
  const sourceType = input.paymentId
    ? "invoice.collect.payment"
    : "invoice.collect";
  const existing = await findPostedBySource(
    db,
    input.tenantId,
    sourceType,
    sourceId,
  );
  if (existing) return existing;

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
    sourceType,
    sourceId,
    createdByUserId: input.userId,
    lines: [
      { glAccountId: cash.id, debit: input.amount, memo: "Ταμείο / Τράπεζα" },
      { glAccountId: ar.id, credit: input.amount, memo: "Πελάτες" },
    ],
  });
}

export async function tryPostPurchaseInvoice(
  db: Db,
  input: {
    tenantId: string;
    purchaseInvoiceId: string;
    number: string;
    netAmount: number;
    vatAmount: number;
    total: number;
    expenseAccountCode?: string | null;
    apAccountCode?: string | null;
    vatAccountCode?: string | null;
    userId?: string | null;
    costCenterId?: string | null;
    legalEntityId?: string | null;
  },
) {
  const existing = await findPostedBySource(
    db,
    input.tenantId,
    "purchase_invoice.post",
    input.purchaseInvoiceId,
  );
  if (existing) return existing;

  const expense = await findAccountByCode(
    db,
    input.tenantId,
    input.expenseAccountCode ?? "64.00.00",
  );
  const ap = await findAccountByCode(
    db,
    input.tenantId,
    input.apAccountCode ?? "50.00.00",
  );
  const vat = await findAccountByCode(
    db,
    input.tenantId,
    input.vatAccountCode ?? "54.00.01",
  );
  if (!expense || !ap) return null;

  const lines: JournalLineInput[] = [
    {
      glAccountId: expense.id,
      debit: input.netAmount,
      memo: "Αγορές / έξοδα",
      costCenterId: input.costCenterId,
      legalEntityId: input.legalEntityId,
    },
  ];
  if (vat && input.vatAmount > 0) {
    lines.push({
      glAccountId: vat.id,
      debit: input.vatAmount,
      memo: "ΦΠΑ εισροών",
      legalEntityId: input.legalEntityId,
    });
  }
  lines.push({
    glAccountId: ap.id,
    credit: input.total,
    memo: "Προμηθευτές",
    legalEntityId: input.legalEntityId,
  });

  return createAndPostJournal(db, {
    tenantId: input.tenantId,
    description: `Τιμολόγιο αγοράς ${input.number}`,
    sourceType: "purchase_invoice.post",
    sourceId: input.purchaseInvoiceId,
    createdByUserId: input.userId,
    lines,
  });
}
