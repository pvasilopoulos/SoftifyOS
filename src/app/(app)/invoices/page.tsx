import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { requireCompanyIdForPage } from "@/platform/tenancy/company-scope";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { PageHeader } from "@/shared/ui/page-header";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  listCustomFields,
  listEntityListViews,
  serializeListView,
} from "@/modules/entity-views/service";
import { InvoicesWorkspace } from "./invoices-workspace";

export const metadata = { title: "Τιμολόγια" };
export const dynamic = "force-dynamic";

async function loadFirstPage(tenantId: string, legalEntityId: string) {
  const started = Date.now();
  const rows = await prisma.invoice.findMany({
    where: { tenantId, legalEntityId },
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
    where: { tenantId, legalEntityId },
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
    partial: countMap.PARTIAL ?? 0,
    cancelled: countMap.CANCELLED ?? 0,
  };

  const hasMore = rows.length > 50;
  const items = (hasMore ? rows.slice(0, 50) : rows).map((inv) => ({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    kind: inv.kind,
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
    customFields:
      inv.customFields && typeof inv.customFields === "object"
        ? (inv.customFields as Record<string, unknown>)
        : {},
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
  const legalEntityId = requireCompanyIdForPage(session);

  const first = await loadFirstPage(session.tenantId, legalEntityId);
  const [listViews, customFields] = await Promise.all([
    listEntityListViews(prisma, session.tenantId, "INVOICES", true),
    listCustomFields(prisma, session.tenantId, "INVOICES", true),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Παραστατικά"
        description="Αναζήτηση, φίλτρα είδους & ημερομηνίας, προεπισκόπηση και μαζικές ενέργειες"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/invoices/new?kind=SALES_CREDIT"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-ink-900 hover:bg-slate-50"
            >
              Πιστωτικό
            </Link>
            <Link
              href="/invoices/new"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
            >
              <Plus size={16} />
              Νέο τιμολόγιο
            </Link>
          </div>
        }
      />
      <InvoicesWorkspace
        initialItems={first.items}
        initialNextCursor={first.nextCursor}
        initialCounts={first.counts}
        initialMs={first.ms}
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
