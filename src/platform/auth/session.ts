import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { MembershipRole } from "@/generated/prisma/client";

export const SESSION_COOKIE = "softifyos_session";
export const PREAUTH_COOKIE = "softifyos_preauth";

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: MembershipRole;
  /** B — ενεργή LegalEntity / Company μέσα στο tenant */
  legalEntityId: string | null;
  legalEntityCode: string | null;
  legalEntityName: string | null;
};

export type PreauthPayload = {
  sub: string;
  email: string;
  name: string;
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET must be set (min 16 chars)");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    tenantId: payload.tenantId,
    tenantSlug: payload.tenantSlug,
    tenantName: payload.tenantName,
    role: payload.role,
    legalEntityId: payload.legalEntityId,
    legalEntityCode: payload.legalEntityCode,
    legalEntityName: payload.legalEntityName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function signPreauth(payload: PreauthPayload) {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    kind: "preauth",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  if (!payload.sub || typeof payload.email !== "string") return null;
  if (payload.kind === "preauth") return null;

  return {
    sub: payload.sub,
    email: payload.email,
    name: String(payload.name ?? ""),
    tenantId: String(payload.tenantId ?? ""),
    tenantSlug: String(payload.tenantSlug ?? ""),
    tenantName: String(payload.tenantName ?? ""),
    role: payload.role as MembershipRole,
    legalEntityId:
      typeof payload.legalEntityId === "string" ? payload.legalEntityId : null,
    legalEntityCode:
      typeof payload.legalEntityCode === "string"
        ? payload.legalEntityCode
        : null,
    legalEntityName:
      typeof payload.legalEntityName === "string"
        ? payload.legalEntityName
        : null,
  } satisfies SessionPayload;
}

export async function verifyPreauthToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  if (!payload.sub || typeof payload.email !== "string") return null;
  if (payload.kind !== "preauth") return null;
  return {
    sub: payload.sub,
    email: payload.email,
    name: String(payload.name ?? ""),
  } satisfies PreauthPayload;
}

export async function getSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

export async function getPreauth() {
  const jar = await cookies();
  const token = jar.get(PREAUTH_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifyPreauthToken(token);
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export function sessionCookieOptions(maxAgeSeconds = 60 * 60 * 24 * 7) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function preauthCookieOptions(maxAgeSeconds = 60 * 15) {
  return sessionCookieOptions(maxAgeSeconds);
}

export function companyFields(company: {
  id: string;
  code: string;
  name: string;
} | null) {
  return {
    legalEntityId: company?.id ?? null,
    legalEntityCode: company?.code ?? null,
    legalEntityName: company?.name ?? null,
  };
}
