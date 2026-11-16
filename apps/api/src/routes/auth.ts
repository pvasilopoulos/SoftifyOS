import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verify } from '@node-rs/argon2';
import { sql } from '../db.js';
import { clearSession, issueSession, requireAuth } from '../auth.js';

// Simple in-memory brute-force guard per IP+email (move to Redis when running several API instances)
const attempts = new Map<string, { n: number; until: number }>();

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1), tenant: z.string().optional() }).parse(req.body);
    const k = `${req.ip}:${body.email.toLowerCase()}`;
    const a = attempts.get(k);
    if (a && a.n >= 5 && a.until > Date.now()) return reply.code(429).send({ error: 'too_many_attempts' });

    const [user] = await sql<{ id: string; password_hash: string }[]>`SELECT id, password_hash FROM users WHERE lower(email) = lower(${body.email})`;
    const ok = user ? await verify(user.password_hash, body.password) : false;
    if (!ok) {
      attempts.set(k, { n: (a?.n ?? 0) + 1, until: Date.now() + 15 * 60_000 });
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    attempts.delete(k);

    const memberships = await sql<{ tenant_id: string; role: string; slug: string }[]>`
      SELECT m.tenant_id, m.role, t.slug FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ${user.id} ORDER BY m.created_at`;
    const m = memberships.find((x) => x.slug === body.tenant) ?? memberships[0];
    if (!m) return reply.code(403).send({ error: 'no_tenant' });
    await issueSession(reply, { userId: user.id, tenantId: m.tenant_id, role: m.role });
    return { ok: true };
  });

  app.post('/auth/logout', async (_req, reply) => { clearSession(reply); return { ok: true }; });

  app.post('/auth/switch-tenant', { preHandler: requireAuth }, async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.body);
    const [m] = await sql<{ role: string }[]>`SELECT role FROM memberships WHERE user_id = ${req.session.userId} AND tenant_id = ${tenantId}`;
    if (!m) return reply.code(403).send({ error: 'forbidden' });
    await issueSession(reply, { userId: req.session.userId, tenantId, role: m.role });
    return { ok: true };
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const { userId, tenantId } = req.session;
    const [user] = await sql`SELECT id, email, full_name, avatar_url, locale FROM users WHERE id = ${userId}`;
    // (tenant defaults are used to pre-fill new offers)
    const tenants = await sql`
      SELECT t.id, t.slug, t.name, m.role, m.title, t.currency, t.default_vat_rate, t.offer_validity_days, t.offer_terms,
             coalesce((m.prefs->>'show_customer_avatar')::boolean, t.show_customer_avatar) AS show_customer_avatar
      FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ${userId} ORDER BY t.name`;
    return { user, tenant: tenants.find((t) => t.id === tenantId), tenants };
  });
}
