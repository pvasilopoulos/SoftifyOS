import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { PageHeader } from "@/shared/ui/page-header";
import { toNumber } from "@/modules/sales/invoice-utils";
import { InvoicesWorkspace } from "./invoices-workspace";

export const metadata = { title: "Τιμολόγια" };
export const dynamic = "force-dynamic";

async function loadFirstPage(tenantId: string) {
  const started = Date.now();
  const rows = await prisma.invoice.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    include: {
      customer: { select: { id: true, name: true, code: true } },
      branch: { select: { name: true } },
      space: { select: { name: true } },
    },
  });

  const countsRaw = await prisma.invoice.groupBy({
    by: ["status"],
    where: { tenantId },
    _count: { _all: true },
  });

  const countMap = Object.fromEntries(
    countsRaw.map((r) => [r.status, r._count._all]),
  ) as Record<string, number>;

  const counts = {
    all: countsRaw.reduce((s, r) => s + r._count._all, 0),
    draft: countMap.DRAFT ?? 0,
    pending:
      (countMap.ISSUED ?? 0) + (countMap.PARTIAL ?? 0) + (countMap.OVERDUE ?? 0),
    issued: countMap.ISSUED ?? 0,
    overdue: countMap.OVERDUE ?? 0,
    paid: countMap.PAID ?? 0,
  };

  const hasMore = rows.length > 50;
  const items = (hasMore ? rows.slice(0, 50) : rows).map((inv) => ({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    issuedAt: inv.issuedAt?.toISOString() ?? null,
    dueAt: inv.dueAt?.toISOString() ?? null,
    total: toNumber(inv.total),
    paidAmount: toNumber(inv.paidAmount),
    createdAt: inv.createdAt.toISOString(),
    customerId: inv.customerId,
    customerName: inv.customer.name,
    customerCode: inv.customer.code,
    branchName: inv.branch?.name ?? null,
    spaceName: inv.space?.name ?? null,
  }));

  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    counts,
    ms: Date.now() - started,
  };
}

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const first = await loadFirstPage(session.tenantId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Τιμολόγια"
        description="Workspace παραστατικών · πελάτης / υποκατάστημα / χώρος"
        actions={
          <Link
            href="/invoices/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Plus size={16} />
            Νέο τιμολόγιο
          </Link>
        }
      />
      <InvoicesWorkspace
        initialItems={first.items}
        initialNextCursor={first.nextCursor}
        initialCounts={first.counts}
        initialMs={first.ms}
      />
    </div>
  );
}
