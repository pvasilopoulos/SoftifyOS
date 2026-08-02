import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import {
  PREAUTH_COOKIE,
  SESSION_COOKIE,
  getPreauth,
  getSession,
  preauthCookieOptions,
  sessionCookieOptions,
} from "@/platform/auth/session";
import { issueWorkspaceSession } from "@/platform/tenancy/issue-session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const schema = z.object({
  tenantId: z.string().min(1),
  legalEntityId: z.string().min(1).optional().nullable(),
});

/**
 * Ολοκληρώνει login (preauth) ή αλλάζει workspace από ενεργό session.
 */
export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const session = await getSession();
    const preauth = await getPreauth();
    const userId = session?.sub ?? preauth?.sub;
    if (!userId) {
      return NextResponse.json(
        { error: "Απαιτείται σύνδεση ή επιλογή workspace" },
        { status: 401 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { tenant: true } },
      },
    });
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = user.memberships.find((m) => m.tenantId === body.tenantId);
    if (!membership) {
      return NextResponse.json(
        { error: "Δεν έχετε πρόσβαση σε αυτόν τον οργανισμό" },
        { status: 403 },
      );
    }

    const { token, session: next } = await issueWorkspaceSession(prisma, {
      userId: user.id,
      email: user.email,
      name: user.name,
      tenantId: membership.tenantId,
      tenantSlug: membership.tenant.slug,
      tenantName: membership.tenant.name,
      role: membership.role,
      legalEntityId: body.legalEntityId,
      existingPrefs: user.workspacePrefs,
      membershipId: membership.id,
    });

    await writeAuditEvent({
      tenantId: membership.tenantId,
      userId: user.id,
      action: session ? "workspace.switch" : "auth.login",
      entity: "tenant",
      entityId: membership.tenantId,
      meta: {
        legalEntityId: next.legalEntityId,
        legalEntityCode: next.legalEntityCode,
        fromPreauth: Boolean(preauth && !session),
      },
    });

    const res = NextResponse.json({
      ok: true,
      tenant: {
        id: next.tenantId,
        slug: next.tenantSlug,
        name: next.tenantName,
        role: next.role,
      },
      company: next.legalEntityId
        ? {
            id: next.legalEntityId,
            code: next.legalEntityCode,
            name: next.legalEntityName,
          }
        : null,
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    res.cookies.set(PREAUTH_COOKIE, "", { ...preauthCookieOptions(), maxAge: 0 });
    return res;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Workspace select failed") },
      { status: 400 },
    );
  }
}
