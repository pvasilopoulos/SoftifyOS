import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';

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

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE];
  if (!token) return reply.code(401).send({ error: 'unauthorized' });
  try {
    const { payload } = await jwtVerify(token, key);
    req.session = { userId: payload.sub!, tenantId: payload.tid as string, role: payload.role as string };
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

const RANK: Record<string, number> = { viewer: 0, sales: 1, manager: 2, admin: 3, owner: 4 };
export const hasRole = (s: Session, min: keyof typeof RANK) => (RANK[s.role] ?? -1) >= RANK[min];
