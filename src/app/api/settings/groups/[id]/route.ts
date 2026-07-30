import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(300).optional().nullable(),
  memberIds: z.array(z.string()).optional(),
  roleIds: z.array(z.string()).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());

    const group = await prisma.userGroup.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!group) {
      return NextResponse.json({ error: "Η ομάδα δεν βρέθηκε" }, { status: 404 });
    }

    if (body.memberIds) {
      const memberships = await prisma.membership.findMany({
        where: { tenantId: session!.tenantId, id: { in: body.memberIds } },
        select: { id: true },
      });
      if (memberships.length !== body.memberIds.length) {
        return NextResponse.json({ error: "Μη έγκυρα μέλη" }, { status: 400 });
      }
      await prisma.userGroupMember.deleteMany({ where: { groupId: id } });
      if (body.memberIds.length) {
        await prisma.userGroupMember.createMany({
          data: body.memberIds.map((membershipId) => ({
            tenantId: session!.tenantId,
            groupId: id,
            membershipId,
          })),
        });
      }
    }

    if (body.roleIds) {
      const roles = await prisma.appRole.findMany({
        where: { tenantId: session!.tenantId, id: { in: body.roleIds } },
        select: { id: true },
      });
      if (roles.length !== body.roleIds.length) {
        return NextResponse.json({ error: "Μη έγκυροι ρόλοι" }, { status: 400 });
      }
      await prisma.userGroupRole.deleteMany({ where: { groupId: id } });
      if (body.roleIds.length) {
        await prisma.userGroupRole.createMany({
          data: body.roleIds.map((appRoleId) => ({
            tenantId: session!.tenantId,
            groupId: id,
            appRoleId,
          })),
        });
      }
    }

    const updated = await prisma.userGroup.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
      include: {
        members: {
          include: {
            membership: {
              include: { user: { select: { id: true, email: true, name: true } } },
            },
          },
        },
        roles: { include: { appRole: true } },
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.groups.update",
      entity: "user_group",
      entityId: id,
    });

    return NextResponse.json({
      item: {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        description: updated.description,
        members: updated.members.map((m) => ({
          membershipId: m.membershipId,
          user: m.membership.user,
        })),
        roles: updated.roles.map((r) => r.appRole),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const { id } = await ctx.params;
    const group = await prisma.userGroup.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!group) {
      return NextResponse.json({ error: "Η ομάδα δεν βρέθηκε" }, { status: 404 });
    }

    await prisma.userGroupMember.deleteMany({ where: { groupId: id } });
    await prisma.userGroupRole.deleteMany({ where: { groupId: id } });
    await prisma.userGroup.delete({ where: { id } });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.groups.delete",
      entity: "user_group",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 500 },
    );
  }
}
