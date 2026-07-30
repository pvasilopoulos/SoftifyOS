import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { toNumber } from "@/modules/sales/invoice-utils";
import { GiftCardsClient } from "./gift-cards-client";

export const metadata = { title: "Δωροκάρτες" };
export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const items = await prisma.giftCard.findMany({
    where: { tenantId: session.tenantId },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    include: {
      customer: { select: { id: true, code: true, name: true } },
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Δωροκάρτες"
        description="Έκδοση · υπόλοιπα · ιστορικό κινήσεων · ακύρωση"
        actions={
          <Link
            href="/gift-cards/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Plus size={16} />
            Νέα δωροκάρτα
          </Link>
        }
      />
      <GiftCardsClient
        initialItems={items.map((g) => ({
          id: g.id,
          code: g.code,
          initialBalance: toNumber(g.initialBalance),
          balance: toNumber(g.balance),
          status: g.status,
          expiresAt: g.expiresAt?.toISOString() ?? null,
          customer: g.customer,
          createdAt: g.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
