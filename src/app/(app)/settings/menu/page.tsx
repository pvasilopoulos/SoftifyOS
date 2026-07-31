import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { getTenantMenuSettings } from "@/platform/navigation/resolve-menu";
import { MenuSettingsClient } from "./menu-settings-client";

export const metadata = { title: "Μενού πλοήγησης" };
export const dynamic = "force-dynamic";

export default async function MenuSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");

  const [settings, groups, memberships] = await Promise.all([
    getTenantMenuSettings(session.tenantId),
    prisma.userGroup.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.membership.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { user: { name: "asc" } },
      select: {
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return (
    <MenuSettingsClient
      initialMenu={settings.menuTree}
      initialNavGroupsDefaultExpanded={settings.navGroupsDefaultExpanded}
      audienceOptions={{
        groups,
        users: memberships.map((m) => m.user),
      }}
    />
  );
}
