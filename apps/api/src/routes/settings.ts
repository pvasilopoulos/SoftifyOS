// Settings module: organisation, issuing companies, users & roles (invitations), approval flow,
// product catalogue, value lists, my profile, audit log. Admin-only except "my profile".
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import { decodeCursor, encodeCursor, searchKey, sql, withTenant, type Tx } from '../db.js';
import { planOf } from '../billing.js';
import { can, invalidateMembership, invalidateTenantRoles, issueSession, notImpersonating, PERMISSIONS, requireAuth, type Permission, type Session } from '../auth.js';
import { enqueue } from '../jobs.js';
import { DEFAULT_VISIBLE, effectiveFilters, FILTER_KEYS, INDEX_FILTERS, INDEXES } from '../filters.js';
import { ALL_LISTS, isNameList, nameInUse, nameListUsage, renameInRecords } from '../lookups.js';
import { env } from '../env.js';

const opt = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const idParam = z.object({ id: z.string().uuid() });
const CUSTOMER_VIEWS = ['list', 'tree', 'stores'] as const;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Customer page tabs (contacts live inside "overview"). Unknown keys dropped, new ones appended visible,
// the overview can be moved but never hidden.
// Grids whose layout can be saved per organisation / user
const GRIDS = ['customer_actions'] as const;
export const CUSTOMER_TABS = ['overview', 'subsidiaries', 'branches', 'offers', 'actions', 'activity', 'tasks', 'documents'] as const;
type TabCfg = { key: string; hidden: boolean }[];
const tabsSchema = z.array(z.object({ key: z.enum(CUSTOMER_TABS), hidden: z.boolean() })).max(20);
function normalizeTabs(list: TabCfg) {
  const seen = new Set<string>();
  const out = list.filter((x) => (CUSTOMER_TABS as readonly string[]).includes(x.key) && !seen.has(x.key) && seen.add(x.key))
    .map((x) => ({ key: x.key, hidden: x.key === 'overview' ? false : !!x.hidden }));
  for (const k of CUSTOMER_TABS) if (!seen.has(k)) out.push({ key: k, hidden: false });
  return out;
}

