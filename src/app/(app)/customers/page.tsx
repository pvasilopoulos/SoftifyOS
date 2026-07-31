import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { PageHeader } from "@/shared/ui/page-header";
import {
  listCustomFields,
  listEntityFormViews,
  listEntityListViews,
  serializeFormView,
  serializeListView,
} from "@/modules/entity-views/service";
import { parseCustomFields } from "@/modules/entity-views/types";
import { CustomersClient } from "./customers-client";

export const metadata = { title: "Πελάτες" };
export const dynamic = "force-dynamic";

async function loadCustomers(tenantId: string) {
  const started = Date.now();
  const rows = await prisma.customer.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    include: { _count: { select: { branches: true } } },
  });
  const hasMore = rows.length > 50;
  const items = (hasMore ? rows.slice(0, 50) : rows).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    vatNumber: c.vatNumber,
    email: c.email,
    phone: c.phone,
    status: c.status,
    branchCount: c._count.branches,
    createdAt: c.createdAt.toISOString(),
    customFields: parseCustomFields(c.customFields),
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

export default async function CustomersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [data, listViews, formViews, customFields] = await Promise.all([
    loadCustomers(session.tenantId),
    listEntityListViews(prisma, session.tenantId, "CUSTOMERS", true),
    listEntityFormViews(prisma, session.tenantId, "CUSTOMERS", true),
    listCustomFields(prisma, session.tenantId, "CUSTOMERS", true),
  ]);

  const publishedForms = formViews
    .map(serializeFormView)
    .filter((v) => (v.config.lifecycle ?? "published") === "published");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Πελάτες"
        description="Αναζήτηση, φίλτρα κατάστασης, προβολές λίστας, peek edit και μαζικές ενέργειες."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/customers/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800"
            >
              <Plus size={16} /> Νέος
            </Link>
          </div>
        }
      />
      <CustomersClient
        initialItems={data.items}
        initialNextCursor={data.nextCursor}
        initialMs={data.ms}
        listViews={listViews.map(serializeListView)}
        formViews={publishedForms}
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
