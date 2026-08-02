import type { PrismaClient } from "@/generated/prisma/client";
import type { MembershipRole } from "@/generated/prisma/client";
import {
  companyFields,
  signSession,
  type SessionPayload,
} from "@/platform/auth/session";
import {
  getAllowedCompanyIds,
  persistWorkspaceChoice,
  readWorkspacePrefs,
  resolveCompanyForTenant,
} from "@/platform/tenancy/workspace";

export async function issueWorkspaceSession(
  db: PrismaClient,
  input: {
    userId: string;
    email: string;
    name: string;
    tenantId: string;
    tenantSlug: string;
    tenantName: string;
    role: MembershipRole;
    legalEntityId?: string | null;
    existingPrefs?: unknown;
    membershipId?: string;
  },
): Promise<{ token: string; session: SessionPayload }> {
  const prefs = readWorkspacePrefs(input.existingPrefs);
  let allowedCompanyIds: string[] | null = null;
  if (input.membershipId) {
    allowedCompanyIds = await getAllowedCompanyIds(db, {
      membershipId: input.membershipId,
      role: input.role,
    });
  } else {
    const mem = await db.membership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: input.tenantId,
          userId: input.userId,
        },
      },
      select: { id: true },
    });
    if (mem) {
      allowedCompanyIds = await getAllowedCompanyIds(db, {
        membershipId: mem.id,
        role: input.role,
      });
    }
  }

  const { company } = await resolveCompanyForTenant(db, {
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    preferredCompanyId: input.legalEntityId,
    prefs,
    allowedCompanyIds,
  });

  await persistWorkspaceChoice(db, {
    userId: input.userId,
    tenantId: input.tenantId,
    legalEntityId: company?.id ?? null,
    existingPrefs: input.existingPrefs,
  });

  const session: SessionPayload = {
    sub: input.userId,
    email: input.email,
    name: input.name,
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    tenantName: input.tenantName,
    role: input.role,
    ...companyFields(company),
  };

  const token = await signSession(session);
  return { token, session };
}
