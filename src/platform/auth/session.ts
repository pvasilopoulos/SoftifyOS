import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { MembershipRole } from "@/generated/prisma/client";

export const SESSION_COOKIE = "softifyos_session";

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: MembershipRole;
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
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  if (!payload.sub || typeof payload.email !== "string") return null;

  return {
    sub: payload.sub,
    email: payload.email,
    name: String(payload.name ?? ""),
    tenantId: String(payload.tenantId ?? ""),
    tenantSlug: String(payload.tenantSlug ?? ""),
    tenantName: String(payload.tenantName ?? ""),
    role: payload.role as MembershipRole,
  } satisfies SessionPayload;
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
