import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { toNumber } from "@/modules/sales/invoice-utils";

type Db = PrismaClient | Prisma.TransactionClient;

export type PosZReport = {
  sessionId: string;
  siteId: string;
  openedAt: string;
  openingFloat: number;
  closingCash: number | null;
  expectedCash: number;
  cashVariance: number | null;
  tenderTotals: Array<{ method: string; count: number; amount: number }>;
  invoiceCount: number;
  grossTotal: number;
};

/** Build Z-report totals from InvoicePayment rows on a POS session. */
export async function buildPosSessionZReport(
  db: Db,
  input: { tenantId: string; sessionId: string },
): Promise<PosZReport | null> {
  const session = await db.posSession.findFirst({
    where: { id: input.sessionId, tenantId: input.tenantId },
  });
  if (!session) return null;

  const payments = await db.invoicePayment.findMany({
    where: { tenantId: input.tenantId, posSessionId: session.id },
    select: {
      amount: true,
      method: true,
      invoiceId: true,
      paymentMethod: { select: { code: true, kind: true } },
    },
  });

  const byMethod = new Map<string, { count: number; amount: number }>();
  let cashTotal = 0;
  const invoiceIds = new Set<string>();
  let grossTotal = 0;

  for (const p of payments) {
    const code = p.paymentMethod?.code || p.method || "OTHER";
    const kind = p.paymentMethod?.kind || p.method || "OTHER";
    const amount = toNumber(p.amount);
    const row = byMethod.get(code) ?? { count: 0, amount: 0 };
    row.count += 1;
    row.amount = Math.round((row.amount + amount) * 100) / 100;
    byMethod.set(code, row);
    if (kind === "CASH" || code === "CASH") {
      cashTotal = Math.round((cashTotal + amount) * 100) / 100;
    }
    invoiceIds.add(p.invoiceId);
    grossTotal = Math.round((grossTotal + amount) * 100) / 100;
  }

  const openingFloat = toNumber(session.openingFloat);
  const expectedCash = Math.round((openingFloat + cashTotal) * 100) / 100;
  const closingCash =
    session.closingCash != null ? toNumber(session.closingCash) : null;
  const cashVariance =
    closingCash != null
      ? Math.round((closingCash - expectedCash) * 100) / 100
      : null;

  return {
    sessionId: session.id,
    siteId: session.siteId,
    openedAt: session.openedAt.toISOString(),
    openingFloat,
    closingCash,
    expectedCash,
    cashVariance,
    tenderTotals: [...byMethod.entries()]
      .map(([method, v]) => ({ method, count: v.count, amount: v.amount }))
      .sort((a, b) => a.method.localeCompare(b.method)),
    invoiceCount: invoiceIds.size,
    grossTotal,
  };
}

export type { Prisma };
