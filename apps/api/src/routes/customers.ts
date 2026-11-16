// Customers module: list (filters + 3 keyset sort orders), full profile, create/update/archive,
// branches & spaces, contacts, activity log, VAT validation and duplicate check.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decodeCursor, encodeCursor, searchKey, withTenant, type Tx } from '../db.js';
import { hasRole, requireAuth, type Session } from '../auth.js';
import { publish } from '../realtime.js';

const STATUSES = ['active', 'prospect', 'negotiation', 'inactive'] as const;
const SPACE_KINDS = ['retail', 'warehouse', 'office', 'department'] as const;
const ACTIVITY_KINDS = ['call', 'email_sent', 'meeting_done', 'note'] as const;

/** Greek ΑΦΜ checksum (9 digits). */
export function isValidAfm(v: string) {
  if (!/^\d{9}$/.test(v) || v === '000000000') return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(v[i]) * 2 ** (8 - i);
  return (sum % 11) % 10 === Number(v[8]);
}

const opt = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const addressSchema = z.object({
  street: opt(200), city: opt(100), postal: opt(20), region: opt(100), country: opt(2),
}).nullish();

const customerSchema = z.object({
  kind: z.enum(['group', 'company']),
  name: z.string().trim().min(2).max(200),
  trade_name: opt(200),
  vat: opt(20),
  tax_office: opt(100),
  gemi: opt(30),
  activity: opt(200),
  status: z.enum(STATUSES).default('prospect'),
  category: opt(60),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  source: opt(60),
  parent_id: z.string().uuid().nullish().transform((v) => v ?? null),
  account_manager_id: z.string().uuid().nullish().transform((v) => v ?? null),
  email: z.string().trim().email().max(200).nullish().or(z.literal('')).transform((v) => (v ? v : null)),
  phone: opt(40),
  mobile: opt(40),
  website: opt(200),
  address_street: opt(200),
  address_city: opt(100),
  address_postal: opt(20),
  address_region: opt(100),
  address_country: z.string().trim().length(2).default('GR'),
  billing_address: addressSchema.transform((v) => (v && Object.values(v).some(Boolean) ? v : null)),
  payment_terms: opt(40),
  credit_limit: z.coerce.number().min(0).max(1e12).nullish().transform((v) => v ?? null),
  discount: z.coerce.number().min(0).max(100).default(0),
  annual_value: z.coerce.number().min(0).max(1e13).default(0),
  notes: opt(10000),
}).superRefine((c, ctx) => {
  if (c.vat && c.address_country === 'GR' && !isValidAfm(c.vat)) {
    ctx.addIssue({ code: 'custom', path: ['vat'], message: 'invalid_afm' });
  }
});
type CustomerInput = z.infer<typeof customerSchema>;

const idParam = z.object({ id: z.string().uuid() });

async function log(tx: Tx, s: Session, customerId: string, kind: string, title: string, body?: string | null) {
  await tx`INSERT INTO activities (tenant_id, customer_id, actor_id, kind, title, body)
           VALUES (${s.tenantId}, ${customerId}, ${s.userId}, ${kind}, ${title}, ${body ?? null})`;
}

/** Keep the denormalised counters on customers/branches exact after branch/space/subsidiary changes. */
async function refreshCounts(tx: Tx, customerId: string) {
  await tx`
    UPDATE branches b SET spaces_count = (SELECT count(*) FROM spaces s WHERE s.branch_id = b.id)
    WHERE b.customer_id = ${customerId}`;
  await tx`
    UPDATE customers c SET
      branches_count  = (SELECT count(*) FROM branches b WHERE b.customer_id = c.id),
      spaces_count    = (SELECT coalesce(sum(spaces_count), 0) FROM branches b WHERE b.customer_id = c.id),
      companies_count = (SELECT count(*) FROM customers ch WHERE ch.parent_id = c.id AND ch.archived_at IS NULL)
    WHERE c.id = ${customerId}`;
}

/** Parent must exist, be a group, and not create a cycle. */
async function validParent(tx: Tx, id: string | null, parentId: string | null) {
  if (!parentId) return true;
  if (parentId === id) return false;
  const [p] = await tx`SELECT kind FROM customers WHERE id = ${parentId}`;
  if (!p || p.kind !== 'group') return false;
  if (!id) return true;
  const [cycle] = await tx`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, 1 AS depth FROM customers WHERE id = ${parentId}
      UNION ALL SELECT c.id, c.parent_id, up.depth + 1 FROM customers c JOIN up ON c.id = up.parent_id WHERE up.depth < 10)
    SELECT 1 FROM up WHERE id = ${id} LIMIT 1`;
  return !cycle;
}

