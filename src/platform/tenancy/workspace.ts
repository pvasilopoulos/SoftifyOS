import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ensureDefaultLegalEntity } from "@/modules/ledger/controlling";

type Db = PrismaClient | Prisma.TransactionClient;

export type WorkspacePrefs = {
  companies?: Record<string, string>;
};

export type CompanyOpt = {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  isDefault: boolean;
};

export type MembershipWorkspace = {
  tenantId: string;
  slug: string;
  name: string;
  role: string;
  companies: CompanyOpt[];
  suggestedCompanyId: string | null;
};

function asPrefs(raw: unknown): WorkspacePrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const companies = (raw as WorkspacePrefs).companies;
  if (!companies || typeof companies !== "object") return {};
  return { companies: { ...companies } };
}

export function readWorkspacePrefs(raw: unknown): WorkspacePrefs {
  return asPrefs(raw);
}

export async function resolveCompanyForTenant(
  db: Db,
  input: {
    tenantId: string;
    tenantName: string;
    preferredCompanyId?: string | null;
    prefs?: WorkspacePrefs;
  },
) {
  await ensureDefaultLegalEntity(db, input.tenantId, input.tenantName);
  const companies = await db.legalEntity.findMany({
    where: { tenantId: input.tenantId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      vatNumber: true,
      isDefault: true,
    },
  });

  const preferred =
    input.preferredCompanyId ||
    input.prefs?.companies?.[input.tenantId] ||
    null;

  const chosen =
    (preferred ? companies.find((c) => c.id === preferred) : null) ??
    companies.find((c) => c.isDefault) ??
    companies[0] ??
    null;

  return { companies, company: chosen };
}

export async function buildMembershipWorkspaces(
  db: Db,
  input: {
    memberships: Array<{
      tenantId: string;
      role: string;
      tenant: { id: string; slug: string; name: string };
    }>;
    prefs?: WorkspacePrefs;
    lastTenantId?: string | null;
  },
): Promise<MembershipWorkspace[]> {
  const prefs = input.prefs ?? {};
  const rows: MembershipWorkspace[] = [];
  for (const m of input.memberships) {
    const { companies, company } = await resolveCompanyForTenant(db, {
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      prefs,
    });
    rows.push({
      tenantId: m.tenantId,
      slug: m.tenant.slug,
      name: m.tenant.name,
      role: m.role,
      companies,
      suggestedCompanyId: company?.id ?? null,
    });
  }
  // Prefer last tenant first in UI
  if (input.lastTenantId) {
    rows.sort((a, b) => {
      if (a.tenantId === input.lastTenantId) return -1;
      if (b.tenantId === input.lastTenantId) return 1;
      return a.name.localeCompare(b.name, "el");
    });
  }
  return rows;
}

export async function persistWorkspaceChoice(
  db: Db,
  input: {
    userId: string;
    tenantId: string;
    legalEntityId: string | null;
    existingPrefs?: unknown;
  },
) {
  const prefs = asPrefs(input.existingPrefs);
  const companies = { ...(prefs.companies ?? {}) };
  if (input.legalEntityId) {
    companies[input.tenantId] = input.legalEntityId;
  }
  return db.user.update({
    where: { id: input.userId },
    data: {
      lastTenantId: input.tenantId,
      workspacePrefs: { companies } as Prisma.InputJsonValue,
    },
  });
}
