import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { SettingsHubClient } from "./settings-hub-client";

export const metadata = { title: "Ρυθμίσεις" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: session.tenantId },
    select: { maintenanceMode: true },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ρυθμίσεις"
        description="Παραμετροποίηση οργανισμού, πρόσβασης, παραστατικών και πλατφόρμας"
      />
      <SettingsHubClient
        tenantName={session.tenantName}
        maintenanceMode={Boolean(settings?.maintenanceMode)}
      />
    </div>
  );
}
