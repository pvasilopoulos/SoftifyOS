import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { productStatusLabel } from "@/modules/master-data/schemas";
import { formatEUR, toNumber } from "@/modules/sales/invoice-utils";
import { ProductEditPanel } from "./product-edit-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await prisma.product.findFirst({
    where: { id },
    select: { name: true, sku: true },
  });
  return { title: product ? `${product.sku} · ${product.name}` : "Προϊόν" };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const [product, units, balances] = await Promise.all([
    prisma.product.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        unitOfMeasure: {
          select: { id: true, code: true, name: true, symbol: true, kind: true },
        },
      },
    }),
    prisma.unitOfMeasure.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, symbol: true },
    }),
    prisma.stockBalance.findMany({
      where: { tenantId: session.tenantId, productId: id },
      include: { site: { select: { code: true, name: true } } },
      orderBy: { site: { name: "asc" } },
    }),
  ]);
  if (!product) notFound();

  const status = product.status as keyof typeof productStatusLabel;
  const unitLabel = product.unitOfMeasure
    ? `${product.unitOfMeasure.symbol} · ${product.unitOfMeasure.name}`
    : product.unit;
  const canEdit = session.role !== "VIEWER";
  const totalStock = balances.reduce((s, b) => s + toNumber(b.qtyOnHand), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/products"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Πίσω στα προϊόντα
        </Link>
        <PageHeader
          title={product.name}
          description={product.sku}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={product.status === "ACTIVE" ? "emerald" : "slate"}>
                {productStatusLabel[status] ?? product.status}
              </Badge>
              {product.trackInventory ? (
                <Badge tone="teal">Stock</Badge>
              ) : (
                <Badge tone="slate">Χωρίς stock</Badge>
              )}
            </div>
          }
        />
      </div>

      <div className="soft-panel grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Τιμή" value={formatEUR(toNumber(product.price))} />
        <Stat label="ΦΠΑ" value={`${toNumber(product.vatRate)}%`} />
        <Stat label="Μονάδα" value={unitLabel} />
        <Stat label="Barcode" value={product.barcode || "—"} />
        <Stat
          label="Απόθεμα"
          value={
            product.trackInventory
              ? totalStock.toLocaleString("el-GR")
              : "—"
          }
        />
        <Stat
          label="Ενημέρωση"
          value={product.updatedAt.toLocaleDateString("el-GR")}
        />
      </div>

      <ProductEditPanel
        productId={product.id}
        canEdit={canEdit}
        units={units}
        initial={{
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          unitId: product.unitId,
          unit: product.unit,
          vatRate: toNumber(product.vatRate),
          price: toNumber(product.price),
          notes: product.notes,
          status: product.status,
          trackInventory: product.trackInventory,
        }}
      />

      {product.trackInventory ? (
        <section className="soft-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-950">
              Απόθεμα ανά υποκατάστημα
            </h2>
            <Link
              href="/inventory"
              className="text-xs font-medium text-teal-700 hover:underline"
            >
              Άνοιγμα αποθήκης
            </Link>
          </div>
          {balances.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-500">
              Δεν υπάρχουν κινήσεις ακόμα για αυτό το προϊόν.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {balances.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <span>
                    <span className="font-medium text-ink-900">
                      {b.site.code}
                    </span>
                    <span className="text-slate-400"> · {b.site.name}</span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {toNumber(b.qtyOnHand).toLocaleString("el-GR")}{" "}
                    {product.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {product.notes && !canEdit ? (
        <section className="soft-panel p-5">
          <h2 className="mb-2 text-sm font-semibold text-ink-950">Σημειώσεις</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-600">
            {product.notes}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink-950">
        {value}
      </p>
    </div>
  );
}
