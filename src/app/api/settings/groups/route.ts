import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    session.role !== "SUPER_ADMIN" &&
    session.role !== "OWNER" &&
    session.role !== "ADMIN"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const groups = await prisma.userGroup.findMany({
      where: { tenantId: session!.tenantId },
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
    });

    return NextResponse.json({
      items: groups.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        description: g.description,
        members: g.members.map((m) => ({
          membershipId: m.membershipId,
          user: m.membership.user,
        })),
        roles: g.roles.map((r) => r.appRole),
      })),
    });
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
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = createSchema.parse(await req.json());
    const existing = await prisma.userGroup.findUnique({
      where: {
        tenantId_code: { tenantId: session!.tenantId, code: body.code },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Υπάρχει ήδη ομάδα με αυτό το code" },
        { status: 409 },
      );
    }

    const group = await prisma.userGroup.create({
      data: {
        tenantId: session!.tenantId,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.groups.create",
      entity: "user_group",
      entityId: group.id,
      meta: { code: group.code },
    });

    return NextResponse.json({ item: group }, { status: 201 });
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
