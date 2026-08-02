import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/platform/auth/password";
import {
  PREAUTH_COOKIE,
  SESSION_COOKIE,
  preauthCookieOptions,
  sessionCookieOptions,
  signPreauth,
} from "@/platform/auth/session";
import { issueWorkspaceSession } from "@/platform/tenancy/issue-session";
import {
  buildMembershipWorkspaces,
  readWorkspacePrefs,
} from "@/platform/tenancy/workspace";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  /** Optional: skip picker when known */
  tenantId: z.string().min(1).optional(),
  legalEntityId: z.string().min(1).optional().nullable(),
  /** Force picker even με 1 tenant */
  forceSelect: z.boolean().optional(),
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

    const prefs = readWorkspacePrefs(user.workspacePrefs);
    const workspaces = await buildMembershipWorkspaces(prisma, {
      memberships: user.memberships,
      prefs,
      lastTenantId: user.lastTenantId,
    });

    const wantsPicker =
      body.forceSelect ||
      (!body.tenantId && user.memberships.length > 1);

    if (wantsPicker) {
      const preauth = await signPreauth({
        sub: user.id,
        email: user.email,
        name: user.name,
      });
      const response = NextResponse.json({
        ok: true,
        needsWorkspaceSelect: true,
        user: { id: user.id, email: user.email, name: user.name },
        lastTenantId: user.lastTenantId,
        workspaces,
      });
      response.cookies.set(PREAUTH_COOKIE, preauth, preauthCookieOptions());
      // Clear any stale full session
      response.cookies.set(SESSION_COOKIE, "", {
        ...sessionCookieOptions(),
        maxAge: 0,
      });
      return response;
    }

    const membership =
      (body.tenantId
        ? user.memberships.find((m) => m.tenantId === body.tenantId)
        : user.lastTenantId
          ? user.memberships.find((m) => m.tenantId === user.lastTenantId)
          : undefined) ?? user.memberships[0]!;

    if (!membership) {
      return NextResponse.json(
        { error: "Δεν έχετε πρόσβαση σε αυτόν τον οργανισμό" },
        { status: 403 },
      );
    }

    const { token, session } = await issueWorkspaceSession(prisma, {
      userId: user.id,
      email: user.email,
      name: user.name,
      tenantId: membership.tenantId,
      tenantSlug: membership.tenant.slug,
      tenantName: membership.tenant.name,
      role: membership.role,
      legalEntityId: body.legalEntityId,
      existingPrefs: user.workspacePrefs,
    });

    await writeAuditEvent({
      tenantId: membership.tenantId,
      userId: user.id,
      action: "auth.login",
      entity: "user",
      entityId: user.id,
      meta: {
        legalEntityId: session.legalEntityId,
        legalEntityCode: session.legalEntityCode,
      },
    });

    const response = NextResponse.json({
      ok: true,
      needsWorkspaceSelect: false,
      user: { id: user.id, email: user.email, name: user.name },
      tenant: {
        id: session.tenantId,
        slug: session.tenantSlug,
        name: session.tenantName,
        role: session.role,
      },
      company: session.legalEntityId
        ? {
            id: session.legalEntityId,
            code: session.legalEntityCode,
            name: session.legalEntityName,
          }
        : null,
      workspaces,
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    response.cookies.set(PREAUTH_COOKIE, "", {
      ...preauthCookieOptions(),
      maxAge: 0,
    });
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
