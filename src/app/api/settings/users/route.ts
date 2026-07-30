import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const users = await prisma.membership.findMany({
      where: { tenantId: session!.tenantId },
      include: {
        user: { select: { id: true, email: true, name: true, createdAt: true } },
        appRole: { select: { id: true, code: true, name: true } },
        groups: {
          include: { group: { select: { id: true, code: true, name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      items: users.map((m) => ({
        membershipId: m.id,
        role: m.role,
        appRoleId: m.appRoleId,
        appRole: m.appRole,
        user: m.user,
        groups: m.groups.map((g) => g.group),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  membershipId: z.string().min(1),
  appRoleId: z.string().nullable().optional(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).optional(),
});

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = patchSchema.parse(await req.json());
    const membership = await prisma.membership.findFirst({
      where: { id: body.membershipId, tenantId: session!.tenantId },
    });
    if (!membership) {
      return NextResponse.json({ error: "Ο χρήστης δεν βρέθηκε" }, { status: 404 });
    }

    if (body.appRoleId) {
      const role = await prisma.appRole.findFirst({
        where: { id: body.appRoleId, tenantId: session!.tenantId },
      });
      if (!role) {
        return NextResponse.json({ error: "Ο ρόλος δεν βρέθηκε" }, { status: 404 });
      }
    }

    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: {
        ...(body.appRoleId !== undefined ? { appRoleId: body.appRoleId } : {}),
        ...(body.role ? { role: body.role } : {}),
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
        appRole: { select: { id: true, code: true, name: true } },
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.users.update",
      entity: "membership",
      entityId: membership.id,
      meta: { appRoleId: body.appRoleId, role: body.role },
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
