import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { setMembershipCompanies } from "@/platform/tenancy/workspace";

export const dynamic = "force-dynamic";

const SYSTEM_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Tenants όπου ο τρέχων χρήστης μπορεί να διαχειριστεί memberships */
async function adminTenantIds(userId: string) {
  const rows = await prisma.membership.findMany({
    where: {
      userId,
      role: { in: ["OWNER", "ADMIN"] },
    },
    select: {
      tenantId: true,
      role: true,
      tenant: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows;
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const manageable = await adminTenantIds(session!.sub);
    const manageableIds = new Set(manageable.map((m) => m.tenantId));

    const memberships = await prisma.membership.findMany({
      where: { userId },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        companies: { select: { legalEntityId: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const tenantIds = [...new Set(memberships.map((m) => m.tenantId))];
    const allCompanies = await prisma.legalEntity.findMany({
      where: { tenantId: { in: tenantIds }, isActive: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      select: {
        id: true,
        tenantId: true,
        code: true,
        name: true,
        isDefault: true,
      },
    });
    const companiesByTenant = new Map<string, typeof allCompanies>();
    for (const c of allCompanies) {
      const list = companiesByTenant.get(c.tenantId) ?? [];
      list.push(c);
      companiesByTenant.set(c.tenantId, list);
    }

    return NextResponse.json({
      manageableTenants: manageable.map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        myRole: m.role,
      })),
      memberships: memberships.map((m) => {
        const allowed = m.companies.map((c) => c.legalEntityId);
        return {
          id: m.id,
          tenantId: m.tenantId,
          role: m.role,
          tenant: m.tenant,
          canManage: manageableIds.has(m.tenantId),
          /** null = όλες οι εταιρείες */
          allowedCompanyIds: allowed.length ? allowed : null,
          companies: (companiesByTenant.get(m.tenantId) ?? []).map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            isDefault: c.isDefault,
          })),
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

const upsertSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  role: z.enum(SYSTEM_ROLES).default("MEMBER"),
});

const removeSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  action: z.literal("remove"),
});

const setCompaniesSchema = z.object({
  action: z.literal("setCompanies"),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  /** null ή [] = όλες οι εταιρείες */
  companyIds: z.array(z.string().min(1)).nullable(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const raw = await request.json();

    if (raw?.action === "setCompanies") {
      const body = setCompaniesSchema.parse(raw);
      const myMem = await prisma.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: body.tenantId,
            userId: session!.sub,
          },
        },
      });
      if (!myMem || (myMem.role !== "OWNER" && myMem.role !== "ADMIN")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const target = await prisma.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: body.tenantId,
            userId: body.userId,
          },
        },
      });
      if (!target) {
        return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
      }
      const result = await setMembershipCompanies(prisma, {
        membershipId: target.id,
        tenantId: body.tenantId,
        companyIds: body.companyIds,
      });
      await writeAuditEvent({
        tenantId: body.tenantId,
        userId: session!.sub,
        action: "membership.companies.set",
        entity: "user",
        entityId: body.userId,
        meta: { allowedCompanyIds: result.allowedCompanyIds },
      });
      return NextResponse.json({
        ok: true,
        allowedCompanyIds: result.allowedCompanyIds,
      });
    }

    if (raw?.action === "remove") {
      const body = removeSchema.parse(raw);
      const myMem = await prisma.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: body.tenantId,
            userId: session!.sub,
          },
        },
      });
      if (!myMem || (myMem.role !== "OWNER" && myMem.role !== "ADMIN")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const target = await prisma.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: body.tenantId,
            userId: body.userId,
          },
        },
      });
      if (!target) {
        return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
      }
      if (target.role === "OWNER" && session!.role !== "OWNER") {
        return NextResponse.json(
          { error: "Μόνο OWNER αφαιρεί OWNER" },
          { status: 403 },
        );
      }
      if (body.userId === session!.sub) {
        return NextResponse.json(
          { error: "Δεν μπορείς να αφαιρέσεις τον εαυτό σου" },
          { status: 400 },
        );
      }

      await prisma.membership.delete({ where: { id: target.id } });
      await writeAuditEvent({
        tenantId: body.tenantId,
        userId: session!.sub,
        action: "membership.remove",
        entity: "user",
        entityId: body.userId,
      });
      return NextResponse.json({ ok: true });
    }

    const body = upsertSchema.parse(raw);
    const myMem = await prisma.membership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: body.tenantId,
          userId: session!.sub,
        },
      },
    });
    if (!myMem || (myMem.role !== "OWNER" && myMem.role !== "ADMIN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (body.role === "OWNER" && session!.role !== "OWNER" && myMem.role !== "OWNER") {
      return NextResponse.json(
        { error: "Μόνο OWNER ορίζει OWNER" },
        { status: 403 },
      );
    }

    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) {
      return NextResponse.json({ error: "Ο χρήστης δεν βρέθηκε" }, { status: 404 });
    }

    const item = await prisma.membership.upsert({
      where: {
        tenantId_userId: {
          tenantId: body.tenantId,
          userId: body.userId,
        },
      },
      create: {
        tenantId: body.tenantId,
        userId: body.userId,
        role: body.role,
      },
      update: { role: body.role },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        companies: { select: { legalEntityId: true } },
      },
    });

    await writeAuditEvent({
      tenantId: body.tenantId,
      userId: session!.sub,
      action: "membership.upsert",
      entity: "user",
      entityId: body.userId,
      meta: { role: body.role },
    });

    const allowed = item.companies.map((c) => c.legalEntityId);
    return NextResponse.json({
      item: {
        id: item.id,
        tenantId: item.tenantId,
        role: item.role,
        tenant: item.tenant,
        canManage: true,
        allowedCompanyIds: allowed.length ? allowed : null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
