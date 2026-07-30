import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
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

  const first = await loadCustomers(session.tenantId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Πελάτες"
        description="Πελάτης → Υποκαταστήματα → Χώροι"
        actions={
          <Link
            href="/customers/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Plus size={16} />
            Νέος πελάτης
          </Link>
        }
      />
      <CustomersClient
        initialItems={first.items}
        initialNextCursor={first.nextCursor}
        initialMs={first.ms}
      />
      <p className="text-xs text-slate-500">
        Κάθε πελάτης μπορεί να έχει πολλά υποκαταστήματα· κάθε υποκατάστημα πολλούς
        χώρους.{" "}
        <Badge tone="teal">Phase 1 master data</Badge>
      </p>
    </div>
  );
}
