// Settings → AI: usage dashboard (per user / feature / model / day / customer), CSV export, limits, price list,
// requests for extra budget, the Anthropic Admin API key + reconciliation; and "my AI usage" for every user.
import type { FastifyInstance, FastifyReply } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { sql, withTenant } from '../db.js';
import { can, requireAuth, type Session } from '../auth.js';
import { decryptSecret, encryptSecret } from '../registries.js';
import { audit } from './settings.js';
import { FEATURES, loadSettings } from '../ai.js';
import { anthropicKeys, DEFAULT_PRICES, invalidatePrices, reconcile, userLimit, withLimitDefaults, type Limits } from '../ai-cost.js';

const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });
const admin = (s: Session) => can(s, 'settings.manage');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ from: day.optional(), to: day.optional() });
function period(q: { from?: string; to?: string }) {
  const now = new Date();
  const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = q.to ? new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 864e5) : new Date(now.getTime() + 60_000);
  return { from, to };
}
const limitSchema = z.object({ monthly: z.coerce.number().min(0).max(100000).nullable(), daily: z.coerce.number().min(0).max(100000).nullable() });
const limitsSchema = z.object({
  warn_pct: z.coerce.number().int().min(10).max(99),
  rate_per_min: z.coerce.number().int().min(1).max(600).nullable(),
  roles: z.record(z.string().max(40), limitSchema),
  users: z.record(z.string().uuid(), limitSchema),
  features: z.partialRecord(z.enum(FEATURES), z.coerce.number().min(0).max(100000).nullable()),
});

