import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { isPermissionKey } from "@/platform/auth/permissions";

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
  permissions: z.array(z.string()).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());

    const role = await prisma.appRole.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!role) {
      return NextResponse.json({ error: "Ο ρόλος δεν βρέθηκε" }, { status: 404 });
    }

    if (body.permissions) {
      const bad = body.permissions.filter((p) => !isPermissionKey(p));
      if (bad.length) {
        return NextResponse.json(
          { error: `Άγνωστα permissions: ${bad.join(", ")}` },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.appRole.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.permissions ? { permissions: body.permissions } : {}),
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.roles.update",
      entity: "app_role",
      entityId: id,
    });

    return NextResponse.json({ item: updated });
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
    const role = await prisma.appRole.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!role) {
      return NextResponse.json({ error: "Ο ρόλος δεν βρέθηκε" }, { status: 404 });
    }
    if (role.isSystem) {
      return NextResponse.json(
        { error: "Οι system ρόλοι δεν διαγράφονται" },
        { status: 403 },
      );
    }

    await prisma.membership.updateMany({
      where: { appRoleId: id },
      data: { appRoleId: null },
    });
    await prisma.userGroupRole.deleteMany({ where: { appRoleId: id } });
    await prisma.appRole.delete({ where: { id } });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.roles.delete",
      entity: "app_role",
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
