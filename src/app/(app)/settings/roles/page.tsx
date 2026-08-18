import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { ensureSystemRoles } from "@/platform/auth/ensure-system-roles";
import { prisma } from "@/server/db";
import { RolesSettingsClient } from "./roles-settings-client";

export const metadata = { title: "Ρόλοι" };
export const dynamic = "force-dynamic";

export default async function RolesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (
    session.role !== "SUPER_ADMIN" &&
    session.role !== "OWNER" &&
    session.role !== "ADMIN"
  ) {
    redirect("/settings");
  }
  await ensureSystemRoles(session.tenantId);

  const roles = await prisma.appRole.findMany({
    where: { tenantId: session.tenantId },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { memberships: true, groups: true } },
    },
  });

  return (
    <RolesSettingsClient
      initialRoles={roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        isSystem: r.isSystem,
        membershipCount: r._count.memberships,
        groupCount: r._count.groups,
      }))}
    />
  );
}
