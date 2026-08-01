import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import {
  getSession,
  signSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const schema = z.object({
  tenantId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = schema.parse(await request.json());
    const membership = await prisma.membership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: body.tenantId,
          userId: session.sub,
        },
      },
      include: { tenant: true },
    });
    if (!membership) {
      return NextResponse.json(
        { error: "Δεν έχετε πρόσβαση σε αυτόν τον οργανισμό" },
        { status: 403 },
      );
    }

    const token = await signSession({
      sub: session.sub,
      email: session.email,
      name: session.name,
      tenantId: membership.tenantId,
      tenantSlug: membership.tenant.slug,
      tenantName: membership.tenant.name,
      role: membership.role,
    });

    await writeAuditEvent({
      tenantId: membership.tenantId,
      userId: session.sub,
      action: "tenant.switch",
      entity: "tenant",
      entityId: membership.tenantId,
    });

    const res = NextResponse.json({
      ok: true,
      tenant: {
        id: membership.tenantId,
        slug: membership.tenant.slug,
        name: membership.tenant.name,
        role: membership.role,
      },
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Switch failed") },
      { status: 400 },
    );
  }
}
