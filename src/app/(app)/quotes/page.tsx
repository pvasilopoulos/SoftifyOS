import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { PageHeader } from "@/shared/ui/page-header";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  listCustomFields,
  listEntityListViews,
  serializeListView,
} from "@/modules/entity-views/service";
import { parseCustomFields } from "@/modules/entity-views/types";
import { OrdersClient } from "@/app/(app)/orders/orders-client";

export const metadata = { title: "Προσφορές" };
export const dynamic = "force-dynamic";

async function loadQuotes(tenantId: string) {
  const started = Date.now();
  const rows = await prisma.order.findMany({
    where: { tenantId, kind: "SALES_QUOTE" },
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
    customFields: parseCustomFields(o.customFields),
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

export default async function QuotesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [first, listViews, customFields] = await Promise.all([
    loadQuotes(session.tenantId),
    listEntityListViews(prisma, session.tenantId, "QUOTES", true),
    listCustomFields(prisma, session.tenantId, "QUOTES", true),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Προσφορές"
        description="Προσφορά → μετατροπή σε παραγγελία · δυναμικές προβολές"
        actions={
          <Link
            href="/quotes/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Plus size={16} />
            Νέα προσφορά
          </Link>
        }
      />
      <OrdersClient
        initialItems={first.items}
        initialNextCursor={first.nextCursor}
        initialMs={first.ms}
        kind="SALES_QUOTE"
        detailBasePath="/orders"
        emptyLabel="Δεν βρέθηκαν προσφορές"
        entity="QUOTES"
        listViews={listViews.map(serializeListView)}
        customFields={customFields.map((f) => ({
          code: f.code,
          label: f.label,
          type: f.type,
          optionsJson: f.optionsJson,
          required: f.required,
        }))}
      />
    </div>
  );
}
