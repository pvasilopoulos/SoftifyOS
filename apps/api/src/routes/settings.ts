// Settings module: organisation, issuing companies, users & roles (invitations), approval flow,
// product catalogue, value lists, my profile, audit log. Admin-only except "my profile".
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import { decodeCursor, encodeCursor, searchKey, sql, withTenant, type Tx } from '../db.js';
import { hasRole, invalidateMembership, issueSession, requireAuth, ROLE_RANK, type Session } from '../auth.js';
import { enqueue } from '../jobs.js';
import { env } from '../env.js';

const opt = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const idParam = z.object({ id: z.string().uuid() });
const ROLES = ['viewer', 'sales', 'manager', 'admin', 'owner'] as const;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function audit(tx: Tx, s: Session, action: string, entity: string | null, details?: unknown) {
  await tx`INSERT INTO audit_log (tenant_id, actor_id, action, entity, details)
           VALUES (${s.tenantId}, ${s.userId}, ${action}, ${entity}, ${details === undefined ? null : tx.json(details as never)})`;
}

const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });

export default async function settingsRoutes(app: FastifyInstance) {
  // ======================= Public: accept invitation =======================
  app.get('/invitations/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(req.params);
    const [inv] = await sql`
      SELECT i.expires_at, i.accepted_at, u.email, u.full_name, t.name AS tenant_name
      FROM invitations i JOIN users u ON u.id = i.user_id JOIN tenants t ON t.id = i.tenant_id
      WHERE i.token_hash = ${sha256(token)}`;
    if (!inv) return reply.code(404).send({ error: 'not_found' });
    if (inv.accepted_at) return reply.code(410).send({ error: 'used' });
    if (new Date(inv.expires_at) < new Date()) return reply.code(410).send({ error: 'expired' });
    return { email: inv.email, full_name: inv.full_name, tenant_name: inv.tenant_name };
  });

  app.post('/invitations/:token/accept', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(req.params);
    const b = z.object({ password: z.string().min(10).max(200), full_name: z.string().trim().min(2).max(120).optional() }).parse(req.body);
    const res = await sql.begin(async (tx) => {
      const [inv] = await tx`
        SELECT i.id, i.tenant_id, i.user_id, i.expires_at, i.accepted_at, m.role
        FROM invitations i JOIN memberships m ON m.tenant_id = i.tenant_id AND m.user_id = i.user_id
        WHERE i.token_hash = ${sha256(token)} FOR UPDATE OF i`;
      if (!inv) return { code: 404 as const };
      if (inv.accepted_at || new Date(inv.expires_at) < new Date()) return { code: 410 as const };
      await tx`UPDATE users SET password_hash = ${await hash(b.password)}, password_set = true
               ${b.full_name ? tx`, full_name = ${b.full_name}` : tx``} WHERE id = ${inv.user_id}`;
      await tx`UPDATE invitations SET accepted_at = now() WHERE id = ${inv.id}`;
      return { code: 200 as const, session: { userId: inv.user_id as string, tenantId: inv.tenant_id as string, role: inv.role as string } };
    });
    if (res.code !== 200) return reply.code(res.code).send({ error: res.code === 404 ? 'not_found' : 'expired' });
    await issueSession(reply, res.session);
    return { ok: true };
  });

  // ======================= Authenticated =======================
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    // ---------- My profile (any role) ----------
    r.put('/me', async (req) => {
      const b = z.object({ full_name: z.string().trim().min(2).max(120), locale: z.enum(['el', 'en']) }).parse(req.body);
      await sql`UPDATE users SET full_name = ${b.full_name}, locale = ${b.locale} WHERE id = ${req.session.userId}`;
      return { ok: true };
    });

    r.post('/me/password', async (req, reply) => {
      const b = z.object({ current: z.string().min(1), next: z.string().min(10).max(200) }).parse(req.body);
      const [u] = await sql`SELECT password_hash FROM users WHERE id = ${req.session.userId}`;
      if (!u || !(await verify(u.password_hash, b.current))) return reply.code(400).send({ error: 'wrong_password' });
      await sql`UPDATE users SET password_hash = ${await hash(b.next)} WHERE id = ${req.session.userId}`;
      await withTenant(req.session.tenantId, (tx) => audit(tx, req.session, 'profile.password', null));
      return { ok: true };
    });

    // ---------- Organisation ----------
    r.get('/settings/organization', async (req) => {
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => {
        const [t] = await tx`
          SELECT id, slug, name, legal_name, vat, email, phone, website, address, locale, timezone, currency,
                 default_vat_rate, offer_prefix, offer_validity_days, offer_terms, plan, created_at
          FROM tenants WHERE id = ${T}`;
        const [counts] = await tx`
          SELECT (SELECT count(*) FROM memberships WHERE tenant_id = ${T})::int AS users,
                 (SELECT value FROM tenant_counters WHERE tenant_id = ${T} AND key = 'customers') AS customers,
                 (SELECT coalesce(sum(count), 0) FROM tenant_offer_stats WHERE tenant_id = ${T}) AS offers`;
        return { ...t, counts, can_edit: hasRole(req.session, 'admin') };
      });
    });

    r.put('/settings/organization', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const b = z.object({
        name: z.string().trim().min(2).max(120), legal_name: opt(200), vat: opt(20), email: z.string().trim().email().max(200).nullish().or(z.literal('')).transform((v) => v || null),
        phone: opt(40), website: opt(200), address: opt(300), locale: z.enum(['el', 'en']),
        timezone: z.string().trim().min(3).max(60), currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
        default_vat_rate: z.coerce.number().min(0).max(100),
        offer_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/),
        offer_validity_days: z.coerce.number().int().min(1).max(365),
        offer_terms: opt(10000),
      }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET ${tx(b)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'organization.update', b.name, b);
      });
      return { ok: true };
    });

    // ---------- Issuing companies ----------
    const companySchema = z.object({
      name: z.string().trim().min(2).max(200), vat: opt(20), tax_office: opt(100), address: opt(300),
      phone: opt(40), email: z.string().trim().email().max(200).nullish().or(z.literal('')).transform((v) => v || null),
      iban: z.string().trim().max(40).nullish().transform((v) => (v ? v.replace(/\s/g, '').toUpperCase() : null)),
      is_default: z.boolean().default(false), active: z.boolean().default(true),
    });

    r.get('/settings/companies', async (req) => {
      const T = req.session.tenantId;
      return withTenant(T, (tx) => tx`
        SELECT c.*, (SELECT count(*) FROM offers o WHERE o.company_id = c.id)::int AS offers
        FROM companies c WHERE c.tenant_id = ${T} ORDER BY c.is_default DESC, c.name`);
    });

    r.post('/settings/companies', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const b = companySchema.parse(req.body);
      const s = req.session;
      const row = await withTenant(s.tenantId, async (tx) => {
        if (b.is_default) await tx`UPDATE companies SET is_default = false WHERE tenant_id = ${s.tenantId} AND is_default`;
        const [c] = await tx`INSERT INTO companies ${tx({ ...b, tenant_id: s.tenantId })} RETURNING id`;
        await audit(tx, s, 'company.create', b.name);
        return c;
      });
      return reply.code(201).send(row);
    });

    r.put('/settings/companies/:id', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = companySchema.parse(req.body);
      const s = req.session;
      const ok = await withTenant(s.tenantId, async (tx) => {
        if (b.is_default) await tx`UPDATE companies SET is_default = false WHERE tenant_id = ${s.tenantId} AND is_default AND id <> ${id}`;
        const [c] = await tx`UPDATE companies SET ${tx(b)} WHERE id = ${id} RETURNING id`;
        if (c) await audit(tx, s, 'company.update', b.name);
        return !!c;
      });
      return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
    });

    r.delete('/settings/companies/:id', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [used] = await tx`SELECT 1 FROM offers WHERE company_id = ${id} LIMIT 1`;
        if (used) return 409; // has offers: deactivate instead
        const [c] = await tx`DELETE FROM companies WHERE id = ${id} RETURNING name`;
        if (c) await audit(tx, s, 'company.delete', c.name);
        return c ? 200 : 404;
      });
      return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 409 ? 'in_use' : 'not_found' });
    });

    // ---------- Users & roles ----------
    r.get('/settings/users', async (req) => {
      const T = req.session.tenantId;
      return withTenant(T, (tx) => tx`
        SELECT u.id, u.email, u.full_name, u.password_set, m.role, m.title, m.created_at, m.last_seen_at,
               (SELECT max(created_at) FROM invitations i WHERE i.tenant_id = ${T} AND i.user_id = u.id AND i.accepted_at IS NULL AND i.expires_at > now()) AS pending_invite
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ${T}
        ORDER BY array_position(${tx.array([...ROLES].reverse())}::text[], m.role), u.full_name`);
    });

    /** Owners can grant any role; admins up to admin. Nobody can act on a role above their own. */
    const canAssign = (s: Session, role: string) => (ROLE_RANK[role] ?? 99) <= (s.role === 'owner' ? ROLE_RANK.owner : ROLE_RANK.admin);

    async function createInvitation(tx: Tx, s: Session, userId: string, email: string, locale: string) {
      const token = randomBytes(32).toString('base64url');
      await tx`UPDATE invitations SET expires_at = now() WHERE tenant_id = ${s.tenantId} AND user_id = ${userId} AND accepted_at IS NULL`;
      await tx`INSERT INTO invitations (tenant_id, user_id, token_hash, invited_by, expires_at)
               VALUES (${s.tenantId}, ${userId}, ${sha256(token)}, ${s.userId}, now() + interval '7 days')`;
      const url = `${env.appUrl.replace(/\/$/, '')}/${locale}/invite/${token}`;
      const [t] = await tx`SELECT name FROM tenants WHERE id = ${s.tenantId}`;
      await enqueue('email', {
        to: email,
        subject: locale === 'el' ? `Πρόσκληση στο SoftifyOS (${t.name})` : `You're invited to SoftifyOS (${t.name})`,
        text: (locale === 'el'
          ? `Σας προσκάλεσαν στον οργανισμό «${t.name}» στο SoftifyOS.\nΟρίστε κωδικό εδώ (ισχύει 7 ημέρες):\n`
          : `You have been invited to “${t.name}” on SoftifyOS.\nSet your password here (valid for 7 days):\n`) + url,
      }, tx);
      return url;
    }

    r.post('/settings/users/invite', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const b = z.object({
        email: z.string().trim().toLowerCase().email().max(200), full_name: z.string().trim().min(2).max(120),
        role: z.enum(ROLES), title: opt(120), locale: z.enum(['el', 'en']).default('el'),
      }).parse(req.body);
      const s = req.session;
      if (!canAssign(s, b.role)) return forbid(reply);
      const res = await withTenant(s.tenantId, async (tx) => {
        // users is a global table: read/insert through the owner connection inside the same flow
        let [u] = await sql`SELECT id, password_set FROM users WHERE lower(email) = ${b.email}`;
        if (!u) {
          [u] = await sql`INSERT INTO users (email, password_hash, full_name, locale, password_set)
                          VALUES (${b.email}, ${await hash(randomBytes(32).toString('hex'))}, ${b.full_name}, ${b.locale}, false)
                          RETURNING id, password_set`;
        }
        const [exists] = await tx`SELECT 1 FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ${u.id}`;
        if (exists) return { code: 409 as const };
        await tx`INSERT INTO memberships (tenant_id, user_id, role, title) VALUES (${s.tenantId}, ${u.id}, ${b.role}, ${b.title})`;
        // Existing accounts already have a password: they just see the new organisation at login
        const inviteUrl = u.password_set ? null : await createInvitation(tx, s, u.id, b.email, b.locale);
        await audit(tx, s, 'user.invite', b.email, { role: b.role });
        return { code: 201 as const, inviteUrl, existing: u.password_set as boolean };
      });
      if (res.code === 409) return reply.code(409).send({ error: 'already_member' });
      return reply.code(201).send({ inviteUrl: res.inviteUrl, existing: res.existing, emailed: env.smtpConfigured });
    });

    r.post('/settings/users/:id/resend', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const [u] = await sql`SELECT email, locale, password_set FROM users WHERE id = ${id}`;
      if (!u || u.password_set) return reply.code(409).send({ error: 'not_pending' });
      const url = await withTenant(s.tenantId, async (tx) => {
        const [m] = await tx`SELECT 1 FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ${id}`;
        if (!m) return null;
        const link = await createInvitation(tx, s, id, u.email, u.locale ?? 'el');
        await audit(tx, s, 'user.invite_resend', u.email);
        return link;
      });
      return url ? { inviteUrl: url } : reply.code(404).send({ error: 'not_found' });
    });

    async function ownersLeft(tx: Tx, tenantId: string, excluding: string) {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = ${tenantId} AND role = 'owner' AND user_id <> ${excluding}`;
      return n;
    }

    r.put('/settings/users/:id', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = z.object({ role: z.enum(ROLES), title: opt(120) }).parse(req.body);
      const s = req.session;
      if (!canAssign(s, b.role)) return forbid(reply);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [m] = await tx`SELECT m.role, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} AND m.user_id = ${id} FOR UPDATE OF m`;
        if (!m) return { code: 404, error: 'not_found' };
        if (!canAssign(s, m.role)) return { code: 403, error: 'forbidden' };
        if (m.role === 'owner' && b.role !== 'owner' && (await ownersLeft(tx, s.tenantId, id)) === 0) return { code: 409, error: 'last_owner' };
        await tx`UPDATE memberships SET role = ${b.role}, title = ${b.title} WHERE tenant_id = ${s.tenantId} AND user_id = ${id}`;
        await audit(tx, s, 'user.role', m.email, { from: m.role, to: b.role });
        return { code: 200, error: null };
      });
      if (res.code !== 200) return reply.code(res.code).send({ error: res.error });
      invalidateMembership(id, s.tenantId);
      return { ok: true };
    });

    r.delete('/settings/users/:id', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const s = req.session;
      if (id === s.userId) return reply.code(409).send({ error: 'cannot_remove_self' });
      const res = await withTenant(s.tenantId, async (tx) => {
        const [m] = await tx`SELECT m.role, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} AND m.user_id = ${id} FOR UPDATE OF m`;
        if (!m) return { code: 404, error: 'not_found' };
        if (!canAssign(s, m.role)) return { code: 403, error: 'forbidden' };
        if (m.role === 'owner' && (await ownersLeft(tx, s.tenantId, id)) === 0) return { code: 409, error: 'last_owner' };
        await tx`DELETE FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ${id}`;
        await tx`DELETE FROM push_subscriptions WHERE tenant_id = ${s.tenantId} AND user_id = ${id}`;
        await tx`UPDATE invitations SET expires_at = now() WHERE tenant_id = ${s.tenantId} AND user_id = ${id} AND accepted_at IS NULL`;
        await audit(tx, s, 'user.remove', m.email, { role: m.role });
        return { code: 200, error: null };
      });
      if (res.code !== 200) return reply.code(res.code).send({ error: res.error });
      invalidateMembership(id, s.tenantId); // access revoked immediately
      return { ok: true };
    });

    // ---------- Product catalogue ----------
    const productSchema = z.object({
      sku: z.string().trim().min(1).max(40), name: z.string().trim().min(2).max(200), unit: z.string().trim().min(1).max(20),
      unit_price: z.coerce.number().min(0).max(1e9), vat_rate: z.coerce.number().min(0).max(100), active: z.boolean().default(true),
    });

    r.get('/settings/products', async (req) => {
      const q = z.object({ q: z.string().trim().max(100).optional(), cursor: z.string().optional(), inactive: z.enum(['0', '1']).default('1') }).parse(req.query);
      const T = req.session.tenantId;
      const key = q.q && q.q.length >= 2 ? `%${searchKey(q.q)}%` : null;
      const cur = decodeCursor<[string, string]>(q.cursor);
      return withTenant(T, async (tx) => {
        const rows = await tx`
          SELECT id, sku, name, unit, unit_price, vat_rate, active FROM products
          WHERE tenant_id = ${T} ${q.inactive === '0' ? tx`AND active` : tx``}
            ${key ? tx`AND search LIKE ${key}` : tx``}
            ${cur ? tx`AND (name, id) > (${cur[0]}, ${cur[1]}::uuid)` : tx``}
          ORDER BY name, id LIMIT 51`;
        const more = rows.length > 50;
        const items = more ? rows.slice(0, 50) : rows;
        const l = items.at(-1);
        return { items, nextCursor: more && l ? encodeCursor([l.name, l.id]) : null };
      });
    });

    r.post('/settings/products', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const b = productSchema.parse(req.body);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [dup] = await tx`SELECT 1 FROM products WHERE tenant_id = ${s.tenantId} AND sku = ${b.sku}`;
        if (dup) return null;
        const [p] = await tx`INSERT INTO products ${tx({ ...b, tenant_id: s.tenantId })} RETURNING id`;
        await audit(tx, s, 'product.create', `${b.sku} ${b.name}`);
        return p;
      });
      return res ? reply.code(201).send(res) : reply.code(409).send({ error: 'sku_taken' });
    });

    r.put('/settings/products/:id', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = productSchema.parse(req.body);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [dup] = await tx`SELECT 1 FROM products WHERE tenant_id = ${s.tenantId} AND sku = ${b.sku} AND id <> ${id}`;
        if (dup) return 409;
        const [p] = await tx`UPDATE products SET ${tx(b)} WHERE id = ${id} RETURNING id`;
        if (p) await audit(tx, s, 'product.update', `${b.sku} ${b.name}`);
        return p ? 200 : 404;
      });
      return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 409 ? 'sku_taken' : 'not_found' });
    });

    // ---------- Value lists (zones, fee schedules, tours) ----------
    const listParam = z.enum(['geo_zone', 'fee_schedule', 'tour', 'ongoing_status']);

    r.get('/settings/lookups', async (req) => {
      const { list } = z.object({ list: listParam }).parse(req.query);
      const T = req.session.tenantId;
      return withTenant(T, (tx) => tx`
        SELECT l.id, l.name, l.sort, l.active,
               (SELECT count(*) FROM branches b WHERE b.geo_zone_id = l.id OR b.fee_schedule_id = l.id OR b.tour_id = l.id OR b.ongoing_status_id = l.id)::int
             + (SELECT count(*) FROM customers c WHERE c.geo_zone_id = l.id)::int AS usage
        FROM lookup_values l WHERE l.tenant_id = ${T} AND l.list = ${list} ORDER BY l.sort, l.name`);
    });

    r.put('/settings/lookups/:id', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = z.object({ name: z.string().trim().min(1).max(80), active: z.boolean(), sort: z.coerce.number().int().min(0).max(10000) }).parse(req.body);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [dup] = await tx`
          SELECT 1 FROM lookup_values WHERE tenant_id = ${s.tenantId} AND id <> ${id}
            AND list = (SELECT list FROM lookup_values WHERE id = ${id}) AND search_key(name) = search_key(${b.name})`;
        if (dup) return 409;
        const [l] = await tx`UPDATE lookup_values SET ${tx(b)} WHERE id = ${id} RETURNING list`;
        if (l) await audit(tx, s, 'lookup.update', `${l.list}: ${b.name}`, b);
        return l ? 200 : 404;
      });
      return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 409 ? 'duplicate' : 'not_found' });
    });

    r.put('/settings/lookups/order', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
      await withTenant(req.session.tenantId, async (tx) => {
        await tx`UPDATE lookup_values l SET sort = x.ord FROM unnest(${tx.array(ids)}::uuid[]) WITH ORDINALITY AS x(id, ord) WHERE l.id = x.id`;
      });
      return { ok: true };
    });

    r.delete('/settings/lookups/:id', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [used] = await tx`
          SELECT 1 WHERE EXISTS (SELECT 1 FROM branches WHERE geo_zone_id = ${id} OR fee_schedule_id = ${id} OR tour_id = ${id} OR ongoing_status_id = ${id})
                      OR EXISTS (SELECT 1 FROM customers WHERE geo_zone_id = ${id})`;
        if (used) return 409; // in use: deactivate instead, history stays intact
        const [l] = await tx`DELETE FROM lookup_values WHERE id = ${id} RETURNING list, name`;
        if (l) await audit(tx, s, 'lookup.delete', `${l.list}: ${l.name}`);
        return l ? 200 : 404;
      });
      return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 409 ? 'in_use' : 'not_found' });
    });

    // ---------- Audit log ----------
    r.get('/settings/audit', async (req, reply) => {
      if (!hasRole(req.session, 'admin')) return forbid(reply);
      const q = z.object({ cursor: z.string().optional() }).parse(req.query);
      const cur = decodeCursor<[string, string]>(q.cursor);
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => {
        const rows = await tx`
          SELECT a.id, a.action, a.entity, a.details, a.created_at, u.full_name AS actor_name
          FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.tenant_id = ${T} ${cur ? tx`AND (a.created_at, a.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
          ORDER BY a.created_at DESC, a.id DESC LIMIT 51`;
        const more = rows.length > 50;
        const items = more ? rows.slice(0, 50) : rows;
        const l = items.at(-1);
        return { items, nextCursor: more && l ? encodeCursor([l.created_at, l.id]) : null };
      });
    });
  });
}
