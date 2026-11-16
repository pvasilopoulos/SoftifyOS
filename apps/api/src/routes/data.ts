import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { requireAuth } from '../auth.js';

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
