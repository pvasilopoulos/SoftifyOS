import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { ensureChartOfAccounts, ensureCurrentFiscalYear } from "@/modules/ledger/service";
import { toNumber } from "@/modules/sales/invoice-utils";
import { FinanceJournalClient } from "./finance-journal-client";

export const metadata = { title: "Οικονομικά" };
export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  await ensureChartOfAccounts(prisma, session.tenantId);
  const period = await ensureCurrentFiscalYear(prisma, session.tenantId);

  const [journals, accountCount] = await Promise.all([
    prisma.journalEntry.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      include: {
        lines: {
          include: { glAccount: { select: { code: true, name: true } } },
          orderBy: { lineNo: "asc" },
        },
      },
    }),
    prisma.glAccount.count({ where: { tenantId: session.tenantId, isActive: true } }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Οικονομικά"
        description="Γενική λογιστική · ημερολόγιο άρθρων και λογιστικό σχέδιο."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/settings/gl-accounts"
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-ink-900 hover:bg-slate-50"
            >
              Λογιστικό σχέδιο ({accountCount})
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="teal">Χρήση {period.code}</Badge>
        <Badge tone={period.status === "OPEN" ? "emerald" : "rose"}>
          {period.status === "OPEN" ? "Ανοιχτή" : "Κλειστή"}
        </Badge>
      </div>

      <FinanceJournalClient
        initialJournals={journals.map((j) => ({
          id: j.id,
          number: j.number,
          status: j.status,
          description: j.description,
          sourceType: j.sourceType,
          postedAt: j.postedAt?.toISOString() ?? null,
          createdAt: j.createdAt.toISOString(),
          lines: j.lines.map((l) => ({
            id: l.id,
            memo: l.memo,
            debit: toNumber(l.debit),
            credit: toNumber(l.credit),
            accountCode: l.glAccount.code,
            accountName: l.glAccount.name,
          })),
        }))}
        canWrite={session.role !== "VIEWER"}
      />
    </div>
  );
}
