// Reports: catalogue & presets, run a definition, saved reports (private / role / organisation),
// e-mail schedule, and the personal home dashboard.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { can, requireAuth, type Permission, type Session } from '../auth.js';
import { audit } from './settings.js';
import { catalogue, definitionSchema, nextRun, PRESETS, runReport } from '../reports.js';

const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });
const idParam = z.object({ id: z.string().uuid() });
const viewer = (s: Session) => ({ tenantId: s.tenantId, userId: s.userId, perms: (p: string) => can(s, p as Permission) });
const scheduleSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']), weekday: z.coerce.number().int().min(1).max(7).optional(),
  day: z.coerce.number().int().min(1).max(28).optional(), hour: z.coerce.number().int().min(0).max(23).default(8),
  recipients: z.array(z.string().uuid()).min(1).max(30),
}).nullish();
const savedSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullish(),
  definition: definitionSchema, scope: z.enum(['private', 'role', 'organization']).default('private'), role_key: z.string().max(40).nullish(),
  schedule: scheduleSchema,
});
const widgetsSchema = z.array(z.object({
  id: z.string().max(40), kind: z.enum(['preset', 'saved']), ref: z.string().max(60), size: z.enum(['sm', 'md', 'lg']).default('md'),
})).max(24);

export default async function reportRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    const visibleSaved = (s: Session) => (tx: import('../db.js').Tx) => tx`
      SELECT r.id, r.name, r.description, r.definition, r.scope, r.role_key, r.schedule, r.next_run_at, r.last_sent_at, r.owner_id,
             u.full_name AS owner_name, r.updated_at, (r.owner_id = ${s.userId}) AS mine
      FROM saved_reports r LEFT JOIN users u ON u.id = r.owner_id
      WHERE r.tenant_id = ${s.tenantId} AND (r.owner_id = ${s.userId} OR r.scope = 'organization' OR (r.scope = 'role' AND r.role_key = ${s.role})
        ${can(s, 'views.share') ? tx`OR r.scope = 'role'` : tx``})
      ORDER BY r.name`;

    r.get('/reports/meta', async (req) => {
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => ({
        catalogue: catalogue(), presets: PRESETS, saved: await visibleSaved(s)(tx),
        users: await tx`SELECT u.id, u.full_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} ORDER BY u.full_name`,
        roles: await tx`SELECT key, name FROM roles WHERE tenant_id = ${s.tenantId} ORDER BY sort`,
        categories: (await tx`SELECT name FROM lookup_values WHERE tenant_id = ${s.tenantId} AND list = 'customer_category' AND active ORDER BY sort, name`).map((x) => x.name as string),
        regions: (await tx`SELECT name FROM lookup_values WHERE tenant_id = ${s.tenantId} AND list = 'prefecture' AND active ORDER BY sort, name`).map((x) => x.name as string),
        can: { share: can(s, 'views.share') }, me: s.userId,
      }));
    });

    r.post('/reports/run', async (req, reply) => {
      const s = req.session;
      const parsed = definitionSchema.safeParse((req.body as { definition?: unknown })?.definition);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_definition', detail: parsed.error.issues.map((i) => i.message) });
      return withTenant(s.tenantId, (tx) => runReport(tx, viewer(s), parsed.data));
    });

    // ---- saved reports
    r.post('/reports/saved', async (req, reply) => {
      const s = req.session;
      const b = savedSchema.parse(req.body);
      if (b.scope !== 'private' && !can(s, 'views.share')) return forbid(reply);
      const row = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`INSERT INTO saved_reports (tenant_id, owner_id, name, description, definition, scope, role_key, schedule, next_run_at)
          VALUES (${s.tenantId}, ${s.userId}, ${b.name}, ${b.description ?? null}, ${tx.json(b.definition as never)}, ${b.scope}, ${b.scope === 'role' ? b.role_key ?? null : null},
                  ${b.schedule ? tx.json(b.schedule as never) : null}, ${b.schedule ? nextRun(b.schedule) : null}) RETURNING id`;
        await audit(tx, s, 'reports.save', b.name, { scope: b.scope, scheduled: !!b.schedule });
        return x;
      });
      return reply.code(201).send(row);
    });
    r.put('/reports/saved/:id', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const b = savedSchema.parse(req.body);
      if (b.scope !== 'private' && !can(s, 'views.share')) return forbid(reply);
      const ok = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`UPDATE saved_reports SET name = ${b.name}, description = ${b.description ?? null}, definition = ${tx.json(b.definition as never)},
          scope = ${b.scope}, role_key = ${b.scope === 'role' ? b.role_key ?? null : null}, schedule = ${b.schedule ? tx.json(b.schedule as never) : null},
          next_run_at = ${b.schedule ? nextRun(b.schedule) : null}, updated_at = now()
          WHERE id = ${id} AND (owner_id = ${s.userId} ${can(s, 'views.share') ? tx`OR scope <> 'private'` : tx``}) RETURNING id`;
        return !!x;
      });
      return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
    });
    r.delete('/reports/saved/:id', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const ok = await withTenant(s.tenantId, async (tx) => !!(await tx`DELETE FROM saved_reports WHERE id = ${id}
        AND (owner_id = ${s.userId} ${can(s, 'views.share') ? tx`OR scope <> 'private'` : tx``}) RETURNING id`)[0]);
      return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
    });

    // ---- home dashboard widgets
    r.get('/reports/dashboard', async (req) => {
      const s = req.session;
      const [d] = await withTenant(s.tenantId, (tx) => tx`SELECT widgets FROM user_dashboards WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId}`);
      return { widgets: d?.widgets ?? [] };
    });
    r.put('/reports/dashboard', async (req) => {
      const s = req.session;
      const { widgets } = z.object({ widgets: widgetsSchema }).parse(req.body);
      await withTenant(s.tenantId, (tx) => tx`
        INSERT INTO user_dashboards (tenant_id, user_id, widgets) VALUES (${s.tenantId}, ${s.userId}, ${tx.json(widgets as never)})
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET widgets = EXCLUDED.widgets, updated_at = now()`);
      return { ok: true };
    });
  });
}
