import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { toNumber } from "@/modules/sales/invoice-utils";
import { ProductsClient } from "./products-client";

export const metadata = { title: "Προϊόντα" };
export const dynamic = "force-dynamic";

async function loadProducts(tenantId: string) {
  const started = Date.now();
  const rows = await prisma.product.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
  });
  const hasMore = rows.length > 50;
  const items = (hasMore ? rows.slice(0, 50) : rows).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    brand: p.brand,
    barcode: p.barcode,
    unit: p.unit,
    vatRate: toNumber(p.vatRate),
    price: toNumber(p.price),
    cost: toNumber(p.cost),
    stockOnHand: toNumber(p.stockOnHand),
    minStock: toNumber(p.minStock),
    reorderQty: toNumber(p.reorderQty),
    location: p.location,
    tags: p.tags,
    isTracked: p.isTracked,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
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

export default async function ProductsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const first = await loadProducts(session.tenantId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Προϊόντα"
        description="Advanced κατάλογος SKU · εμπορικά · απόθεμα · περιθώριο"
        actions={
          <Link
            href="/products/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Plus size={16} />
            Νέο προϊόν
          </Link>
        }
      />
      <ProductsClient
        initialItems={first.items}
        initialNextCursor={first.nextCursor}
        initialMs={first.ms}
      />
      <p className="text-xs text-slate-500">
        Ο κατάλογος τροφοδοτεί παραγγελίες και αποθήκη.{" "}
        <Badge tone="teal">Phase 1 master data</Badge>
      </p>
    </div>
  );
}
