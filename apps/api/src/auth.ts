import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';
import { sql } from './db.js';

export const COOKIE = 'sos_session';
const key = new TextEncoder().encode(env.jwtSecret);
const TTL_DAYS = 7;

export type Session = { userId: string; tenantId: string; role: string };

declare module 'fastify' {
  interface FastifyRequest { session: Session }
}

export async function issueSession(reply: FastifyReply, s: Session) {
  const token = await new SignJWT({ tid: s.tenantId, role: s.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_DAYS}d`)
    .sign(key);
  reply.setCookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, path: '/', maxAge: TTL_DAYS * 86400,
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: '/' });
}

// Membership check with a short cache: removing a user (or changing their role) takes effect
// within MEMBERSHIP_TTL, instead of when the 7-day token expires.
const MEMBERSHIP_TTL = 60_000;
const memberships = new Map<string, { role: string | null; at: number }>();

async function currentRole(userId: string, tenantId: string): Promise<string | null> {
  const k = `${tenantId}:${userId}`;
  const hit = memberships.get(k);
  if (hit && Date.now() - hit.at < MEMBERSHIP_TTL) return hit.role;
  // One query per user per minute: re-check membership and record "last seen" for the Users screen
  const [m] = await sql<{ role: string }[]>`
    UPDATE memberships SET last_seen_at = now() WHERE tenant_id = ${tenantId} AND user_id = ${userId} RETURNING role`;
  const role = m?.role ?? null;
  if (memberships.size > 50_000) memberships.clear();
  memberships.set(k, { role, at: Date.now() });
  return role;
}

/** Role change / removal: take effect on this instance immediately (others within MEMBERSHIP_TTL). */
export function invalidateMembership(userId: string, tenantId: string) {
  memberships.delete(`${tenantId}:${userId}`);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE];
  if (!token) return reply.code(401).send({ error: 'unauthorized' });
  let userId: string, tenantId: string;
  try {
    const { payload } = await jwtVerify(token, key);
    userId = payload.sub!;
    tenantId = payload.tid as string;
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const role = await currentRole(userId, tenantId);
  if (!role) { clearSession(reply); return reply.code(401).send({ error: 'unauthorized' }); }
  // Role always comes from the database, so role changes apply without re-login
  req.session = { userId, tenantId, role };
}

export const ROLE_RANK: Record<string, number> = { viewer: 0, sales: 1, manager: 2, admin: 3, owner: 4 };
export const hasRole = (s: Session, min: keyof typeof ROLE_RANK) => (ROLE_RANK[s.role] ?? -1) >= ROLE_RANK[min];
