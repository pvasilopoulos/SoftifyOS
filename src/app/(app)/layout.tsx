import { redirect } from "next/navigation";
import { AppShell } from "@/platform/shell/app-shell";
import { getSession } from "@/platform/auth/session";
import {
  getMenuAudienceForSession,
  getTenantMenuSettings,
} from "@/platform/navigation/resolve-menu";
import { prisma } from "@/server/db";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const [{ menuTree, navGroupsDefaultExpanded }, menuAudience, orgSettings] =
    await Promise.all([
      getTenantMenuSettings(session.tenantId),
      getMenuAudienceForSession({
        tenantId: session.tenantId,
        userId: session.sub,
        role: session.role,
      }),
      prisma.tenantSettings.findUnique({
        where: { tenantId: session.tenantId },
        select: { maintenanceMode: true },
      }),
    ]);

  return (
    <AppShell
      session={session}
      menuTree={menuTree}
      menuAudience={menuAudience}
      navGroupsDefaultExpanded={navGroupsDefaultExpanded}
      maintenanceMode={Boolean(orgSettings?.maintenanceMode)}
    >
      {children}
    </AppShell>
  );
}
