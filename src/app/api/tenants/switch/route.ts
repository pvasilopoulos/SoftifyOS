import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import {
  SESSION_COOKIE,
  getSession,
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

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { workspacePrefs: true },
    });

    const { token, session: next } = await issueWorkspaceSession(prisma, {
      userId: session.sub,
      email: session.email,
      name: session.name,
      tenantId: membership.tenantId,
      tenantSlug: membership.tenant.slug,
      tenantName: membership.tenant.name,
      role: membership.role,
      legalEntityId: body.legalEntityId,
      existingPrefs: user?.workspacePrefs,
      membershipId: membership.id,
    });

    await writeAuditEvent({
      tenantId: membership.tenantId,
      userId: session.sub,
      action: "tenant.switch",
      entity: "tenant",
      entityId: membership.tenantId,
      meta: {
        legalEntityId: next.legalEntityId,
        legalEntityCode: next.legalEntityCode,
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
