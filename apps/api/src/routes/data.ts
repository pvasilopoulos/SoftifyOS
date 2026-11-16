import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decodeCursor, encodeCursor, searchKey, withTenant } from '../db.js';
import { hasRole, requireAuth } from '../auth.js';
import { publish } from '../realtime.js';
import { enqueue } from '../jobs.js';

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

  // ---- Offers ----
  app.get('/offers', async (req) => {
    const q = z.object({
      status: z.enum(['draft', 'in_progress', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected']).optional(),
      cursor: z.string().optional(),
      limit: limitSchema,
    }).parse(req.query);
    const cur = decodeCursor<[string, string]>(q.cursor);
    const T = req.session.tenantId;
    return withTenant(T, async (tx) => {
      const rows = await tx`
        SELECT o.id, o.number, o.status, o.current_version, o.total_amount, o.valid_until, o.created_at,
               c.name AS customer_name, b.name AS branch_name
        FROM offers o
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN branches b ON b.id = o.branch_id
        WHERE o.tenant_id = ${T}
          ${q.status ? tx`AND o.status = ${q.status}` : tx``}
          ${cur ? tx`AND (o.created_at, o.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ${q.limit + 1}`;
      return page(rows, q.limit, (r) => [r.created_at, r.id]);
    });
  });

  app.get('/offers/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(req.session.tenantId, async (tx) => {
      const [offer] = await tx`
        SELECT o.*, c.name AS customer_name, b.name AS branch_name, co.name AS company_name, u.full_name AS owner_name
        FROM offers o JOIN customers c ON c.id = o.customer_id
        LEFT JOIN branches b ON b.id = o.branch_id
        LEFT JOIN companies co ON co.id = o.company_id
        LEFT JOIN users u ON u.id = o.owner_id
        WHERE o.id = ${id}`;
      if (!offer) return reply.code(404).send({ error: 'not_found' });
      const approvals = await tx`
        SELECT a.id, a.step, a.title, a.status, a.decided_at, u.full_name AS approver_name
        FROM offer_approvals a LEFT JOIN users u ON u.id = a.approver_id
        WHERE a.offer_id = ${id} ORDER BY a.step`;
      return { offer, approvals };
    });
  });

  // Approve the current pending step -> notifies the offer owner (live + push)
  app.post('/offers/:id/approve', async (req, reply) => {
    if (!hasRole(req.session, 'manager')) return reply.code(403).send({ error: 'forbidden' });
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { tenantId, userId } = req.session;
    const result = await withTenant(tenantId, async (tx) => {
      const [step] = await tx`
        UPDATE offer_approvals SET status = 'approved', decided_at = now()
        WHERE id = (SELECT id FROM offer_approvals WHERE offer_id = ${id} AND status = 'pending' ORDER BY step LIMIT 1 FOR UPDATE)
        RETURNING step, title`;
      if (!step) return null;
      const [{ remaining }] = await tx`SELECT count(*)::int AS remaining FROM offer_approvals WHERE offer_id = ${id} AND status = 'pending'`;
      const [offer] = await tx`
        UPDATE offers SET status = ${remaining === 0 ? 'approved' : 'pending_approval'}, updated_at = now()
        WHERE id = ${id} RETURNING id, number, owner_id, customer_id, status`;
      await tx`INSERT INTO activities (tenant_id, customer_id, offer_id, actor_id, kind, title, body)
               VALUES (${tenantId}, ${offer.customer_id}, ${id}, ${userId}, 'approval', 'Έγκριση προσφοράς', ${step.title + ' · ' + offer.number})`;
      if (offer.owner_id) {
        await enqueue('notify', {
          tenantId,
          userIds: [offer.owner_id],
          title: `Έγκριση: ${offer.number}`,
          body: remaining === 0 ? 'Η προσφορά εγκρίθηκε πλήρως' : `Εγκρίθηκε το βήμα: ${step.title}`,
          url: `/offers/${id}`,
        }, tx);
      }
      return offer;
    });
    if (!result) return reply.code(409).send({ error: 'nothing_to_approve' });
    await publish({ tenantId, type: 'offer.updated', data: { id, status: result.status } });
    return result;
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
