import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { loadDashboardBundle } from "@/modules/reports/engine";
import { ReportsWorkspace } from "@/modules/reports/reports-workspace";

export const metadata = { title: "Αναφορές & BI" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const bundle = await loadDashboardBundle(prisma, session.tenantId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Αναφορές & BI"
        description="Dashboard, κατάλογος αναφορών και Report Builder με ApexCharts."
      />
      <ReportsWorkspace
        initialKpis={bundle.kpis}
        initialReports={bundle.reports}
        catalog={bundle.catalog}
      />
    </div>
  );
}
