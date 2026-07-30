import { redirect } from "next/navigation";
import { AppShell } from "@/platform/shell/app-shell";
import { getSession } from "@/platform/auth/session";
import { getTenantMenuTree } from "@/platform/navigation/resolve-menu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const menuTree = await getTenantMenuTree(session.tenantId);

  return (
    <AppShell session={session} menuTree={menuTree}>
      {children}
    </AppShell>
  );
}
