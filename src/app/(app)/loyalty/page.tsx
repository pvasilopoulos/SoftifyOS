import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import {
  ensureLoyaltyProgram,
  getLoyaltyRules,
} from "@/modules/loyalty/service";
import { pointsToEur } from "@/modules/loyalty/rules";
import { LoyaltyAccountsClient } from "./loyalty-accounts-client";

export const metadata = { title: "Loyalty" };
export const dynamic = "force-dynamic";

export default async function LoyaltyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { tab: tabParam } = await searchParams;
  const canManageProgram =
    session.role === "OWNER" || session.role === "ADMIN";
  const initialTab =
    tabParam === "program" && canManageProgram ? "program" : "accounts";

  const program = await ensureLoyaltyProgram(prisma, session.tenantId);
  const rules = await getLoyaltyRules(prisma, session.tenantId);

  const [accounts, allForStats, activeCount, customersWithout] =
    await Promise.all([
      prisma.loyaltyAccount.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ updatedAt: "desc" }],
        take: 50,
        include: {
          customer: {
            select: { id: true, code: true, name: true, email: true },
          },
        },
      }),
      prisma.loyaltyAccount.findMany({
        where: { tenantId: session.tenantId },
        select: { pointsBalance: true, tier: true, isActive: true },
      }),
      prisma.loyaltyAccount.count({
        where: { tenantId: session.tenantId, isActive: true },
      }),
      prisma.customer.findMany({
        where: {
          tenantId: session.tenantId,
          status: "ACTIVE",
          loyaltyAccounts: { none: {} },
        },
        orderBy: { name: "asc" },
        take: 200,
        select: { id: true, code: true, name: true },
      }),
    ]);

  const pointsTotal = allForStats.reduce((s, a) => s + a.pointsBalance, 0);
  const byTier: Record<string, number> = {};
  for (const a of allForStats) {
    byTier[a.tier] = (byTier[a.tier] || 0) + 1;
  }

  return (
    <LoyaltyAccountsClient
      canWrite={session.role !== "VIEWER"}
      canManageProgram={canManageProgram}
      initialTab={initialTab}
      initialProgram={{
        name: program.name,
        earnPointsPerEur: program.earnPointsPerEur,
        redeemPointsPerEur: program.redeemPointsPerEur,
        isActive: program.isActive,
      }}
      customersWithout={customersWithout}
      initialStats={{
        totalAccounts: allForStats.length,
        activeAccounts: activeCount,
        pointsTotal,
        valueTotal: pointsToEur(pointsTotal, rules),
        byTier,
      }}
      initialItems={accounts.map((a) => ({
        id: a.id,
        pointsBalance: a.pointsBalance,
        balanceEur: pointsToEur(a.pointsBalance, rules),
        tier: a.tier,
        isActive: a.isActive,
        customer: a.customer,
        updatedAt: a.updatedAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
      }))}
    />
  );
}
