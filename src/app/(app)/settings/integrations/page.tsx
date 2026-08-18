import { redirect } from "next/navigation";
import { Activity, Cable, Cloud } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Ρυθμίσεις · Integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const myDataSeries = await prisma.documentSeries.count({
    where: { tenantId: session.tenantId, myDataEnabled: true, isActive: true },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        description="Εποπτεία ετοιμότητας για εξωτερικές συνδέσεις"
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Metric icon={<Cloud size={16} />} label="myDATA active series" value={String(myDataSeries)} />
        <Metric icon={<Cable size={16} />} label="ERP connectors" value="Planned" />
        <Metric icon={<Activity size={16} />} label="Webhooks" value="Planned" />
      </div>

      <section className="soft-panel p-5">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-950">Roadmap readiness</h2>
          <Badge tone="amber">Phase 1</Badge>
        </div>
        <p className="text-sm text-slate-600">
          Υπάρχει λειτουργική βάση για myDATA μέσω σειρών. Τα υπόλοιπα integrations
          εμφανίζονται ως placeholders ώστε να οργανωθεί σταδιακά το control center.
        </p>
      </section>
    </div>
  );
}

function Metric({
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
      <p className="text-lg font-semibold text-ink-950">{value}</p>
    </div>
  );
}
