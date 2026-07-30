import { RolesSettingsClient } from "./roles-settings-client";
import { ensureSystemRoles } from "@/platform/auth/ensure-system-roles";
import { getSession } from "@/platform/auth/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Ρόλοι" };

export default async function RolesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");
  await ensureSystemRoles(session.tenantId);
  return <RolesSettingsClient />;
}
