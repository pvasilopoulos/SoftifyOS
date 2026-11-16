import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decodeCursor, encodeCursor, searchKey, withTenant } from '../db.js';
import { hasRole, requireAuth } from '../auth.js';
import { publish } from '../realtime.js';

const limitSchema = z.coerce.number().int().min(1).max(100).default(30);

function page<T extends Record<string, unknown>>(rows: T[], limit: number, cursorOf: (r: T) => unknown[]) {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: more && last ? encodeCursor(cursorOf(last)) : null };
}

export default async function dataRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---- Dashboard: reads only pre-aggregated counters + small indexed slices ----
  app.get('/dashboard', async (req) => {
    const { tenantId, userId } = req.session;
    return withTenant(tenantId, async (tx) => {
      const stats = await tx`SELECT status, count, amount FROM tenant_offer_stats`;
      const counters = await tx`SELECT key, value FROM tenant_counters`;
      const upcoming = await tx`
        SELECT e.id, e.title, e.kind, e.location, e.starts_at, e.ends_at, c.name AS customer_name
        FROM events e LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.tenant_id = ${tenantId} AND e.owner_id = ${userId} AND e.starts_at >= now() - interval '2 hours'
        ORDER BY e.starts_at LIMIT 5`;
      const recent = await tx`
        SELECT a.id, a.kind, a.title, a.body, a.occurred_at, u.full_name AS actor_name
        FROM activities a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.tenant_id = ${tenantId} AND a.occurred_at > now() - interval '30 days'
        ORDER BY a.occurred_at DESC LIMIT 8`;
      return { stats, counters, upcoming, recent };
    });
  });

  // ---- Customers: keyset pagination + trigram search ----
  app.get('/customers', async (req) => {
    const q = z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(['active', 'prospect', 'negotiation', 'inactive']).optional(),
      cursor: z.string().optional(),
      limit: limitSchema,
    }).parse(req.query);
    const cur = decodeCursor<[string, string]>(q.cursor);
    const key = q.q && q.q.length >= 2 ? `%${searchKey(q.q)}%` : null;
    const T = req.session.tenantId;

    return withTenant(T, async (tx) => {
      const rows = await tx`
        SELECT id, code, kind, name, status, category, image_url, annual_value, companies_count, branches_count, spaces_count
        FROM customers
        WHERE tenant_id = ${T}
          ${q.status ? tx`AND status = ${q.status}` : tx``}
          ${key ? tx`AND search LIKE ${key}` : tx``}
          ${cur ? tx`AND (name, id) > (${cur[0]}, ${cur[1]}::uuid)` : tx``}
        ORDER BY name, id
        LIMIT ${q.limit + 1}`;
      return page(rows, q.limit, (r) => [r.name, r.id]);
    });
  });

  app.get('/customers/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const T = req.session.tenantId;
    return withTenant(T, async (tx) => {
      const [customer] = await tx`
        SELECT c.*, u.full_name AS account_manager_name, p.name AS parent_name
        FROM customers c
        LEFT JOIN users u ON u.id = c.account_manager_id
        LEFT JOIN customers p ON p.id = c.parent_id
        WHERE c.id = ${id}`;
      if (!customer) return reply.code(404).send({ error: 'not_found' });
      const branches = await tx`SELECT id, name, city, status, spaces_count FROM branches WHERE tenant_id = ${T} AND customer_id = ${id} ORDER BY name LIMIT 50`;
      const [stats] = await tx`
        SELECT count(*) FILTER (WHERE status IN ('draft','in_progress','pending_approval','sent'))::int AS open_offers,
               count(*) FILTER (WHERE status = 'accepted')::int AS won_offers,
               coalesce(sum(total_amount) FILTER (WHERE status = 'pending_approval'), 0) AS pending_amount
        FROM offers WHERE tenant_id = ${T} AND customer_id = ${id}`;
      const activities = await tx`
        SELECT a.id, a.kind, a.title, a.body, a.occurred_at, u.full_name AS actor_name
        FROM activities a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.tenant_id = ${T} AND a.customer_id = ${id}
        ORDER BY a.occurred_at DESC LIMIT 20`;
      const contacts = await tx`SELECT id, full_name, email, phone, role_title FROM contacts WHERE tenant_id = ${T} AND customer_id = ${id} ORDER BY full_name LIMIT 50`;
      return { customer, branches, stats, activities, contacts };
    });
  });

  app.post('/customers', async (req, reply) => {
    if (!hasRole(req.session, 'sales')) return reply.code(403).send({ error: 'forbidden' });
    const b = z.object({
      name: z.string().trim().min(2).max(200),
      vat: z.string().trim().max(20).optional(),
      kind: z.enum(['group', 'company']).default('company'),
      status: z.enum(['active', 'prospect', 'negotiation', 'inactive']).default('prospect'),
    }).parse(req.body);
    const { tenantId, userId } = req.session;
    const customer = await withTenant(tenantId, async (tx) => {
      const code = 'CUST-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      const [c] = await tx`
        INSERT INTO customers (tenant_id, code, kind, name, vat, status, account_manager_id)
        VALUES (${tenantId}, ${code}, ${b.kind}, ${b.name}, ${b.vat ?? null}, ${b.status}, ${userId})
        RETURNING id, name, code`;
      await tx`INSERT INTO activities (tenant_id, customer_id, actor_id, kind, title) VALUES (${tenantId}, ${c.id}, ${userId}, 'note', 'Δημιουργία πελάτη')`;
      return c;
    });
    await publish({ tenantId, type: 'customer.created', data: { id: customer.id } });
    return reply.code(201).send(customer);
  });

  app.get('/customers/:id/activities', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ cursor: z.string().optional(), limit: limitSchema }).parse(req.query);
    const cur = decodeCursor<[string, string]>(q.cursor);
    const T = req.session.tenantId;
    return withTenant(T, async (tx) => {
      const rows = await tx`
        SELECT a.id, a.kind, a.title, a.body, a.occurred_at, u.full_name AS actor_name
        FROM activities a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.tenant_id = ${T} AND a.customer_id = ${id}
          ${cur ? tx`AND (a.occurred_at, a.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
        ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${q.limit + 1}`;
      return page(rows, q.limit, (r) => [r.occurred_at, r.id]);
    });
  });

  // Branches with their spaces (for pickers, e.g. new offer)
  app.get('/customers/:id/branches', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const T = req.session.tenantId;
    return withTenant(T, (tx) => tx`
      SELECT b.id, b.name, b.city,
             coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'kind', s.kind) ORDER BY s.name)
                      FILTER (WHERE s.id IS NOT NULL), '[]') AS spaces
      FROM branches b LEFT JOIN spaces s ON s.branch_id = b.id
      WHERE b.tenant_id = ${T} AND b.customer_id = ${id}
      GROUP BY b.id ORDER BY b.name LIMIT 200`);
  });

  // ---- Calendar ----
  app.get('/events', async (req) => {
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date(), all: z.enum(['0', '1']).default('0') }).parse(req.query);
    const T = req.session.tenantId;
    return withTenant(T, async (tx) => tx`
      SELECT e.id, e.kind, e.title, e.location, e.starts_at, e.ends_at, c.name AS customer_name
      FROM events e LEFT JOIN customers c ON c.id = e.customer_id
      WHERE e.tenant_id = ${T}
        ${q.all === '0' ? tx`AND e.owner_id = ${req.session.userId}` : tx``}
        AND e.starts_at >= ${q.from} AND e.starts_at < ${q.to}
      ORDER BY e.starts_at LIMIT 500`);
  });
}
