import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { toNumber } from "@/modules/sales/invoice-utils";
import { OrdersClient } from "./orders-client";

export const metadata = { title: "Παραγγελίες" };
export const dynamic = "force-dynamic";

async function loadOrders(tenantId: string) {
  const started = Date.now();
  const rows = await prisma.order.findMany({
    where: { tenantId, kind: "SALES_ORDER" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    include: {
      customer: { select: { name: true, code: true } },
      branch: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });
  const hasMore = rows.length > 50;
  const items = (hasMore ? rows.slice(0, 50) : rows).map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    orderedAt: o.orderedAt.toISOString(),
    total: toNumber(o.total),
    createdAt: o.createdAt.toISOString(),
    customerId: o.customerId,
    customerName: o.customer.name,
    customerCode: o.customer.code,
    branchName: o.branch?.name ?? null,
    lineCount: o._count.lines,
  }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    ms: Date.now() - started,
  };
}

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const first = await loadOrders(session.tenantId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Παραγγελίες"
        description="Παραγγελία → έκδοση τιμολογίου"
        actions={
          <Link
            href="/orders/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Plus size={16} />
            Νέα παραγγελία
          </Link>
        }
      />
      <OrdersClient
        initialItems={first.items}
        initialNextCursor={first.nextCursor}
        initialMs={first.ms}
        kind="SALES_ORDER"
      />
      <p className="text-xs text-slate-500">
        Οι γραμμές μπορούν να δεθούν με προϊόντα καταλόγου.{" "}
        <Badge tone="teal">Phase 1 sales</Badge>
      </p>
    </div>
  );
}