export async function audit(tx: Tx, s: Session, action: string, entity: string | null, details?: unknown) {
  // While signed in as someone else, every entry says which admin really did it
  const d = s.impersonator ? { ...(details && typeof details === 'object' ? details : details === undefined ? {} : { value: details }), impersonated_by: s.impersonator } : details;
  await tx`INSERT INTO audit_log (tenant_id, actor_id, action, entity, details)
           VALUES (${s.tenantId}, ${s.userId}, ${action}, ${entity}, ${d === undefined ? null : tx.json(d as never)})`;
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
    r.put('/me', { preHandler: notImpersonating }, async (req) => {
      const b = z.object({ full_name: z.string().trim().min(2).max(120), locale: z.enum(['el', 'en']) }).parse(req.body);
      await sql`UPDATE users SET full_name = ${b.full_name}, locale = ${b.locale} WHERE id = ${req.session.userId}`;
      return { ok: true };
    });

    // Changing the sign-in email needs the current password
    r.post('/me/email', { preHandler: notImpersonating }, async (req, reply) => {
      const b = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1) }).parse(req.body);
      const [u] = await sql`SELECT email, password_hash FROM users WHERE id = ${req.session.userId}`;
      if (!u || !(await verify(u.password_hash, b.password))) return reply.code(400).send({ error: 'wrong_password' });
      if (u.email.toLowerCase() === b.email) return { ok: true };
      const [taken] = await sql`SELECT 1 FROM users WHERE lower(email) = ${b.email} AND id <> ${req.session.userId}`;
      if (taken) return reply.code(409).send({ error: 'email_taken' });
      try {
        await sql`UPDATE users SET email = ${b.email} WHERE id = ${req.session.userId}`;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'email_taken' });
        throw e;
      }
      await withTenant(req.session.tenantId, (tx) => audit(tx, req.session, 'profile.email', null, { from: u.email, to: b.email }));
      return { ok: true };
    });

    r.post('/me/password', { preHandler: notImpersonating }, async (req, reply) => {
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
        return { ...t, counts, can_edit: can(req.session, 'settings.manage') };
      });
    });

    r.put('/settings/organization', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const b = z.object({
        name: z.string().trim().min(2).max(120), legal_name: opt(200), vat: opt(20), email: z.string().trim().email().max(200).nullish().or(z.literal('')).transform((v) => v || null),
        phone: opt(40), website: opt(200), address: opt(300), locale: z.enum(['el', 'en']),
        timezone: z.string().trim().min(3).max(60), currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
        default_vat_rate: z.coerce.number().min(0).max(100),
        offer_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/),
        offer_validity_days: z.coerce.number().int().min(1).max(365),
        offer_terms: opt(10000),
        // Short unique identifier (used when signing in to a specific organisation)
        slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/),
      }).parse(req.body);
      const s = req.session;
      // Uniqueness is global, so check with the owner connection (RLS only shows this tenant)
      const [taken] = await sql`SELECT 1 FROM tenants WHERE slug = ${b.slug} AND id <> ${s.tenantId}`;
      if (taken) return reply.code(409).send({ error: 'slug_taken' });
      try {
        await withTenant(s.tenantId, async (tx) => {
          await tx`UPDATE tenants SET ${tx(b)}, updated_at = now() WHERE id = ${s.tenantId}`;
          await audit(tx, s, 'organization.update', b.name, b);
        });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'slug_taken' });
        throw e;
      }
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
      if (!can(req.session, 'settings.manage')) return forbid(reply);
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
      if (!can(req.session, 'settings.manage')) return forbid(reply);
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
      if (!can(req.session, 'settings.manage')) return forbid(reply);
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
        ORDER BY (SELECT sort FROM roles r WHERE r.tenant_id = m.tenant_id AND r.key = m.role), u.full_name`);
    });

    /** Only owners can grant the owner role or act on owners. */
    const canAssign = (s: Session, role: string) => role !== 'owner' || s.role === 'owner';
    const roleKey = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/);
    const roleExists = async (tx: Tx, key: string) => (await tx`SELECT 1 FROM roles WHERE key = ${key}`).length > 0;

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
      if (!can(req.session, 'users.manage')) return forbid(reply);
      const b = z.object({
        email: z.string().trim().toLowerCase().email().max(200), full_name: z.string().trim().min(2).max(120),
        role: roleKey, title: opt(120), locale: z.enum(['el', 'en']).default('el'),
      }).parse(req.body);
      const s = req.session;
      if (!canAssign(s, b.role)) return forbid(reply);
      const res = await withTenant(s.tenantId, async (tx) => {
        if (!(await roleExists(tx, b.role))) return { code: 400 as const };
        // users is a global table: read/insert through the owner connection inside the same flow
        let [u] = await sql`SELECT id, password_set FROM users WHERE lower(email) = ${b.email}`;
        if (!u) {
          [u] = await sql`INSERT INTO users (email, password_hash, full_name, locale, password_set)
                          VALUES (${b.email}, ${await hash(randomBytes(32).toString('hex'))}, ${b.full_name}, ${b.locale}, false)
                          RETURNING id, password_set`;
        }
        const [exists] = await tx`SELECT 1 FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ${u.id}`;
        if (exists) return { code: 409 as const };
        const lim = (await planOf(s.tenantId)).limits.users;
        if (lim !== null && (await tx`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = ${s.tenantId}`)[0].n >= lim) return { code: 402 as const, limit: lim };
        await tx`INSERT INTO memberships (tenant_id, user_id, role, title) VALUES (${s.tenantId}, ${u.id}, ${b.role}, ${b.title})`;
        // Existing accounts already have a password: they just see the new organisation at login
        const inviteUrl = u.password_set ? null : await createInvitation(tx, s, u.id, b.email, b.locale);
        await audit(tx, s, 'user.invite', b.email, { role: b.role });
        return { code: 201 as const, inviteUrl, existing: u.password_set as boolean };
      });
      if (res.code === 409) return reply.code(409).send({ error: 'already_member' });
      if (res.code === 402) return reply.code(402).send({ error: 'plan_limit_users', limit: res.limit });
      if (res.code === 400) return reply.code(400).send({ error: 'invalid_role' });
      return reply.code(201).send({ inviteUrl: res.inviteUrl, existing: res.existing, emailed: env.smtpConfigured });
    });

    r.post('/settings/users/:id/resend', async (req, reply) => {
      if (!can(req.session, 'users.manage')) return forbid(reply);
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

    // "Sign in as": an admin sees the app exactly as this user (2 hours, recorded in the audit log)
    r.post('/settings/users/:id/impersonate', async (req, reply) => {
      if (!can(req.session, 'users.manage')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const s = req.session;
      if (s.impersonator) return reply.code(409).send({ error: 'already_impersonating' });
      if (id === s.userId) return reply.code(409).send({ error: 'self' });
      const res = await withTenant(s.tenantId, async (tx) => {
        const [m] = await tx`SELECT m.role, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} AND m.user_id = ${id}`;
        if (!m) return null;
        // Only owners can sign in as an owner (same rule as changing their role)
        if (!canAssign(s, m.role)) return { forbidden: true as const };
        await audit(tx, s, 'user.impersonate', m.email, { role: m.role });
        return { role: m.role as string };
      });
      if (!res) return reply.code(404).send({ error: 'not_found' });
      if ('forbidden' in res) return forbid(reply);
      await issueSession(reply, { userId: id, tenantId: s.tenantId, role: res.role, impersonator: s.userId });
      return { ok: true };
    });

    r.put('/settings/users/:id', async (req, reply) => {
      if (!can(req.session, 'users.manage')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = z.object({ role: roleKey, title: opt(120) }).parse(req.body);
      const s = req.session;
      if (!canAssign(s, b.role)) return forbid(reply);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [m] = await tx`SELECT m.role, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} AND m.user_id = ${id} FOR UPDATE OF m`;
        if (!m) return { code: 404, error: 'not_found' };
        if (!canAssign(s, m.role)) return { code: 403, error: 'forbidden' };
        if (!(await roleExists(tx, b.role))) return { code: 400, error: 'invalid_role' };
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
      if (!can(req.session, 'users.manage')) return forbid(reply);
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

    // ---------- Roles (system + custom) ----------
    const roleBody = z.object({
      name: z.string().trim().min(2).max(60),
      description: opt(200),
      permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).transform((p) => [...new Set(p)]),
      approval_level: z.coerce.number().int().min(0).max(3), // owner level (4) only for the owner role
    });

    // Any member: role names are shown across the app (users list, approvals)
    r.get('/settings/roles', async (req) => {
      const T = req.session.tenantId;
      const roles = await withTenant(T, (tx) => tx`
        SELECT r.key, r.name, r.description, r.permissions, r.approval_level, r.is_system, r.sort,
               (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = r.tenant_id AND m.role = r.key) AS members
        FROM roles r WHERE r.tenant_id = ${T} ORDER BY r.sort, r.name`);
      return { roles, permissions: PERMISSIONS, can_manage: can(req.session, 'users.manage'), my_role: req.session.role };
    });

    r.post('/settings/roles', async (req, reply) => {
      if (!can(req.session, 'users.manage')) return forbid(reply);
      const b = roleBody.parse(req.body);
      const s = req.session;
      const key = `r_${randomBytes(5).toString('hex')}`;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [dup] = await tx`SELECT 1 FROM roles WHERE lower(name) = lower(${b.name})`;
        if (dup) return null;
        const [{ next }] = await tx`SELECT coalesce(max(sort), 0) + 1 AS next FROM roles`;
        await tx`INSERT INTO roles (tenant_id, key, name, description, permissions, approval_level, sort)
                 VALUES (${s.tenantId}, ${key}, ${b.name}, ${b.description}, ${b.permissions}, ${b.approval_level}, ${next})`;
        await audit(tx, s, 'role.create', b.name, b);
        return key;
      });
      return res ? reply.code(201).send({ key: res }) : reply.code(409).send({ error: 'duplicate' });
    });

    r.put('/settings/roles/:key', async (req, reply) => {
      if (!can(req.session, 'users.manage')) return forbid(reply);
      const { key } = z.object({ key: roleKey }).parse(req.params);
      const b = roleBody.parse(req.body);
      const s = req.session;
      if (key === 'owner') return reply.code(409).send({ error: 'owner_locked' }); // owners always have everything
      // Do not let people remove their own access to this screen
      if (key === s.role && !b.permissions.includes('users.manage')) return reply.code(409).send({ error: 'would_lock_out' });
      const res = await withTenant(s.tenantId, async (tx) => {
        const [dup] = await tx`SELECT 1 FROM roles WHERE lower(name) = lower(${b.name}) AND key <> ${key}`;
        if (dup) return 409;
        const [old] = await tx`
          UPDATE roles SET name = ${b.name}, description = ${b.description}, permissions = ${b.permissions},
                 approval_level = ${b.approval_level}, updated_at = now()
          WHERE key = ${key} RETURNING key`;
        if (old) await audit(tx, s, 'role.update', b.name, b);
        return old ? 200 : 404;
      });
      if (res !== 200) return reply.code(res).send({ error: res === 409 ? 'duplicate' : 'not_found' });
      invalidateTenantRoles(s.tenantId); // new permissions apply on the next request
      return { ok: true };
    });

    // Custom roles only. Members must be moved first (or pass ?reassign_to=<role>).
    r.delete('/settings/roles/:key', async (req, reply) => {
      if (!can(req.session, 'users.manage')) return forbid(reply);
      const { key } = z.object({ key: roleKey }).parse(req.params);
      const { reassign_to } = z.object({ reassign_to: roleKey.optional() }).parse(req.query);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [role] = await tx`SELECT name, is_system FROM roles WHERE key = ${key} FOR UPDATE`;
        if (!role) return { code: 404, error: 'not_found' };
        if (role.is_system) return { code: 409, error: 'system_role' };
        const [{ members }] = await tx`SELECT count(*)::int AS members FROM memberships WHERE tenant_id = ${s.tenantId} AND role = ${key}`;
        if (members) {
          if (!reassign_to || reassign_to === key) return { code: 409, error: 'in_use' };
          if (!canAssign(s, reassign_to) || !(await roleExists(tx, reassign_to))) return { code: 400, error: 'invalid_role' };
          await tx`UPDATE memberships SET role = ${reassign_to} WHERE tenant_id = ${s.tenantId} AND role = ${key}`;
        }
        await tx`DELETE FROM roles WHERE key = ${key}`;
        await audit(tx, s, 'role.delete', role.name, { members, reassign_to: reassign_to ?? null });
        return { code: 200, error: null };
      });
      if (res.code !== 200) return reply.code(res.code).send({ error: res.error });
      invalidateTenantRoles(s.tenantId);
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
      if (!can(req.session, 'settings.manage')) return forbid(reply);
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
      if (!can(req.session, 'settings.manage')) return forbid(reply);
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
    const listParam = z.enum(ALL_LISTS);

    r.get('/settings/lookups', async (req) => {
      const { list } = z.object({ list: listParam }).parse(req.query);
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => {
        if (isNameList(list)) {
          // Name lists: one grouped count per storing column instead of a count per value
          const usage = await nameListUsage(tx, T, list);
          const rows = await tx`SELECT id, name, sort, active FROM lookup_values WHERE tenant_id = ${T} AND list = ${list} ORDER BY sort, name`;
          return rows.map((r) => ({ ...r, usage: usage.get(r.name) ?? 0 }));
        }
        return tx`
          SELECT l.id, l.name, l.sort, l.active,
                 (SELECT count(*) FROM branches b WHERE b.geo_zone_id = l.id OR b.fee_schedule_id = l.id OR b.tour_id = l.id OR b.ongoing_status_id = l.id)::int
               + (SELECT count(*) FROM customers c WHERE c.geo_zone_id = l.id)::int AS usage
          FROM lookup_values l WHERE l.tenant_id = ${T} AND l.list = ${list} ORDER BY l.sort, l.name`;
      });
    });

    r.put('/settings/lookups/:id', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = z.object({ name: z.string().trim().min(1).max(80), active: z.boolean(), sort: z.coerce.number().int().min(0).max(10000) }).parse(req.body);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [dup] = await tx`
          SELECT 1 FROM lookup_values WHERE tenant_id = ${s.tenantId} AND id <> ${id}
            AND list = (SELECT list FROM lookup_values WHERE id = ${id}) AND search_key(name) = search_key(${b.name})`;
        if (dup) return 409;
        const [old] = await tx`SELECT list, name FROM lookup_values WHERE id = ${id}`;
        if (old && isNameList(old.list)) await renameInRecords(tx, s.tenantId, old.list, old.name, b.name); // records follow the rename
        const [l] = await tx`UPDATE lookup_values SET ${tx(b)} WHERE id = ${id} RETURNING list`;
        if (l) await audit(tx, s, 'lookup.update', `${l.list}: ${b.name}`, b);
        return l ? 200 : 404;
      });
      return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 409 ? 'duplicate' : 'not_found' });
    });

    r.put('/settings/lookups/order', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
      await withTenant(req.session.tenantId, async (tx) => {
        await tx`UPDATE lookup_values l SET sort = x.ord FROM unnest(${tx.array(ids)}::uuid[]) WITH ORDINALITY AS x(id, ord) WHERE l.id = x.id`;
      });
      return { ok: true };
    });

    r.delete('/settings/lookups/:id', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [lv] = await tx`SELECT list, name FROM lookup_values WHERE id = ${id}`;
        const used = lv && isNameList(lv.list) ? await nameInUse(tx, s.tenantId, lv.list, lv.name) : (await tx`
          SELECT 1 WHERE EXISTS (SELECT 1 FROM branches WHERE geo_zone_id = ${id} OR fee_schedule_id = ${id} OR tour_id = ${id} OR ongoing_status_id = ${id})
                      OR EXISTS (SELECT 1 FROM customers WHERE geo_zone_id = ${id})`).length > 0;
        if (used) return 409; // in use: deactivate instead, history stays intact
        const [l] = await tx`DELETE FROM lookup_values WHERE id = ${id} RETURNING list, name`;
        if (l) await audit(tx, s, 'lookup.delete', `${l.list}: ${l.name}`);
        return l ? 200 : 404;
      });
      return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 409 ? 'in_use' : 'not_found' });
    });

    // ---------- Customers display: organisation default + my override ----------
    r.get('/settings/customers', async (req) => {
      const { tenantId, userId } = req.session;
      return withTenant(tenantId, async (tx) => {
        const [t] = await tx`SELECT show_customer_avatar, customer_tabs FROM tenants WHERE id = ${tenantId}`;
        const [m] = await tx`SELECT prefs FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
        const mine = (m?.prefs?.show_customer_avatar ?? null) as boolean | null;
        return {
          organization: { show_avatar: t.show_customer_avatar as boolean },
          mine: { show_avatar: mine },
          effective: { show_avatar: mine ?? (t.show_customer_avatar as boolean) },
          tabs: {
            available: CUSTOMER_TABS,
            organization: t.customer_tabs ? normalizeTabs(t.customer_tabs as TabCfg) : null,
            mine: m?.prefs?.customer_tabs ? normalizeTabs(m.prefs.customer_tabs as TabCfg) : null,
            effective: normalizeTabs((m?.prefs?.customer_tabs ?? t.customer_tabs ?? []) as TabCfg),
            source: m?.prefs?.customer_tabs ? 'user' : t.customer_tabs ? 'organization' : 'default',
          },
          can_edit_organization: can(req.session, 'settings.manage'),
        };
      });
    });

    r.put('/settings/customers/organization', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const b = z.object({ show_avatar: z.boolean().optional(), tabs: tabsSchema.nullable().optional() }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        if (b.show_avatar !== undefined) await tx`UPDATE tenants SET show_customer_avatar = ${b.show_avatar}, updated_at = now() WHERE id = ${s.tenantId}`;
        if (b.tabs !== undefined) await tx`UPDATE tenants SET customer_tabs = ${b.tabs ? tx.json(normalizeTabs(b.tabs) as never) : null}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'customers_display.update', null, b);
      });
      return { ok: true };
    });

    // Any user: null = follow the organisation default
    // ---------- Grid layouts (e.g. customer "Ενέργειες"): organisation default + my own ----------
    const gridKey = z.object({ grid: z.enum(GRIDS) });
    const layoutSchema = z.object({
      cols: z.array(z.object({ key: z.string().max(40), width: z.coerce.number().int().min(40).max(1200), hidden: z.boolean() })).max(60),
      dense: z.boolean().default(false),
      group: z.string().max(40).default(''),
    });
    r.get('/me/grids/:grid', async (req) => {
      const { grid } = gridKey.parse(req.params);
      const { tenantId, userId } = req.session;
      return withTenant(tenantId, async (tx) => {
        const [t] = await tx`SELECT grid_layouts->${grid} AS layout FROM tenants WHERE id = ${tenantId}`;
        const [m] = await tx`SELECT prefs->'grid_layouts'->${grid} AS layout FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
        const organization = (t?.layout ?? null) as unknown, mine = (m?.layout ?? null) as unknown;
        return { organization, mine, effective: mine ?? organization, source: mine ? 'user' : organization ? 'organization' : 'default',
          can_edit_organization: can(req.session, 'settings.manage') };
      });
    });
    // Mine: null = follow the organisation
    r.put('/me/grids/:grid', async (req) => {
      const { grid } = gridKey.parse(req.params);
      const layout = layoutSchema.nullable().parse((req.body as { layout?: unknown })?.layout ?? null);
      const { tenantId, userId } = req.session;
      await withTenant(tenantId, (tx) => tx`
        UPDATE memberships SET prefs = jsonb_set(prefs, '{grid_layouts}', coalesce(prefs->'grid_layouts', '{}'::jsonb) ${layout ? tx`|| ${tx.json({ [grid]: layout } as never)}` : tx`- ${grid}::text`})
        WHERE tenant_id = ${tenantId} AND user_id = ${userId}`);
      return { ok: true };
    });
    // Organisation default (administrators): null = back to the built-in layout
    r.put('/settings/grids/:grid', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const { grid } = gridKey.parse(req.params);
      const layout = layoutSchema.nullable().parse((req.body as { layout?: unknown })?.layout ?? null);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET grid_layouts = ${layout ? tx`grid_layouts || ${tx.json({ [grid]: layout } as never)}` : tx`grid_layouts - ${grid}::text`}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'grid.organization_layout', null, { grid, reset: !layout });
      });
      return { ok: true };
    });

    r.put('/me/preferences', async (req) => {
      const b = z.object({
        show_customer_avatar: z.boolean().nullable().optional(),
        customers_view: z.enum(CUSTOMER_VIEWS).nullable().optional(),
        customers_filters: z.array(z.enum(FILTER_KEYS as [string, ...string[]])).max(40).nullable().optional(),
        tree_filters: z.array(z.enum(FILTER_KEYS as [string, ...string[]])).max(40).nullable().optional(),
        stores_filters: z.array(z.enum(FILTER_KEYS as [string, ...string[]])).max(40).nullable().optional(),
        customer_tabs: tabsSchema.nullable().optional(),
      }).parse(req.body);
      if (b.customer_tabs) b.customer_tabs = normalizeTabs(b.customer_tabs) as typeof b.customer_tabs;
      const { tenantId, userId } = req.session;
      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      for (const k of ['show_customer_avatar', 'customers_view', 'customers_filters', 'tree_filters', 'stores_filters', 'customer_tabs'] as const) {
        if (b[k] === null) unset.push(k);
        else if (b[k] !== undefined) set[k] = b[k];
      }
      await withTenant(tenantId, (tx) => tx`
        UPDATE memberships SET prefs = (prefs - ${unset}::text[]) || ${tx.json(set as never)}
        WHERE tenant_id = ${tenantId} AND user_id = ${userId}`);
      return { ok: true };
    });

    // ---------- Index pages: default views (organisation → role → user) ----------
    r.get('/settings/indexes', async (req) => {
      const { tenantId, userId, role } = req.session;
      return withTenant(tenantId, async (tx) => {
        const [t] = await tx`SELECT index_defaults FROM tenants WHERE id = ${tenantId}`;
        const [m] = await tx`SELECT prefs FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
        const cv = (t.index_defaults?.customers_view ?? {}) as { org?: string; roles?: Record<string, string> };
        const org = cv.org ?? 'list';
        const roles = cv.roles ?? {};
        const mine = (m?.prefs?.customers_view ?? null) as string | null;
        return {
          customers_view: {
            organization: org, roles, mine, my_role: role,
            effective: mine ?? roles[role] ?? org,
            source: mine ? 'user' : roles[role] ? 'role' : 'organization',
          },
          // Visible filters per index: organisation / per role / mine (null = follow) + what applies to me
          filters: Object.fromEntries(INDEXES.map((ix) => {
            const cfg = (t.index_defaults?.[`${ix}_filters`] ?? {}) as { org?: string[]; roles?: Record<string, string[]> };
            return [ix, {
              available: INDEX_FILTERS[ix], defaults: DEFAULT_VISIBLE[ix],
              organization: cfg.org ?? null, roles: cfg.roles ?? {}, mine: (m?.prefs?.[`${ix}_filters`] ?? null) as string[] | null,
              effective: effectiveFilters(ix, t.index_defaults, m?.prefs ?? null, role),
            }];
          })),
          can_edit_organization: can(req.session, 'settings.manage'),
        };
      });
    });

    r.put('/settings/indexes/organization', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const roleKeyRe = /^[a-z][a-z0-9_]{1,39}$/;
      const filterList = z.array(z.enum(FILTER_KEYS as [string, ...string[]])).max(40);
      // Each sent key replaces that whole setting (org default + per-role overrides); org: null = built-in default
      const filtersCfg = z.object({ org: filterList.nullable(), roles: z.record(z.string().regex(roleKeyRe), filterList).default({}) })
        .transform((c) => (c.org === null ? { roles: c.roles } : c));
      const b = z.object({
        customers_view: z.object({
          org: z.enum(CUSTOMER_VIEWS),
          roles: z.record(z.string().regex(roleKeyRe), z.enum(CUSTOMER_VIEWS)).default({}),
        }).optional(),
        customers_filters: filtersCfg.optional(),
        tree_filters: filtersCfg.optional(),
        stores_filters: filtersCfg.optional(),
      }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET index_defaults = index_defaults || ${tx.json(b as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'indexes.update', null, b);
      });
      return { ok: true };
    });

    // ---------- Audit log: filters, numbered pages, facets, CSV export ----------
    const auditQuery = z.object({
      q: z.string().trim().max(100).optional(),
      actor: z.union([z.literal('api'), z.string().uuid()]).optional(),   // 'api' = changes made through API keys
      category: z.string().trim().regex(/^[a-z_]{2,30}$/).optional(),      // first part of the action, e.g. user, apikey, api
      action: z.string().trim().regex(/^[a-z_.]{2,60}$/).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      page_size: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)).default(25),
    });
    type AuditQ = z.infer<typeof auditQuery>;
    const auditWhere = (tx: Tx, T: string, q: AuditQ) => tx`
      a.tenant_id = ${T}
      ${q.actor === 'api' ? tx`AND a.actor_id IS NULL` : q.actor ? tx`AND a.actor_id = ${q.actor}` : tx``}
      ${q.category ? tx`AND split_part(a.action, '.', 1) = ${q.category}` : tx``}
      ${q.action ? tx`AND a.action = ${q.action}` : tx``}
      ${q.from ? tx`AND a.created_at >= ${q.from}` : tx``}
      ${q.to ? tx`AND a.created_at < ${new Date(q.to.getTime() + 86_400_000)}` : tx``}
      ${q.q ? tx`AND (a.entity ILIKE ${'%' + q.q.replace(/[%_\\]/g, '\\$&') + '%'} OR a.action ILIKE ${'%' + q.q.replace(/[%_\\]/g, '\\$&') + '%'}
                    OR a.details::text ILIKE ${'%' + q.q.replace(/[%_\\]/g, '\\$&') + '%'})` : tx``}`;

    r.get('/settings/audit', async (req, reply) => {
      if (!can(req.session, 'audit.view')) return forbid(reply);
      const q = auditQuery.parse(req.query);
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => {
        const [{ total }] = await tx`SELECT count(*)::int AS total FROM audit_log a WHERE ${auditWhere(tx, T, q)}`;
        const items = await tx`
          SELECT a.id, a.action, a.entity, a.details, a.created_at, a.actor_id, u.full_name AS actor_name, u.email AS actor_email
          FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE ${auditWhere(tx, T, q)}
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ${q.page_size} OFFSET ${(q.page - 1) * q.page_size}`;
        return { items, total, page: q.page, page_size: q.page_size, pages: Math.max(1, Math.ceil(total / q.page_size)) };
      });
    });

    // Values for the filter menus (with counts)
    r.get('/settings/audit/facets', async (req, reply) => {
      if (!can(req.session, 'audit.view')) return forbid(reply);
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => ({
        actors: await tx`
          SELECT a.actor_id AS id, coalesce(u.full_name, 'API') AS name, count(*)::int AS n
          FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.tenant_id = ${T} GROUP BY 1, 2 ORDER BY n DESC LIMIT 100`,
        categories: await tx`
          SELECT split_part(action, '.', 1) AS key, count(*)::int AS n FROM audit_log
          WHERE tenant_id = ${T} GROUP BY 1 ORDER BY n DESC`,
        actions: await tx`
          SELECT action AS key, count(*)::int AS n FROM audit_log WHERE tenant_id = ${T} GROUP BY 1 ORDER BY 1`,
      }));
    });

    // CSV of the filtered rows (max 10.000), for Excel
    r.get('/settings/audit/export.csv', async (req, reply) => {
      if (!can(req.session, 'audit.view')) return forbid(reply);
      const q = auditQuery.parse(req.query);
      const T = req.session.tenantId;
      const rows = await withTenant(T, (tx) => tx`
        SELECT a.created_at, coalesce(u.full_name, 'API') AS actor, u.email, a.action, a.entity, a.details
        FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE ${auditWhere(tx, T, q)} ORDER BY a.created_at DESC, a.id DESC LIMIT 10000`);
      const cell = (v: unknown) => { const x = v == null ? '' : typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v); return /[";\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
      const csv = ['date;actor;email;action;entity;details', ...rows.map((r) => [r.created_at, r.actor, r.email, r.action, r.entity, r.details].map(cell).join(';'))].join('\r\n');
      await withTenant(T, (tx) => audit(tx, req.session, 'audit.export', null, { rows: rows.length }));
      reply.header('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.type('text/csv; charset=utf-8').send('\uFEFF' + csv); // BOM: Greek opens correctly in Excel
    });
  });
}
