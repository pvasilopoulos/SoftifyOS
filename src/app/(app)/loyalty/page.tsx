import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Settings2 } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import {
  ensureLoyaltyProgram,
  getLoyaltyRules,
} from "@/modules/loyalty/service";
import { pointsToEur } from "@/modules/loyalty/rules";
import { LoyaltyAccountsClient } from "./loyalty-accounts-client";

export const metadata = { title: "Loyalty" };
export const dynamic = "force-dynamic";

export default async function LoyaltyPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  await ensureLoyaltyProgram(prisma, session.tenantId);
  const rules = await getLoyaltyRules(prisma, session.tenantId);

  const accounts = await prisma.loyaltyAccount.findMany({
    where: { tenantId: session.tenantId },
    orderBy: [{ updatedAt: "desc" }],
    take: 100,
    include: {
      customer: {
        select: { id: true, code: true, name: true, email: true },
      },
    },
  });

  const customersWithout = await prisma.customer.findMany({
    where: {
      tenantId: session.tenantId,
      status: "ACTIVE",
      loyaltyAccounts: { none: {} },
    },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, code: true, name: true },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Loyalty"
        description={`Κέρδος ${rules.earnPointsPerEur} πτ./€ · εξαργύρωση ${rules.redeemPointsPerEur} πτ. = 1 €`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/loyalty/program"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-ink-900 hover:bg-slate-50"
            >
              <Settings2 size={16} />
              Πρόγραμμα
            </Link>
            <Link
              href="/loyalty#open"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
            >
              <Plus size={16} />
              Νέος λογαριασμός
            </Link>
          </div>
        }
      />
      <LoyaltyAccountsClient
        canWrite={session.role !== "VIEWER"}
        customersWithout={customersWithout}
        initialItems={accounts.map((a) => ({
          id: a.id,
          pointsBalance: a.pointsBalance,
          balanceEur: pointsToEur(a.pointsBalance, rules),
          tier: a.tier,
          isActive: a.isActive,
          customer: a.customer,
          updatedAt: a.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