export default async function aiUsageRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    // ---------------------------------------------------------------- dashboard
    r.get('/settings/ai/usage', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const { from, to } = period(range.parse(req.query));
      const T = s.tenantId;
      const st = await loadSettings(T);
      const limits = withLimitDefaults(st.limits);
      return withTenant(T, async (tx) => {
        const W = tx`a.tenant_id = ${T} AND a.created_at >= ${from} AND a.created_at < ${to}`;
        const [tot] = await tx`
          SELECT coalesce(sum(cost_usd), 0)::float AS usd, count(*) FILTER (WHERE status <> 'blocked')::int AS calls,
                 count(*) FILTER (WHERE status = 'error')::int AS errors, count(*) FILTER (WHERE status = 'refused')::int AS refused,
                 count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
                 coalesce(sum(input_tokens), 0)::bigint AS input, coalesce(sum(output_tokens), 0)::bigint AS output,
                 coalesce(sum(cache_read), 0)::bigint AS cache_read, coalesce(sum(cache_write), 0)::bigint AS cache_write,
                 coalesce(avg(duration_ms) FILTER (WHERE status = 'ok'), 0)::int AS avg_ms,
                 count(DISTINCT user_id)::int AS users
          FROM ai_usage a WHERE ${W}`;
        const month = await tx`
          SELECT coalesce(sum(cost_usd), 0)::float AS usd FROM ai_usage WHERE tenant_id = ${T} AND created_at >= date_trunc('month', now())`;
        // Month forecast at the current daily pace
        const now = new Date();
        const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
        const elapsed = Math.max(1, (now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) / 864e5);
        const monthUsd = month[0].usd as number;
        const extras = await tx`SELECT user_id, sum(amount_usd)::float AS usd FROM ai_budget_requests
                                WHERE tenant_id = ${T} AND status = 'approved' AND month = date_trunc('month', now())::date GROUP BY user_id`;
        const extraBy = new Map(extras.map((x) => [x.user_id as string, x.usd as number]));
        const users = await tx`
          SELECT m.user_id, u.full_name AS name, u.email, m.role,
                 coalesce(p.calls, 0)::int AS calls, coalesce(p.usd, 0)::float AS usd, coalesce(p.errors, 0)::int AS errors, coalesce(p.blocked, 0)::int AS blocked,
                 coalesce(mo.usd, 0)::float AS month_usd, coalesce(d.usd, 0)::float AS today_usd, p.last_at
          FROM memberships m JOIN users u ON u.id = m.user_id
          LEFT JOIN (SELECT user_id, count(*) FILTER (WHERE status <> 'blocked') AS calls, sum(cost_usd) AS usd, count(*) FILTER (WHERE status = 'error') AS errors,
                            count(*) FILTER (WHERE status = 'blocked') AS blocked, max(created_at) AS last_at
                     FROM ai_usage a WHERE ${W} GROUP BY user_id) p ON p.user_id = m.user_id
          LEFT JOIN (SELECT user_id, sum(cost_usd) AS usd FROM ai_usage WHERE tenant_id = ${T} AND created_at >= date_trunc('month', now()) GROUP BY user_id) mo ON mo.user_id = m.user_id
          LEFT JOIN (SELECT user_id, sum(cost_usd) AS usd FROM ai_usage WHERE tenant_id = ${T} AND created_at >= date_trunc('day', now()) GROUP BY user_id) d ON d.user_id = m.user_id
          WHERE m.tenant_id = ${T} ORDER BY coalesce(p.usd, 0) DESC, u.full_name`;
        // Spikes: last hour well above the user's usual pace (same rule as the notification)
        const spikes = await tx`
          SELECT a.user_id, u.full_name AS name,
                 sum(cost_usd) FILTER (WHERE a.created_at > now() - interval '1 hour')::float AS hour,
                 (sum(cost_usd) FILTER (WHERE a.created_at <= now() - interval '1 hour') / (14 * 24))::float AS avg
          FROM ai_usage a JOIN users u ON u.id = a.user_id WHERE a.tenant_id = ${T} AND a.created_at > now() - interval '14 days'
          GROUP BY a.user_id, u.full_name
          HAVING coalesce(sum(cost_usd) FILTER (WHERE a.created_at > now() - interval '1 hour'), 0) > greatest(0.5, 5 * coalesce(sum(cost_usd) FILTER (WHERE a.created_at <= now() - interval '1 hour') / (14 * 24), 0))`;
        const [admin] = await tx`SELECT ai_admin_meta FROM tenants WHERE id = ${T}`;
        return {
          period: { from: from.toISOString(), to: to.toISOString() },
          totals: {
            ...tot, input: Number(tot.input), output: Number(tot.output), cache_read: Number(tot.cache_read), cache_write: Number(tot.cache_write),
            avg_call: tot.calls ? (tot.usd as number) / (tot.calls as number) : 0,
            cache_hit_pct: Number(tot.input) + Number(tot.cache_read) ? Math.round((Number(tot.cache_read) / (Number(tot.input) + Number(tot.cache_read))) * 100) : 0,
            error_rate: tot.calls ? Math.round(((tot.errors as number) / (tot.calls as number)) * 1000) / 10 : 0,
          },
          month: { usd: monthUsd, budget: st.monthly_budget_usd, forecast: (monthUsd / elapsed) * dim, days_left: Math.max(0, Math.ceil(dim - elapsed)) },
          limits,
          users: users.map((u) => {
            const lim = userLimit(limits, { userId: u.user_id as string, role: u.role as string });
            const extra = extraBy.get(u.user_id as string) ?? 0;
            return { ...u, limit: lim, extra, source: limits.users[u.user_id as string] ? 'user' : limits.roles[u.role as string] ? 'role' : null,
              pct: lim.monthly !== null ? Math.round(((u.month_usd as number) / Math.max(0.0001, lim.monthly + extra)) * 100) : null };
          }),
          by_feature: await tx`SELECT feature, count(*) FILTER (WHERE status <> 'blocked')::int AS calls, sum(cost_usd)::float AS usd,
                                      count(*) FILTER (WHERE status = 'blocked')::int AS blocked FROM ai_usage a WHERE ${W} GROUP BY feature ORDER BY usd DESC NULLS LAST`,
          by_model: await tx`SELECT model, count(*)::int AS calls, sum(cost_usd)::float AS usd, sum(input_tokens)::bigint AS input, sum(output_tokens)::bigint AS output
                             FROM ai_usage a WHERE ${W} AND status <> 'blocked' GROUP BY model ORDER BY usd DESC`,
          by_day: await tx`SELECT (a.created_at AT TIME ZONE 'Europe/Athens')::date::text AS day, sum(cost_usd)::float AS usd, count(*) FILTER (WHERE status <> 'blocked')::int AS calls
                           FROM ai_usage a WHERE ${W} GROUP BY 1 ORDER BY 1`,
          by_customer: await tx`SELECT c.id, c.name, count(*)::int AS calls, sum(a.cost_usd)::float AS usd FROM ai_usage a JOIN customers c ON c.id = a.entity_id
                                WHERE ${W} AND a.entity = 'customer' GROUP BY c.id, c.name ORDER BY usd DESC LIMIT 15`,
          spikes,
          recent: await tx`SELECT a.created_at, u.full_name AS user_name, a.feature, a.model, a.status, a.error, a.input_tokens, a.output_tokens, a.cache_read,
                                  a.cost_usd::float AS usd, a.duration_ms, a.request_id, a.entity, a.entity_id
                           FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id WHERE ${W} ORDER BY a.created_at DESC LIMIT 100`,
          requests: await tx`SELECT b.id, b.user_id, u.full_name AS name, b.month, b.amount_usd::float AS amount_usd, b.reason, b.status, b.note, b.created_at, b.decided_at,
                                    d.full_name AS decided_by_name
                             FROM ai_budget_requests b JOIN users u ON u.id = b.user_id LEFT JOIN users d ON d.id = b.decided_by
                             WHERE b.tenant_id = ${T} ORDER BY (b.status = 'pending') DESC, b.created_at DESC LIMIT 50`,
          reconciliation: {
            configured: !!admin?.ai_admin_meta, meta: admin?.ai_admin_meta ?? null,
            days: await tx`SELECT day::text, estimated_usd::float, billed_usd::float, list_usd::float, requests, by_model, fetched_at FROM ai_reconciliation
                           WHERE tenant_id = ${T} ORDER BY day DESC LIMIT 31`,
          },
        };
      });
    });

    // ---------------------------------------------------------------- CSV (accounting)
    r.get('/settings/ai/usage.csv', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const { from, to } = period(range.parse(req.query));
      const rows = await withTenant(s.tenantId, (tx) => tx`
        SELECT a.created_at, u.full_name, u.email, a.feature, a.model, a.status, a.error, a.input_tokens, a.output_tokens, a.cache_read, a.cache_write,
               a.cost_usd, a.duration_ms, a.request_id, a.entity, a.entity_id, c.name AS customer
        FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN customers c ON a.entity = 'customer' AND c.id = a.entity_id
        WHERE a.tenant_id = ${s.tenantId} AND a.created_at >= ${from} AND a.created_at < ${to} ORDER BY a.created_at LIMIT 200000`);
      const esc = (v: unknown) => { const x = v instanceof Date ? v.toISOString() : String(v ?? ''); return /[",;\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
      const head = ['time', 'user', 'email', 'feature', 'model', 'status', 'error', 'input_tokens', 'output_tokens', 'cache_read', 'cache_write', 'cost_usd', 'duration_ms', 'request_id', 'entity', 'entity_id', 'customer'];
      const body = rows.map((r) => [r.created_at, r.full_name, r.email, r.feature, r.model, r.status, r.error, r.input_tokens, r.output_tokens, r.cache_read, r.cache_write, r.cost_usd, r.duration_ms, r.request_id, r.entity, r.entity_id, r.customer].map(esc).join(','));
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="ai-usage-${from.toISOString().slice(0, 10)}.csv"`);
      return `﻿${[head.join(','), ...body].join('\n')}`;
    });

    // ---------------------------------------------------------------- limits
    r.put('/settings/ai/limits', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const b = limitsSchema.parse(req.body) as Limits;
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET ai_settings = coalesce(ai_settings, '{}'::jsonb) || ${tx.json({ limits: b } as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'ai.limits', null, { roles: Object.keys(b.roles).length, users: Object.keys(b.users).length, warn_pct: b.warn_pct });
      });
      return { ok: true };
    });

    // ---------------------------------------------------------------- price list
    r.get('/settings/ai/prices', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const rows = await withTenant(s.tenantId, (tx) => tx`SELECT model, valid_from::text, input::float, output::float, cache_read::float, cache_write::float
                                                          FROM ai_prices WHERE tenant_id = ${s.tenantId} ORDER BY model, valid_from DESC`);
      return { defaults: DEFAULT_PRICES, rows };
    });
    r.put('/settings/ai/prices', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const b = z.object({
        model: z.string().trim().min(3).max(80).regex(/^[a-z0-9.\-]+$/), valid_from: day,
        input: z.coerce.number().min(0).max(1000), output: z.coerce.number().min(0).max(1000), cache_read: z.coerce.number().min(0).max(1000), cache_write: z.coerce.number().min(0).max(1000),
      }).parse(req.body);
      await withTenant(s.tenantId, async (tx) => {
        await tx`INSERT INTO ai_prices ${tx({ tenant_id: s.tenantId, ...b } as never)}
                 ON CONFLICT (tenant_id, model, valid_from) DO UPDATE SET input = EXCLUDED.input, output = EXCLUDED.output, cache_read = EXCLUDED.cache_read, cache_write = EXCLUDED.cache_write`;
        await audit(tx, s, 'ai.price', null, b);
      });
      invalidatePrices(s.tenantId);
      return { ok: true };
    });
    r.delete('/settings/ai/prices', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const b = z.object({ model: z.string().max(80), valid_from: day }).parse(req.query);
      await withTenant(s.tenantId, (tx) => tx`DELETE FROM ai_prices WHERE tenant_id = ${s.tenantId} AND model = ${b.model} AND valid_from = ${b.valid_from}`);
      invalidatePrices(s.tenantId);
      return { ok: true };
    });

    // ---------------------------------------------------------------- my usage + asking for more
    r.get('/ai/me/usage', async (req) => {
      const s = req.session;
      const st = await loadSettings(s.tenantId);
      const limits = withLimitDefaults(st.limits);
      return withTenant(s.tenantId, async (tx) => {
        const [u] = await tx`SELECT coalesce(sum(cost_usd), 0)::float AS month, coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::float AS today,
                                    count(*) FILTER (WHERE status <> 'blocked')::int AS calls
                             FROM ai_usage WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId} AND created_at >= date_trunc('month', now())`;
        const [x] = await tx`SELECT coalesce(sum(amount_usd), 0)::float AS extra FROM ai_budget_requests WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId}
                             AND status = 'approved' AND month = date_trunc('month', now())::date`;
        return {
          ...u, limit: userLimit(limits, s), extra: x.extra,
          by_feature: await tx`SELECT feature, count(*)::int AS calls, sum(cost_usd)::float AS usd FROM ai_usage WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId}
                               AND created_at >= date_trunc('month', now()) AND status <> 'blocked' GROUP BY feature ORDER BY usd DESC`,
          requests: await tx`SELECT id, amount_usd::float AS amount_usd, reason, status, note, created_at FROM ai_budget_requests
                             WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId} ORDER BY created_at DESC LIMIT 10`,
        };
      });
    });
    r.post('/ai/budget-requests', async (req, reply) => {
      const s = req.session;
      const b = z.object({ amount_usd: z.coerce.number().min(0.5).max(10000), reason: z.string().trim().max(500).optional() }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [open] = await tx`SELECT 1 FROM ai_budget_requests WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId} AND status = 'pending'`;
        if (open) return null;
        const [row] = await tx`INSERT INTO ai_budget_requests (tenant_id, user_id, month, amount_usd, reason)
                               VALUES (${s.tenantId}, ${s.userId}, date_trunc('month', now())::date, ${b.amount_usd}, ${b.reason ?? null}) RETURNING id`;
        return row;
      });
      if (!res) return reply.code(409).send({ error: 'already_pending' });
      const [me] = await sql`SELECT full_name FROM users WHERE id = ${s.userId}`;
      const admins = (await sql`SELECT m.user_id FROM memberships m LEFT JOIN roles r ON r.tenant_id = m.tenant_id AND r.key = m.role
                                WHERE m.tenant_id = ${s.tenantId} AND (m.role = 'owner' OR 'settings.manage' = ANY(r.permissions))`).map((x) => x.user_id as string);
      if (admins.length) {
        await sql`INSERT INTO jobs (kind, payload) VALUES ('notify', ${sql.json({ tenantId: s.tenantId, userIds: admins, title: `AI: αίτημα αύξησης ορίου από ${me?.full_name ?? ''}`,
          body: `+${b.amount_usd.toFixed(2)} $ για αυτόν τον μήνα${b.reason ? ` · ${b.reason}` : ''}`, url: '/settings?s=ai' } as never)})`;
      }
      return { ok: true, id: res.id };
    });
    r.post('/settings/ai/budget-requests/:id/decide', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({ approve: z.boolean(), amount_usd: z.coerce.number().min(0.5).max(10000).optional(), note: z.string().trim().max(500).optional() }).parse(req.body);
      const row = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`UPDATE ai_budget_requests SET status = ${b.approve ? 'approved' : 'rejected'}, amount_usd = coalesce(${b.amount_usd ?? null}::numeric, amount_usd),
                               decided_by = ${s.userId}, decided_at = now(), note = ${b.note ?? null}
                             WHERE id = ${id} AND status = 'pending' RETURNING user_id, amount_usd::float AS amount_usd`;
        if (x) await audit(tx, s, b.approve ? 'ai.budget_approved' : 'ai.budget_rejected', null, { user_id: x.user_id, amount: x.amount_usd });
        return x;
      });
      if (!row) return reply.code(404).send({ error: 'not_found' });
      await sql`INSERT INTO jobs (kind, payload) VALUES ('notify', ${sql.json({ tenantId: s.tenantId, userIds: [row.user_id],
        title: b.approve ? `AI: εγκρίθηκε +${(row.amount_usd as number).toFixed(2)} $` : 'AI: το αίτημα αύξησης δεν εγκρίθηκε', body: b.note ?? '', url: '/settings?s=profile' } as never)})`;
      return { ok: true };
    });

    // ---------------------------------------------------------------- Anthropic Admin API key + reconciliation
    r.put('/settings/ai/admin-key', async (req, reply) => {
      const s = req.session;
      if (!admin(s) || s.impersonator) return forbid(reply);
      const { key } = z.object({ key: z.string().trim().min(20).max(300).regex(/^sk-ant-admin[A-Za-z0-9_\-]+$/, 'admin_key_format') }).parse(req.body);
      // Check it reaches the organisation, and find our API key(s) among its keys by their last 4 characters
      const [t] = await sql`SELECT ai_key_meta FROM tenants WHERE id = ${s.tenantId}`;
      const own = (t?.ai_key_meta as { last4?: string } | null)?.last4;
      const envKey = process.env.ANTHROPIC_API_KEY ?? '';
      let keys;
      try { keys = await anthropicKeys(new Anthropic({ apiKey: key }), own ? [own] : [envKey.slice(-4)]); }
      catch (e) { return { ok: false, error: e instanceof Anthropic.AuthenticationError ? 'invalid_key' : e instanceof Anthropic.PermissionDeniedError ? 'permission' : 'api_error', detail: (e as Error).message.slice(0, 200) }; }
      const meta = { last4: key.slice(-4), set_by: s.userId, set_at: new Date().toISOString(), api_key_ids: keys.filter((k) => k.ours).map((k) => k.id),
        keys: keys.map((k) => ({ id: k.id, name: k.name, hint: k.hint, status: k.status })) };
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET ai_admin_key_enc = ${encryptSecret(key)}, ai_admin_meta = ${tx.json(meta as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'ai.admin_key_set', null, { last4: meta.last4, matched: meta.api_key_ids.length });
      });
      return { ok: true, keys: meta.keys, matched: meta.api_key_ids };
    });
    r.put('/settings/ai/admin-key/keys', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const { api_key_ids } = z.object({ api_key_ids: z.array(z.string().max(100)).max(20) }).parse(req.body);
      await withTenant(s.tenantId, (tx) => tx`UPDATE tenants SET ai_admin_meta = coalesce(ai_admin_meta, '{}'::jsonb) || ${tx.json({ api_key_ids } as never)} WHERE id = ${s.tenantId}`);
      return { ok: true };
    });
    r.delete('/settings/ai/admin-key', async (req, reply) => {
      const s = req.session;
      if (!admin(s) || s.impersonator) return forbid(reply);
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET ai_admin_key_enc = NULL, ai_admin_meta = NULL, updated_at = now() WHERE id = ${s.tenantId}`;
        await tx`DELETE FROM ai_reconciliation WHERE tenant_id = ${s.tenantId}`;
        await audit(tx, s, 'ai.admin_key_removed', null);
      });
      return { ok: true };
    });
    r.post('/settings/ai/reconcile', async (req, reply) => {
      const s = req.session;
      if (!admin(s)) return forbid(reply);
      const { days } = z.object({ days: z.coerce.number().int().min(1).max(31).default(7) }).parse(req.body ?? {});
      try { return { ok: true, ...(await reconcile(s.tenantId, days)) }; }
      catch (e) {
        const msg = (e as Error).message;
        await sql`UPDATE tenants SET ai_admin_meta = coalesce(ai_admin_meta, '{}'::jsonb) || ${sql.json({ last_run_at: new Date().toISOString(), last_error: msg.slice(0, 300) } as never)} WHERE id = ${s.tenantId}`;
        return { ok: false, error: msg.slice(0, 300) };
      }
    });
    void decryptSecret;
  });
}
