import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { productStatusLabel } from "@/modules/master-data/schemas";
import { formatEUR, toNumber } from "@/modules/sales/invoice-utils";

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
  const product = await prisma.product.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!product) notFound();

  const status = product.status as keyof typeof productStatusLabel;

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
            <Badge tone={product.status === "ACTIVE" ? "emerald" : "slate"}>
              {productStatusLabel[status] ?? product.status}
            </Badge>
          }
        />
      </div>

      <div className="soft-panel grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Τιμή" value={formatEUR(toNumber(product.price))} />
        <Stat label="ΦΠΑ" value={`${toNumber(product.vatRate)}%`} />
        <Stat label="Μονάδα" value={product.unit} />
        <Stat label="Barcode" value={product.barcode || "—"} />
        <Stat
          label="Ενημέρωση"
          value={product.updatedAt.toLocaleDateString("el-GR")}
        />
      </div>

      {product.notes ? (
        <section className="soft-panel p-5">
          <h2 className="mb-2 text-sm font-semibold text-ink-950">Σημειώσεις</h2>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">
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
