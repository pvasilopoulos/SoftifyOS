import { UsersSettingsClient } from "./users-settings-client";
import { ensureSystemRoles } from "@/platform/auth/ensure-system-roles";
import { getSession } from "@/platform/auth/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Χρήστες" };

export default async function UsersSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");
  await ensureSystemRoles(session.tenantId);
  return <UsersSettingsClient />;
}
