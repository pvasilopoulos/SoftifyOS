import type { PrismaClient } from "@/generated/prisma/client";
import { toNumber } from "@/modules/sales/invoice-utils";

export type BankMatchSuggestion = {
  kind: "AR" | "AP";
  id: string;
  number: string;
  party: string;
  balance: number;
  score: number;
  reason: string;
};

function scoreCandidate(input: {
  lineAmount: number;
  balance: number;
  haystack: string;
  needle: string;
}): { score: number; reason: string } {
  const absLine = Math.abs(input.lineAmount);
  const delta = Math.abs(absLine - input.balance);
  let score = 0;
  const reasons: string[] = [];

  if (delta < 0.02) {
    score += 80;
    reasons.push("ακριβές ποσό");
  } else if (delta <= absLine * 0.02 + 0.5) {
    score += 45;
    reasons.push("κοντινό ποσό");
  } else if (input.balance > 0 && input.balance <= absLine) {
    score += 20;
    reasons.push("μερική κάλυψη");
  }

  const n = input.needle.toLowerCase();
  const h = input.haystack.toLowerCase();
  if (n && h.includes(n)) {
    score += 35;
    reasons.push("αναφορά");
  } else {
    const tokens = n.split(/[^a-z0-9α-ωάέήίόύώ]+/i).filter((t) => t.length >= 4);
    const hit = tokens.find((t) => h.includes(t));
    if (hit) {
      score += 20;
      reasons.push(`λέξη «${hit}»`);
    }
  }

  return { score, reason: reasons.join(" · ") || "υποψήφιο" };
}

/** Rank open AR/AP docs against a bank line for reconciliation assist. */
export async function suggestBankMatches(
  db: PrismaClient,
  input: {
    tenantId: string;
    amount: number;
    description: string;
    reference: string | null;
    counterparty: string | null;
    legalEntityId?: string | null;
    limit?: number;
  },
): Promise<BankMatchSuggestion[]> {
  const limit = input.limit ?? 8;
  const needle = [input.reference, input.counterparty, input.description]
    .filter(Boolean)
    .join(" ");

  const suggestions: BankMatchSuggestion[] = [];

  if (input.amount > 0) {
    const invoices = await db.invoice.findMany({
      where: {
        tenantId: input.tenantId,
        status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
        ...(input.legalEntityId
          ? { legalEntityId: input.legalEntityId }
          : {}),
      },
      take: 80,
      orderBy: { issuedAt: "desc" },
      include: {
        customer: { select: { name: true, code: true } },
        series: { select: { allowBankMatch: true } },
      },
    });
    for (const inv of invoices) {
      if (inv.series && inv.series.allowBankMatch === false) continue;
      const balance = Math.max(
        0,
        toNumber(inv.total) - toNumber(inv.paidAmount),
      );
      if (balance <= 0) continue;
      const { score, reason } = scoreCandidate({
        lineAmount: input.amount,
        balance,
        haystack: `${inv.number} ${inv.customer.name} ${inv.customer.code}`,
        needle,
      });
      if (score < 20) continue;
      suggestions.push({
        kind: "AR",
        id: inv.id,
        number: inv.number,
        party: inv.customer.name,
        balance,
        score,
        reason,
      });
    }
  } else if (input.amount < 0) {
    const pis = await db.purchaseInvoice.findMany({
      where: {
        tenantId: input.tenantId,
        status: { in: ["POSTED", "PARTIAL"] },
        ...(input.legalEntityId
          ? { legalEntityId: input.legalEntityId }
          : {}),
      },
      take: 80,
      orderBy: { issueDate: "desc" },
      include: {
        supplier: { select: { name: true, code: true } },
      },
    });
    for (const pi of pis) {
      const balance = Math.max(
        0,
        toNumber(pi.total) - toNumber(pi.paidAmount),
      );
      if (balance <= 0) continue;
      const { score, reason } = scoreCandidate({
        lineAmount: input.amount,
        balance,
        haystack: `${pi.number} ${pi.supplier.name} ${pi.supplier.code}`,
        needle,
      });
      if (score < 20) continue;
      suggestions.push({
        kind: "AP",
        id: pi.id,
        number: pi.number,
        party: pi.supplier.name,
        balance,
        score,
        reason,
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}
