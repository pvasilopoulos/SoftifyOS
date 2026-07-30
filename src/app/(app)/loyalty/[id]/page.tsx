import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { getLoyaltyRules } from "@/modules/loyalty/service";
import { pointsToEur } from "@/modules/loyalty/rules";
import { loyaltyTierLabel } from "@/modules/loyalty/labels";
import { LoyaltyDetailClient } from "./loyalty-detail-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await prisma.loyaltyAccount.findFirst({
    where: { id },
    include: { customer: { select: { name: true } } },
  });
  return { title: account ? `Loyalty · ${account.customer.name}` : "Loyalty" };
}

export default async function LoyaltyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const rules = await getLoyaltyRules(prisma, session.tenantId);
  const account = await prisma.loyaltyAccount.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      customer: {
        select: { id: true, code: true, name: true, email: true },
      },
      ledger: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!account) notFound();

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/loyalty"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Loyalty
        </Link>
        <PageHeader
          title={account.customer.name}
          description={`${account.customer.code} · ${loyaltyTierLabel[account.tier as keyof typeof loyaltyTierLabel] ?? account.tier}`}
          actions={
            <Badge tone={account.isActive ? "emerald" : "slate"}>
              {account.isActive ? "Ενεργός" : "Ανενεργός"}
            </Badge>
          }
        />
      </div>
      <LoyaltyDetailClient
        canWrite={session.role !== "VIEWER"}
        rules={rules}
        initial={{
          id: account.id,
          pointsBalance: account.pointsBalance,
          balanceEur: pointsToEur(account.pointsBalance, rules),
          tier: account.tier,
          isActive: account.isActive,
          customer: account.customer,
          ledger: account.ledger.map((l) => ({
            id: l.id,
            kind: l.kind,
            points: l.points,
            invoiceId: l.invoiceId,
            note: l.note,
            createdAt: l.createdAt.toISOString(),
          })),
        }}
      />
    </div>
  );
}
