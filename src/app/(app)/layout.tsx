import { redirect } from "next/navigation";
import { AppShell } from "@/platform/shell/app-shell";
import { getSession } from "@/platform/auth/session";
import {
  getMenuAudienceForSession,
  getTenantMenuSettings,
} from "@/platform/navigation/resolve-menu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const [{ menuTree, navGroupsDefaultExpanded }, menuAudience] =
    await Promise.all([
      getTenantMenuSettings(session.tenantId),
      getMenuAudienceForSession({
        tenantId: session.tenantId,
        userId: session.sub,
        role: session.role,
      }),
    ]);

  return (
    <AppShell
      session={session}
      menuTree={menuTree}
      menuAudience={menuAudience}
      navGroupsDefaultExpanded={navGroupsDefaultExpanded}
    >
      {children}
    </AppShell>
  );
}
