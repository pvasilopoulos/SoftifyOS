import Link from "next/link";
import { redirect } from "next/navigation";
import { FileCheck2, Percent, ReceiptText } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Ρυθμίσεις · Φορολογία & myDATA" };
export const dynamic = "force-dynamic";

export default async function TaxSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [seriesCount, myDataEnabledCount] = await Promise.all([
    prisma.documentSeries.count({ where: { tenantId: session.tenantId } }),
    prisma.documentSeries.count({
      where: { tenantId: session.tenantId, myDataEnabled: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Φορολογία & myDATA"
        description="Παραμετροποίηση φορολογικής συμπεριφοράς παραστατικών"
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Tile icon={<ReceiptText size={16} />} label="Σειρές παραστατικών" value={String(seriesCount)} />
        <Tile icon={<FileCheck2 size={16} />} label="myDATA enabled" value={String(myDataEnabledCount)} />
        <Tile icon={<Percent size={16} />} label="Default ΦΠΑ" value="24%" />
      </div>

      <section className="soft-panel space-y-3 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-950">Παραμετροποίηση</h2>
          <Badge tone="teal">Finance</Badge>
        </div>
        <p className="text-sm text-slate-600">
          Για αναλυτική φορολογική και λογιστική παραμετροποίηση ανά τύπο παραστατικού,
          χρησιμοποίησε το module σειρών.
        </p>
        <Link
          href="/settings/series"
          className="inline-flex h-10 items-center rounded-xl bg-teal-600 px-3 text-sm font-medium text-white hover:bg-teal-700"
        >
          Άνοιγμα Σειρών & Τύπων
        </Link>
      </section>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="soft-panel p-4">
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </p>
      <p className="text-xl font-semibold text-ink-950">{value}</p>
    </div>
  );
}
