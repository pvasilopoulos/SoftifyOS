// Customers at risk (list + one customer's score). Scores are computed by the worker (src/risk.ts);
// these routes only read them, so the list stays fast with any number of customers.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { can, requireAuth } from '../auth.js';
import { enqueue } from '../jobs.js';

export default async function insightRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/customers/at-risk', async (req) => {
      const s = req.session;
      const q = z.object({
        mine: z.enum(['0', '1']).default('0'),
        level: z.enum(['high', 'medium', 'low', '']).default(''),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      }).parse(req.query);
      return withTenant(s.tenantId, async (tx) => {
        const mine = q.mine === '1' ? tx`AND c.account_manager_id = ${s.userId}` : tx``;
        const items = await tx`
          SELECT c.id, c.name, c.code, c.status, c.address_city AS city, c.annual_value, u.full_name AS account_manager,
                 r.score, r.level, r.reasons, r.computed_at,
                 (SELECT max(coalesce(a.completed_at, a.due_at)) FROM crm_activities a WHERE a.customer_id = c.id AND a.status = 'done') AS last_contact
          FROM customer_risk r JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = c.account_manager_id
          WHERE c.archived_at IS NULL ${mine} ${q.level ? tx`AND r.level = ${q.level}` : tx``}
          ORDER BY r.score DESC, c.annual_value DESC, c.id
          LIMIT ${q.limit + 1} OFFSET ${q.offset}`;
        const counts = await tx`
          SELECT r.level, count(*)::int AS n FROM customer_risk r JOIN customers c ON c.id = r.customer_id
          WHERE c.archived_at IS NULL ${mine} GROUP BY r.level`;
        const [t] = await tx`SELECT risk_computed_at FROM tenants WHERE id = ${s.tenantId}`;
        return {
          items: items.slice(0, q.limit), has_more: items.length > q.limit,
          counts: Object.fromEntries(['high', 'medium', 'low'].map((l) => [l, counts.find((c) => c.level === l)?.n ?? 0])),
          computed_at: t?.risk_computed_at ?? null, can_refresh: can(s, 'settings.manage'),
        };
      });
    });

    r.get('/customers/:id/risk', async (req) => {
      const s = req.session;
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const [row] = await withTenant(s.tenantId, (tx) => tx`SELECT score, level, reasons, computed_at FROM customer_risk WHERE customer_id = ${id}`);
      return { risk: row ?? null };
    });

    // Recompute now (otherwise every few hours). Admins only: it reads every customer of the organisation.
    r.post('/customers/at-risk/refresh', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      await enqueue('risk_refresh', { tenantId: s.tenantId });
      return { ok: true };
    });
  });
}
