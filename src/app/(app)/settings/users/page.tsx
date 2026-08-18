import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { ensureSystemRoles } from "@/platform/auth/ensure-system-roles";
import { prisma } from "@/server/db";
import { UsersSettingsClient } from "./users-settings-client";

export const metadata = { title: "Χρήστες" };
export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
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

  const [users, roles] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId: session.tenantId },
      include: {
        user: { select: { id: true, email: true, name: true, createdAt: true } },
        appRole: { select: { id: true, code: true, name: true } },
        groups: {
          include: { group: { select: { id: true, code: true, name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.appRole.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <UsersSettingsClient
      initialUsers={users.map((m) => ({
        membershipId: m.id,
        role: m.role,
        appRoleId: m.appRoleId,
        appRole: m.appRole,
        user: {
          ...m.user,
          createdAt: m.user.createdAt.toISOString(),
        },
        groups: m.groups.map((g) => g.group),
      }))}
      initialRoles={roles}
      currentUserId={session.sub}
      currentRole={session.role}
    />
  );
}
