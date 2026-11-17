import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { can, requireAuth } from '../auth.js';

export default async function dataRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---- Dashboard: reads only pre-aggregated counters + small indexed slices ----
  app.get('/dashboard', async (req) => {
    const { tenantId, userId } = req.session;
    return withTenant(tenantId, async (tx) => {
      const stats = await tx`SELECT status, count, amount FROM tenant_offer_stats`;
      const counters = await tx`SELECT key, value FROM tenant_counters`;
      const upcoming = await tx`
        SELECT e.id, e.subject AS title, e.type AS kind, e.location, e.due_at AS starts_at, e.due_at + (greatest(e.duration_min, 15) * interval '1 minute') AS ends_at,
               c.name AS customer_name
        FROM crm_activities e LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.tenant_id = ${tenantId} AND e.owner_id = ${userId} AND e.status IN ('planned', 'in_progress') AND e.due_at >= now() - interval '2 hours'
        ORDER BY e.due_at LIMIT 5`;
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
      SELECT e.id, e.type AS kind, e.subject AS title, e.location, e.due_at AS starts_at,
             e.due_at + (greatest(e.duration_min, 15) * interval '1 minute') AS ends_at, e.status, e.all_day,
             c.name AS customer_name, t.name AS type_name, t.color AS type_color, t.icon AS type_icon
      FROM crm_activities e LEFT JOIN customers c ON c.id = e.customer_id
      LEFT JOIN crm_activity_types t ON t.tenant_id = e.tenant_id AND t.key = e.type
      WHERE e.tenant_id = ${T} AND e.status <> 'cancelled'
        ${q.all === '0' || !can(req.session, 'activities.all') ? tx`AND e.owner_id = ${req.session.userId}` : tx``}
        AND e.due_at >= ${q.from} AND e.due_at < ${q.to}
      ORDER BY e.due_at LIMIT 1000`);
  });
}
