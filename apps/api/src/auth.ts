import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';
import { sql } from './db.js';

export const COOKIE = 'sos_session';
const key = new TextEncoder().encode(env.jwtSecret);
const TTL_DAYS = 7;

/** perms/level come from the role (database) on every request; the token only carries ids. */
/** impersonator = the admin who signed in as this user ("Sign in as"); they get their own session back on stop. */
export type Session = { userId: string; tenantId: string; role: string; perms?: string[]; level?: number; impersonator?: string };
/** "Sign in as" sessions are short and cannot be extended. */
export const IMPERSONATION_HOURS = 2;

/** Every permission a role can have (Settings → Users & roles). */
export const PERMISSIONS = ['customers.edit', 'customers.delete', 'offers.edit', 'activities.all', 'tasks.all', 'views.share', 'forms.manage', 'settings.manage', 'users.manage', 'integrations.manage', 'audit.view', 'ai.use'] as const;
export type Permission = (typeof PERMISSIONS)[number];
/** Owners can do everything; everyone else needs the permission in their role. */
export const can = (s: Session, p: Permission) => s.role === 'owner' || !!s.perms?.includes(p);
/** Approval levels (approval_flow_steps.required_role uses these names). */
export const APPROVAL_LEVEL: Record<string, number> = { sales: 1, manager: 2, admin: 3, owner: 4 };

declare module 'fastify' {
  interface FastifyRequest { session: Session }
}

export async function issueSession(reply: FastifyReply, s: Session) {
  const imp = !!s.impersonator;
  const token = await new SignJWT({ tid: s.tenantId, role: s.role, ...(imp ? { imp: s.impersonator } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(imp ? `${IMPERSONATION_HOURS}h` : `${TTL_DAYS}d`)
    .sign(key);
  reply.setCookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, path: '/', maxAge: imp ? IMPERSONATION_HOURS * 3600 : TTL_DAYS * 86400,
  });
}

/** Personal account actions (password, email, profile, switching organisation) are not allowed while signed in as someone else. */
export async function notImpersonating(req: FastifyRequest, reply: FastifyReply) {
  if (req.session?.impersonator) return reply.code(403).send({ error: 'impersonating' });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: '/' });
}

// Membership check with a short cache: removing a user (or changing their role) takes effect
// within MEMBERSHIP_TTL, instead of when the 7-day token expires.
const MEMBERSHIP_TTL = 60_000;
type RoleInfo = { role: string; perms: string[]; level: number } | null;
const memberships = new Map<string, { info: RoleInfo; at: number }>();

async function currentRole(userId: string, tenantId: string, touch = true): Promise<RoleInfo> {
  const k = `${tenantId}:${userId}`;
  const hit = memberships.get(k);
  if (hit && Date.now() - hit.at < MEMBERSHIP_TTL) return hit.info;
  // One query per user per minute: re-check membership + role permissions, record "last seen" for the Users screen
  // (not while an admin is signed in as them: that is not the user being active)
  const [m] = touch
    ? await sql<{ role: string; permissions: string[]; approval_level: number }[]>`
    WITH m AS (UPDATE memberships SET last_seen_at = now() WHERE tenant_id = ${tenantId} AND user_id = ${userId} RETURNING tenant_id, role)
    SELECT m.role, r.permissions, r.approval_level FROM m JOIN roles r ON r.tenant_id = m.tenant_id AND r.key = m.role`
    : await sql<{ role: string; permissions: string[]; approval_level: number }[]>`
    SELECT m.role, r.permissions, r.approval_level FROM memberships m JOIN roles r ON r.tenant_id = m.tenant_id AND r.key = m.role
    WHERE m.tenant_id = ${tenantId} AND m.user_id = ${userId}`;
  const info = m ? { role: m.role, perms: m.permissions, level: m.approval_level } : null;
  if (memberships.size > 50_000) memberships.clear();
  memberships.set(k, { info, at: Date.now() });
  return info;
}

/** A role's permissions changed: everyone in the organisation gets them on their next request (this instance). */
export function invalidateTenantRoles(tenantId: string) {
  for (const k of memberships.keys()) if (k.startsWith(`${tenantId}:`)) memberships.delete(k);
}

/** Role change / removal: take effect on this instance immediately (others within MEMBERSHIP_TTL). */
export function invalidateMembership(userId: string, tenantId: string) {
  memberships.delete(`${tenantId}:${userId}`);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE];
  if (!token) return reply.code(401).send({ error: 'unauthorized' });
  let userId: string, tenantId: string, imp: string | undefined;
  try {
    const { payload } = await jwtVerify(token, key);
    userId = payload.sub!;
    tenantId = payload.tid as string;
    imp = typeof payload.imp === 'string' ? payload.imp : undefined;
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  // "Sign in as": the admin must still be a member allowed to manage users, otherwise the session ends
  if (imp) {
    const admin = await currentRole(imp, tenantId, false);
    if (!admin || !(admin.role === 'owner' || admin.perms.includes('users.manage'))) { clearSession(reply); return reply.code(401).send({ error: 'unauthorized' }); }
  }
  const info = await currentRole(userId, tenantId, !imp);
  if (!info) { clearSession(reply); return reply.code(401).send({ error: 'unauthorized' }); }
  // Role and permissions always come from the database, so changes apply without re-login
  req.session = { userId, tenantId, role: info.role, perms: info.perms, level: info.level, ...(imp ? { impersonator: imp } : {}) };
}