function columns(c: CustomerInput) {
  const { billing_address, tags, ...rest } = c;
  return { ...rest, tags, billing_address };
}

export default async function customerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---- Team members (account manager picker) ----
  app.get('/users', async (req) => {
    const T = req.session.tenantId;
    return withTenant(T, (tx) => tx`
      SELECT u.id, u.full_name, u.email, m.role, m.title
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${T} ORDER BY u.full_name`);
  });

  // ---- List ----
  app.get('/customers', async (req) => {
    const q = z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(STATUSES).optional(),
      kind: z.enum(['group', 'company']).optional(),
      manager: z.union([z.literal('me'), z.string().uuid()]).optional(),
      tag: z.string().trim().max(40).optional(),
      archived: z.enum(['0', '1']).default('0'),
      sort: z.enum(['name', 'recent', 'value']).default('name'),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(req.query);
    const s = req.session;
    const T = s.tenantId;
    const cur = decodeCursor<[string, string]>(q.cursor);
    const key = q.q && q.q.length >= 2 ? `%${searchKey(q.q)}%` : null;
    const manager = q.manager === 'me' ? s.userId : q.manager;

    return withTenant(T, async (tx) => {
      const order = q.sort === 'recent' ? tx`created_at DESC, id DESC`
        : q.sort === 'value' ? tx`annual_value DESC, id DESC` : tx`name, id`;
      const after = !cur ? tx``
        : q.sort === 'recent' ? tx`AND (created_at, id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)`
        : q.sort === 'value' ? tx`AND (annual_value, id) < (${cur[0]}::numeric, ${cur[1]}::uuid)`
        : tx`AND (name, id) > (${cur[0]}, ${cur[1]}::uuid)`;
      const rows = await tx`
        SELECT id, code, kind, name, trade_name, status, category, tags, image_url, annual_value, address_city,
               companies_count, branches_count, spaces_count, created_at, archived_at
        FROM customers
        WHERE tenant_id = ${T}
          ${q.archived === '1' ? tx`AND archived_at IS NOT NULL` : tx`AND archived_at IS NULL`}
          ${q.status ? tx`AND status = ${q.status}` : tx``}
          ${q.kind ? tx`AND kind = ${q.kind}` : tx``}
          ${manager ? tx`AND account_manager_id = ${manager}` : tx``}
          ${q.tag ? tx`AND tags @> ARRAY[${q.tag}]::text[]` : tx``}
          ${key ? tx`AND search LIKE ${key}` : tx``}
          ${after}
        ORDER BY ${order}
        LIMIT ${q.limit + 1}`;
      const more = rows.length > q.limit;
      const items = more ? rows.slice(0, q.limit) : rows;
      const last = items.at(-1);
      const cursorOf = (r: typeof last) => q.sort === 'recent' ? [r!.created_at, r!.id] : q.sort === 'value' ? [r!.annual_value, r!.id] : [r!.name, r!.id];
      return { items, nextCursor: more && last ? encodeCursor(cursorOf(last)) : null };
    });
  });

  // Groups for the "parent group" picker
  app.get('/customers/groups', async (req) => {
    const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    const T = req.session.tenantId;
    const key = q && q.length >= 2 ? `%${searchKey(q)}%` : null;
    return withTenant(T, (tx) => tx`
      SELECT id, name, code FROM customers
      WHERE tenant_id = ${T} AND kind = 'group' AND archived_at IS NULL ${key ? tx`AND search LIKE ${key}` : tx``}
      ORDER BY name LIMIT 20`);
  });

  // ΑΦΜ validation + duplicates within the tenant
  app.get('/customers/check-vat', async (req) => {
    const q = z.object({ vat: z.string().trim().min(1).max(20), country: z.string().length(2).default('GR'), exclude: z.string().uuid().optional() }).parse(req.query);
    const T = req.session.tenantId;
    const valid = q.country !== 'GR' || isValidAfm(q.vat);
    const duplicates = await withTenant(T, (tx) => tx`
      SELECT id, name, code FROM customers
      WHERE tenant_id = ${T} AND vat = ${q.vat} ${q.exclude ? tx`AND id <> ${q.exclude}` : tx``} LIMIT 5`);
    return { valid, duplicates };
  });

  // ---- Full profile ----
  app.get('/customers/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const T = req.session.tenantId;
    return withTenant(T, async (tx) => {
      const [customer] = await tx`
        SELECT c.*, u.full_name AS account_manager_name, p.name AS parent_name
        FROM customers c
        LEFT JOIN users u ON u.id = c.account_manager_id
        LEFT JOIN customers p ON p.id = c.parent_id
        WHERE c.id = ${id}`;
      if (!customer) return reply.code(404).send({ error: 'not_found' });
      const { search: _s, ...profile } = customer;
      const [stats] = await tx`
        SELECT count(*) FILTER (WHERE status IN ('draft','in_progress','pending_approval','approved','sent'))::int AS open_offers,
               count(*) FILTER (WHERE status = 'accepted')::int AS won_offers,
               count(*) FILTER (WHERE status = 'rejected')::int AS lost_offers,
               coalesce(sum(total_amount) FILTER (WHERE status IN ('draft','in_progress','pending_approval','approved','sent')), 0) AS open_amount,
               coalesce(sum(total_amount) FILTER (WHERE status = 'accepted'), 0) AS won_amount,
               max(created_at) AS last_offer_at
        FROM offers WHERE tenant_id = ${T} AND customer_id = ${id}`;
      const decided = stats.won_offers + stats.lost_offers;
      const branches = await tx`
        SELECT b.id, b.name, b.city, b.address, b.postal_code, b.phone, b.manager_name, b.status, b.spaces_count,
               coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'area_sqm', s.area_sqm, 'notes', s.notes)
                        ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL), '[]') AS spaces
        FROM branches b LEFT JOIN spaces s ON s.branch_id = b.id
        WHERE b.tenant_id = ${T} AND b.customer_id = ${id}
        GROUP BY b.id ORDER BY b.name LIMIT 200`;
      const contacts = await tx`
        SELECT id, full_name, role_title, email, phone, mobile, is_primary, notes
        FROM contacts WHERE tenant_id = ${T} AND customer_id = ${id}
        ORDER BY is_primary DESC, full_name LIMIT 200`;
      const subsidiaries = await tx`
        SELECT id, name, code, status, annual_value, branches_count FROM customers
        WHERE tenant_id = ${T} AND parent_id = ${id} AND archived_at IS NULL ORDER BY name LIMIT 100`;
      const [last] = await tx`SELECT max(occurred_at) AS at FROM activities WHERE tenant_id = ${T} AND customer_id = ${id}`;
      return {
        customer: profile,
        stats: { ...stats, win_rate: decided ? Math.round((stats.won_offers / decided) * 100) : null, last_activity_at: last?.at ?? null },
        branches, contacts, subsidiaries,
        can: { edit: hasRole(req.session, 'sales'), archive: hasRole(req.session, 'manager') },
      };
    });
  });

  // ---- Create ----
  app.post('/customers', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const c = customerSchema.parse(req.body);
    const s = req.session;
    const res = await withTenant(s.tenantId, async (tx) => {
      if (!(await validParent(tx, null, c.parent_id))) return { error: 'invalid_parent' as const };
      // Sequential, human-friendly code per tenant (retries if an older code is already taken)
      for (let attempt = 0; attempt < 20; attempt++) {
        const [{ value }] = await tx`
          INSERT INTO tenant_counters (tenant_id, key, value) VALUES (${s.tenantId}, 'customer_seq', 1)
          ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 1 RETURNING value`;
        const code = `CUST-${String(value).padStart(6, '0')}`;
        const [exists] = await tx`SELECT 1 FROM customers WHERE tenant_id = ${s.tenantId} AND code = ${code}`;
        if (exists) continue;
        const [row] = await tx`
          INSERT INTO customers ${tx({ ...columns(c), tenant_id: s.tenantId, code, account_manager_id: c.account_manager_id ?? s.userId })}
          RETURNING id, name, code, parent_id`;
        await log(tx, s, row.id, 'note', 'Δημιουργία πελάτη', row.code);
        if (row.parent_id) await refreshCounts(tx, row.parent_id);
        return { customer: row };
      }
      return { error: 'code_exhausted' as const };
    });
    if ('error' in res) return reply.code(400).send({ error: res.error });
    await publish({ tenantId: s.tenantId, type: 'customer.created', data: { id: res.customer.id } });
    return reply.code(201).send(res.customer);
  });

  // ---- Update ----
  app.put('/customers/:id', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const c = customerSchema.parse(req.body);
    const s = req.session;
    const res = await withTenant(s.tenantId, async (tx) => {
      const [old] = await tx`SELECT parent_id, status, name FROM customers WHERE id = ${id} FOR UPDATE`;
      if (!old) return 404;
      if (!(await validParent(tx, id, c.parent_id))) return 400;
      await tx`UPDATE customers SET ${tx(columns(c))}, updated_at = now() WHERE id = ${id}`;
      const changes = [old.status !== c.status && `Κατάσταση: ${old.status} → ${c.status}`, old.name !== c.name && `Επωνυμία: ${c.name}`].filter(Boolean).join(' · ');
      await log(tx, s, id, 'note', 'Ενημέρωση στοιχείων', changes || null);
      for (const p of new Set([old.parent_id, c.parent_id].filter(Boolean))) await refreshCounts(tx, p as string);
      return 200;
    });
    if (res !== 200) return reply.code(res).send({ error: res === 404 ? 'not_found' : 'invalid_parent' });
    await publish({ tenantId: s.tenantId, type: 'customer.updated', data: { id } });
    return { ok: true };
  });

  // ---- Archive / restore (soft; history and offers are kept) ----
  app.post('/customers/:id/archive', async (req, reply) => {
    if (!hasRole(req.session, 'manager')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
    const s = req.session;
    await withTenant(s.tenantId, async (tx) => {
      const [c] = await tx`UPDATE customers SET archived_at = ${archived ? tx`now()` : null}, updated_at = now() WHERE id = ${id} RETURNING parent_id`;
      if (!c) return;
      await log(tx, s, id, 'note', archived ? 'Αρχειοθέτηση πελάτη' : 'Επαναφορά πελάτη');
      if (c.parent_id) await refreshCounts(tx, c.parent_id);
    });
    await publish({ tenantId: s.tenantId, type: 'customer.updated', data: { id } });
    return { ok: true };
  });

  // ---- Activity log ----
  app.get('/customers/:id/activities', async (req) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const cur = decodeCursor<[string, string]>(q.cursor);
    const T = req.session.tenantId;
    return withTenant(T, async (tx) => {
      const rows = await tx`
        SELECT a.id, a.kind, a.title, a.body, a.occurred_at, u.full_name AS actor_name
        FROM activities a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.tenant_id = ${T} AND a.customer_id = ${id}
          ${cur ? tx`AND (a.occurred_at, a.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
        ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${q.limit + 1}`;
      const more = rows.length > q.limit;
      const items = more ? rows.slice(0, q.limit) : rows;
      const last = items.at(-1);
      return { items, nextCursor: more && last ? encodeCursor([last.occurred_at, last.id]) : null };
    });
  });

  app.post('/customers/:id/activities', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const b = z.object({ kind: z.enum(ACTIVITY_KINDS), title: z.string().trim().min(1).max(200), body: opt(5000) }).parse(req.body);
    const s = req.session;
    await withTenant(s.tenantId, (tx) => log(tx, s, id, b.kind, b.title, b.body));
    return reply.code(201).send({ ok: true });
  });

  // Branches with their spaces (pickers, e.g. new offer)
  app.get('/customers/:id/branches', async (req) => {
    const { id } = idParam.parse(req.params);
    const T = req.session.tenantId;
    return withTenant(T, (tx) => tx`
      SELECT b.id, b.name, b.city,
             coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'kind', s.kind) ORDER BY s.name)
                      FILTER (WHERE s.id IS NOT NULL), '[]') AS spaces
      FROM branches b LEFT JOIN spaces s ON s.branch_id = b.id
      WHERE b.tenant_id = ${T} AND b.customer_id = ${id}
      GROUP BY b.id ORDER BY b.name LIMIT 200`);
  });

  // ---- Branches ----
  const branchSchema = z.object({
    name: z.string().trim().min(1).max(200), city: opt(100), address: opt(200), postal_code: opt(20),
    phone: opt(40), manager_name: opt(120), status: z.enum(['active', 'inactive']).default('active'),
  });

  app.post('/customers/:id/branches', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const b = branchSchema.parse(req.body);
    const s = req.session;
    const row = await withTenant(s.tenantId, async (tx) => {
      const [r] = await tx`INSERT INTO branches ${tx({ ...b, tenant_id: s.tenantId, customer_id: id })} RETURNING id`;
      await log(tx, s, id, 'note', 'Νέο κατάστημα', b.name);
      await refreshCounts(tx, id);
      return r;
    });
    return reply.code(201).send(row);
  });

  app.put('/branches/:id', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const b = branchSchema.parse(req.body);
    const ok = await withTenant(req.session.tenantId, async (tx) => {
      const [r] = await tx`UPDATE branches SET ${tx(b)} WHERE id = ${id} RETURNING id`;
      return !!r;
    });
    return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/branches/:id', async (req, reply) => {
    if (!hasRole(req.session, 'manager')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const s = req.session;
    const ok = await withTenant(s.tenantId, async (tx) => {
      const [r] = await tx`DELETE FROM branches WHERE id = ${id} RETURNING customer_id, name`;
      if (!r) return false;
      await log(tx, s, r.customer_id, 'note', 'Διαγραφή καταστήματος', r.name);
      await refreshCounts(tx, r.customer_id);
      return true;
    });
    return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
  });

  // ---- Spaces ----
  const spaceSchema = z.object({
    name: z.string().trim().min(1).max(200), kind: z.enum(SPACE_KINDS).default('retail'),
    area_sqm: z.coerce.number().min(0).max(1e7).nullish().transform((v) => v ?? null), notes: opt(2000),
  });

  app.post('/branches/:id/spaces', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const b = spaceSchema.parse(req.body);
    const s = req.session;
    const row = await withTenant(s.tenantId, async (tx) => {
      const [br] = await tx`SELECT customer_id FROM branches WHERE id = ${id}`;
      if (!br) return null;
      const [r] = await tx`INSERT INTO spaces ${tx({ ...b, tenant_id: s.tenantId, branch_id: id })} RETURNING id`;
      await refreshCounts(tx, br.customer_id);
      return r;
    });
    return row ? reply.code(201).send(row) : reply.code(404).send({ error: 'not_found' });
  });

  app.put('/spaces/:id', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const b = spaceSchema.parse(req.body);
    const ok = await withTenant(req.session.tenantId, async (tx) => !!(await tx`UPDATE spaces SET ${tx(b)} WHERE id = ${id} RETURNING id`)[0]);
    return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/spaces/:id', async (req, reply) => {
    if (!hasRole(req.session, 'manager')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const ok = await withTenant(req.session.tenantId, async (tx) => {
      const [r] = await tx`DELETE FROM spaces s USING branches b WHERE s.id = ${id} AND b.id = s.branch_id RETURNING b.customer_id`;
      if (!r) return false;
      await refreshCounts(tx, r.customer_id);
      return true;
    });
    return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
  });

  // ---- Contacts ----
  const contactSchema = z.object({
    full_name: z.string().trim().min(2).max(120), role_title: opt(120),
    email: z.string().trim().email().max(200).nullish().or(z.literal('')).transform((v) => (v ? v : null)),
    phone: opt(40), mobile: opt(40), is_primary: z.boolean().default(false), notes: opt(2000),
  });

  app.post('/customers/:id/contacts', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const b = contactSchema.parse(req.body);
    const s = req.session;
    const row = await withTenant(s.tenantId, async (tx) => {
      if (b.is_primary) await tx`UPDATE contacts SET is_primary = false WHERE customer_id = ${id} AND is_primary`;
      const [r] = await tx`INSERT INTO contacts ${tx({ ...b, tenant_id: s.tenantId, customer_id: id })} RETURNING id`;
      await log(tx, s, id, 'note', 'Νέα επαφή', b.full_name);
      return r;
    });
    return reply.code(201).send(row);
  });

  app.put('/contacts/:id', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const b = contactSchema.parse(req.body);
    const ok = await withTenant(req.session.tenantId, async (tx) => {
      const [c] = await tx`SELECT customer_id FROM contacts WHERE id = ${id}`;
      if (!c) return false;
      if (b.is_primary) await tx`UPDATE contacts SET is_primary = false WHERE customer_id = ${c.customer_id} AND is_primary AND id <> ${id}`;
      await tx`UPDATE contacts SET ${tx(b)} WHERE id = ${id}`;
      return true;
    });
    return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/contacts/:id', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = idParam.parse(req.params);
    const ok = await withTenant(req.session.tenantId, async (tx) => !!(await tx`DELETE FROM contacts WHERE id = ${id} RETURNING id`)[0]);
    return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
  });
}
