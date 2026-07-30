import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { ensureSystemRoles } from "@/platform/auth/ensure-system-roles";
import { prisma } from "@/server/db";
import { GroupsSettingsClient } from "./groups-settings-client";

export const metadata = { title: "Ομάδες χρηστών" };
export const dynamic = "force-dynamic";

export default async function GroupsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");
  await ensureSystemRoles(session.tenantId);

  const [groups, memberships, roles] = await Promise.all([
    prisma.userGroup.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { name: "asc" },
      include: {
        members: {
          include: {
            membership: {
              include: { user: { select: { id: true, email: true, name: true } } },
            },
          },
        },
        roles: {
          include: {
            appRole: { select: { id: true, code: true, name: true } },
          },
        },
      },
    }),
    prisma.membership.findMany({
      where: { tenantId: session.tenantId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.appRole.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <GroupsSettingsClient
      initialGroups={groups.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        description: g.description,
        members: g.members.map((m) => ({
          membershipId: m.membershipId,
          user: m.membership.user,
        })),
        roles: g.roles.map((r) => r.appRole),
      }))}
      initialUsers={memberships.map((m) => ({
        membershipId: m.id,
        user: m.user,
      }))}
      initialRoles={roles}
    />
  );
}
