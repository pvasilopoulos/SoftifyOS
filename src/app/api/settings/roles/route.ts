import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { isPermissionKey } from "@/platform/auth/permissions";

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

    const roles = await prisma.appRole.findMany({
      where: { tenantId: session!.tenantId },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { memberships: true, groups: true } },
      },
    });

    return NextResponse.json({ items: roles });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Μόνο πεζά λατινικά, αριθμοί και _"),
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional().nullable(),
  permissions: z.array(z.string()).default([]),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = createSchema.parse(await req.json());
    const bad = body.permissions.filter((p) => !isPermissionKey(p));
    if (bad.length) {
      return NextResponse.json(
        { error: `Άγνωστα permissions: ${bad.join(", ")}` },
        { status: 400 },
      );
    }

    const existing = await prisma.appRole.findUnique({
      where: {
        tenantId_code: { tenantId: session!.tenantId, code: body.code },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Υπάρχει ήδη ρόλος με αυτό το code" },
        { status: 409 },
      );
    }

    const role = await prisma.appRole.create({
      data: {
        tenantId: session!.tenantId,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        permissions: body.permissions,
        isSystem: false,
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.roles.create",
      entity: "app_role",
      entityId: role.id,
      meta: { code: role.code },
    });

    return NextResponse.json({ item: role }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 500 },
    );
  }
}
