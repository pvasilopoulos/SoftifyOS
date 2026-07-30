import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { listUnitsOfMeasure } from "@/modules/units/service";
import { NewProductForm } from "./new-product-form";

export const metadata = { title: "Νέο προϊόν" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "VIEWER") redirect("/products");

  const units = await listUnitsOfMeasure(prisma, session.tenantId, {
    activeOnly: true,
  });
  const defaultUnit =
    units.find((u) => u.isDefault) ?? units.find((u) => u.code === "PCS") ?? units[0];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/products"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Πίσω
      </Link>
      <PageHeader
        title="Νέο προϊόν"
        description="SKU, μονάδα μέτρησης, τιμή και ΦΠΑ για χρήση σε παραγγελίες."
      />
      <NewProductForm
        units={units.map((u) => ({
          id: u.id,
          code: u.code,
          name: u.name,
          symbol: u.symbol,
          kind: u.kind,
          decimals: u.decimals,
          isDefault: u.isDefault,
        }))}
        defaultUnitId={defaultUnit?.id ?? ""}
      />
    </div>
  );
}
