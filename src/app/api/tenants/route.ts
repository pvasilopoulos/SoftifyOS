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
import { issueWorkspaceSession } from "@/platform/tenancy/issue-session";
import { getErrorMessage } from "@/shared/lib/safe";
import { LedgerError } from "@/modules/ledger/service";
import {
  createTenantForUser,
  deleteTenantIfEmpty,
  listUserTenants,
  updateTenant,
} from "@/modules/org/service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(2).max(40).optional().nullable(),
  switchTo: z.boolean().optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(2).max(40).optional(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const items = await listUserTenants(prisma, session.sub);
    return NextResponse.json({
      items,
      currentTenantId: session.tenantId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = createSchema.parse(await request.json());
    const tenant = await createTenantForUser(prisma, {
      userId: session.sub,
      name: body.name,
      slug: body.slug,
    });

    await writeAuditEvent({
      tenantId: tenant.id,
      userId: session.sub,
      action: "tenant.create",
      entity: "tenant",
      entityId: tenant.id,
      meta: { slug: tenant.slug, name: tenant.name },
    });

    if (body.switchTo) {
      const user = await prisma.user.findUnique({
        where: { id: session.sub },
        select: { workspacePrefs: true },
      });
      const { token } = await issueWorkspaceSession(prisma, {
        userId: session.sub,
        email: session.email,
        name: session.name,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        role: "OWNER",
        existingPrefs: user?.workspacePrefs,
      });
      const res = NextResponse.json({ item: tenant, switched: true }, { status: 201 });
      res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      return res;
    }

    return NextResponse.json({ item: tenant }, { status: 201 });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = patchSchema.parse(await request.json());
    const membership = await prisma.membership.findUnique({
      where: {
        tenantId_userId: { tenantId: body.id, userId: session.sub },
      },
    });
    if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const item = await updateTenant(prisma, {
      tenantId: body.id,
      name: body.name,
      slug: body.slug,
    });

    await writeAuditEvent({
      tenantId: item.id,
      userId: session.sub,
      action: "tenant.update",
      entity: "tenant",
      entityId: item.id,
      meta: { name: item.name, slug: item.slug },
    });

    // Refresh session if editing current tenant
    if (body.id === session.tenantId) {
      const token = await signSession({
        ...session,
        tenantName: item.name,
        tenantSlug: item.slug,
        legalEntityId: session.legalEntityId,
        legalEntityCode: session.legalEntityCode,
        legalEntityName: session.legalEntityName,
      });
      const res = NextResponse.json({ item });
      res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      return res;
    }

    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    await deleteTenantIfEmpty(prisma, {
      tenantId: id,
      userId: session.sub,
    });

    await writeAuditEvent({
      tenantId: session.tenantId === id ? session.tenantId : session.tenantId,
      userId: session.sub,
      action: "tenant.delete",
      entity: "tenant",
      entityId: id,
    }).catch(() => undefined);

    if (session.tenantId === id) {
      const remaining = await listUserTenants(prisma, session.sub);
      const next = remaining[0];
      if (!next) {
        const res = NextResponse.json({ ok: true, switched: false });
        res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
        return res;
      }
      const membership = await prisma.membership.findUnique({
        where: {
          tenantId_userId: { tenantId: next.id, userId: session.sub },
        },
      });
      const user = await prisma.user.findUnique({
        where: { id: session.sub },
        select: { workspacePrefs: true },
      });
      const { token } = await issueWorkspaceSession(prisma, {
        userId: session.sub,
        email: session.email,
        name: session.name,
        tenantId: next.id,
        tenantSlug: next.slug,
        tenantName: next.name,
        role: membership?.role ?? "OWNER",
        existingPrefs: user?.workspacePrefs,
      });
      const res = NextResponse.json({ ok: true, switched: true, tenant: next });
      res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      return res;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
