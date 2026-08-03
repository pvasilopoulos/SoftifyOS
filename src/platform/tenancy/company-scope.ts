import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { SessionPayload } from "@/platform/auth/session";

export class CompanyScopeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CompanyScopeError";
    this.status = status;
  }
}

const COMPANY_REQUIRED_MSG =
  "Επιλέξτε εταιρεία (LegalEntity) από το header πριν συνεχίσετε";

/** Active company (B) is required for operational documents / APIs. */
export function requireCompanyId(session: SessionPayload): string {
  if (!session.legalEntityId) {
    throw new CompanyScopeError(COMPANY_REQUIRED_MSG, 400);
  }
  return session.legalEntityId;
}

/**
 * Server Components / pages: redirect instead of opaque production error boundary.
 * APIs should keep using `requireCompanyId` (JSON 400).
 */
export function requireCompanyIdForPage(session: SessionPayload): string {
  if (!session.legalEntityId) {
    redirect("/?selectCompany=1");
  }
  return session.legalEntityId;
}

/** Prisma where fragment for company-scoped lists. */
export function companyScopeWhere(session: SessionPayload): {
  legalEntityId: string;
} {
  return { legalEntityId: requireCompanyId(session) };
}

/** Stamp create payloads with active company. */
export function companyStamp(session: SessionPayload): {
  legalEntityId: string;
} {
  return { legalEntityId: requireCompanyId(session) };
}

/** Raw SQL AND fragment for company filter. */
export function companySqlAnd(
  session: SessionPayload,
  column = Prisma.sql`i."legalEntityId"`,
): Prisma.Sql {
  const id = requireCompanyId(session);
  return Prisma.sql`AND ${column} = ${id}`;
}

export function isCompanyScopeError(error: unknown): error is CompanyScopeError {
  return error instanceof CompanyScopeError;
}
