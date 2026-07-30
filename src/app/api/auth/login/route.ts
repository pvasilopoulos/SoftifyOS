import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/platform/auth/password";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  tenantSlug: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await request.json());
    const email = body.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { tenant: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return NextResponse.json(
        { error: "Λάθος email ή κωδικός" },
        { status: 401 },
      );
    }

    if (user.memberships.length === 0) {
      return NextResponse.json(
        { error: "Δεν υπάρχει συνδεδεμένος οργανισμός" },
        { status: 403 },
      );
    }

    const membership =
      (body.tenantSlug
        ? user.memberships.find((m) => m.tenant.slug === body.tenantSlug)
        : undefined) ?? user.memberships[0];

    if (!membership) {
      return NextResponse.json(
        { error: "Δεν έχετε πρόσβαση σε αυτόν τον οργανισμό" },
        { status: 403 },
      );
    }

    const token = await signSession({
      sub: user.id,
      email: user.email,
      name: user.name,
      tenantId: membership.tenantId,
      tenantSlug: membership.tenant.slug,
      tenantName: membership.tenant.name,
      role: membership.role,
    });

    await writeAuditEvent({
      tenantId: membership.tenantId,
      userId: user.id,
      action: "auth.login",
      entity: "user",
      entityId: user.id,
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tenant: {
        id: membership.tenantId,
        slug: membership.tenant.slug,
        name: membership.tenant.name,
        role: membership.role,
      },
    });

    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Αποτυχία σύνδεσης") },
      { status: 500 },
    );
  }
}
