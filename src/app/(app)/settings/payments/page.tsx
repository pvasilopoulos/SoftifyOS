import { redirect } from "next/navigation";
import { CreditCard, HandCoins, Wallet } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Ρυθμίσεις · Πληρωμές & Ταμείο" };
export const dynamic = "force-dynamic";

export default async function PaymentsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [receiptsSeries, partialSeries] = await Promise.all([
    prisma.documentSeries.count({
      where: { tenantId: session.tenantId, kind: "CUSTOMER_RECEIPT", isActive: true },
    }),
    prisma.documentSeries.count({
      where: { tenantId: session.tenantId, allowPartial: true, isActive: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Πληρωμές & Ταμείο"
        description="Κανόνες εισπράξεων, ρευστότητας και μερικών εξοφλήσεων"
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Card icon={<CreditCard size={16} />} title="Σειρές είσπραξης" value={String(receiptsSeries)} />
        <Card icon={<HandCoins size={16} />} title="Μερικές εξοφλήσεις" value={String(partialSeries)} />
        <Card icon={<Wallet size={16} />} title="Νόμισμα λειτουργίας" value="EUR" />
      </div>

      <section className="soft-panel p-5">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-950">Κατάσταση</h2>
          <Badge tone="emerald">Operational</Badge>
        </div>
        <p className="text-sm text-slate-600">
          Το module πληρωμών διαβάζει τις ενεργές σειρές παραστατικών και υποστηρίζει
          κανόνες μερικής εξόφλησης από τις ρυθμίσεις σειρών.
        </p>
      </section>
    </div>
  );
}

function Card({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="soft-panel p-4">
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {title}
      </p>
      <p className="text-lg font-semibold text-ink-950">{value}</p>
    </div>
  );
}
