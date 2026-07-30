import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  giftCardStatusLabel,
  giftCardStatusTone,
} from "@/modules/gift-cards/labels";
import { GiftCardDetailClient } from "./gift-card-detail-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = await prisma.giftCard.findFirst({
    where: { id },
    select: { code: true },
  });
  return { title: card?.code ?? "Δωροκάρτα" };
}

export default async function GiftCardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const card = await prisma.giftCard.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      ledger: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!card) notFound();

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/gift-cards"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Δωροκάρτες
        </Link>
        <PageHeader
          title={card.code}
          description="Υπόλοιπο, κινήσεις και ενέργειες"
          actions={
            <Badge
              tone={giftCardStatusTone(
                card.status as keyof typeof giftCardStatusLabel,
              )}
            >
              {giftCardStatusLabel[card.status as keyof typeof giftCardStatusLabel]}
            </Badge>
          }
        />
      </div>
      <GiftCardDetailClient
        canWrite={session.role !== "VIEWER"}
        initial={{
          id: card.id,
          code: card.code,
          initialBalance: toNumber(card.initialBalance),
          balance: toNumber(card.balance),
          status: card.status,
          expiresAt: card.expiresAt?.toISOString() ?? null,
          notes: card.notes,
          customer: card.customer,
          ledger: card.ledger.map((l) => ({
            id: l.id,
            kind: l.kind,
            amount: toNumber(l.amount),
            balanceAfter: toNumber(l.balanceAfter),
            invoiceId: l.invoiceId,
            note: l.note,
            createdAt: l.createdAt.toISOString(),
          })),
        }}
      />
    </div>
  );
}
