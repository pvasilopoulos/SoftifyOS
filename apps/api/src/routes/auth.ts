import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verify } from '@node-rs/argon2';
import { sql, withTenant } from '../db.js';
import { clearSession, issueSession, notImpersonating, requireAuth } from '../auth.js';
import { loadBrand } from './branding.js';
import { effectiveFilters } from '../filters.js';

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

  // End "Sign in as": back to the admin's own session
  app.post('/auth/impersonate/stop', { preHandler: requireAuth }, async (req, reply) => {
    const s = req.session;
    if (!s.impersonator) return reply.code(409).send({ error: 'not_impersonating' });
    const [m] = await sql<{ role: string }[]>`SELECT role FROM memberships WHERE user_id = ${s.impersonator} AND tenant_id = ${s.tenantId}`;
    if (!m) { clearSession(reply); return reply.code(401).send({ error: 'unauthorized' }); }
    const [u] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${s.userId}`;
    await withTenant(s.tenantId, (tx) => tx`INSERT INTO audit_log (tenant_id, actor_id, action, entity, details)
      VALUES (${s.tenantId}, ${s.impersonator!}, 'user.impersonate_stop', ${u?.email ?? null}, NULL)`);
    await issueSession(reply, { userId: s.impersonator, tenantId: s.tenantId, role: m.role });
    return { ok: true };
  });

  app.post('/auth/switch-tenant', { preHandler: [requireAuth, notImpersonating] }, async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.body);
    const [m] = await sql<{ role: string }[]>`SELECT role FROM memberships WHERE user_id = ${req.session.userId} AND tenant_id = ${tenantId}`;
    if (!m) return reply.code(403).send({ error: 'forbidden' });
    await issueSession(reply, { userId: req.session.userId, tenantId, role: m.role });
    return { ok: true };
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const { userId, tenantId } = req.session;
    const [user] = await sql`SELECT id, email, full_name, avatar_url, locale FROM users WHERE id = ${userId}`;
    const [impersonator] = req.session.impersonator
      ? await sql`SELECT id, email, full_name FROM users WHERE id = ${req.session.impersonator}` : [];
    // (tenant defaults are used to pre-fill new offers)
    const tenants = await sql`
      SELECT t.id, t.slug, t.name, m.role, r.name AS role_name, r.permissions, m.title, t.currency, t.default_vat_rate, t.offer_validity_days, t.offer_terms,
             coalesce((m.prefs->>'show_customer_avatar')::boolean, t.show_customer_avatar) AS show_customer_avatar,
             -- user choice → role default → organisation default
             coalesce(m.prefs->>'customers_view', t.index_defaults->'customers_view'->'roles'->>m.role, t.index_defaults->'customers_view'->>'org', 'list') AS customers_view,
             t.index_defaults, m.prefs
      FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      LEFT JOIN roles r ON r.tenant_id = m.tenant_id AND r.key = m.role
      WHERE m.user_id = ${userId} ORDER BY t.name`;
    const cur = tenants.find((t) => t.id === tenantId);
    // Custom fields marked "available in filters" (Module Forms) join every index's filters
    const customFilters = (await sql`
      SELECT form, key, type, label, options FROM custom_fields
      WHERE tenant_id = ${tenantId} AND active AND filterable AND form IN ('customer', 'branch', 'space') ORDER BY form, sort`)
      .map((c) => ({ key: `cf_${({ customer: 'c', branch: 'b', space: 's' } as Record<string, string>)[c.form]}_${c.key}`, type: c.type, label: c.label, options: c.options }));
    const withCustom = (keys: string[]) => [...keys, ...customFilters.map((c) => c.key)];
    // Which filters this user sees on each index page (Settings → Indexes)
    const tenant = cur && (({ index_defaults, prefs, ...t }) => ({
      ...t,
      index_filters: {
        customers: withCustom(effectiveFilters('customers', index_defaults, prefs, t.role).keys),
        tree: withCustom(effectiveFilters('tree', index_defaults, prefs, t.role).keys),
        stores: withCustom(effectiveFilters('stores', index_defaults, prefs, t.role).keys),
      },
      custom_filters: customFilters,
    }))(cur);
    return { user, tenant, tenants: tenants.map(({ index_defaults: _d, prefs: _p, ...t }) => t), brand: await loadBrand(tenantId), impersonator: impersonator ?? null };
  });
}
