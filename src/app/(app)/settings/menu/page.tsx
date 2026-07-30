import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { getTenantMenuTree } from "@/platform/navigation/resolve-menu";
import { MenuSettingsClient } from "./menu-settings-client";

export const metadata = { title: "Μενού πλοήγησης" };
export const dynamic = "force-dynamic";

export default async function MenuSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");

  const menu = await getTenantMenuTree(session.tenantId);
  return <MenuSettingsClient initialMenu={menu} />;
}
