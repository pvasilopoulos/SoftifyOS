// Settings → Integrations (admin only): API keys, webhooks, request log, usage statistics.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { decodeCursor, encodeCursor, sql, withTenant } from '../db.js';
import { can, requireAuth } from '../auth.js';
import { audit } from './settings.js';
import { forgetApiKey, validIpEntry } from './integration.js';
import { deliver, forgetWebhooks, newWebhookSecret, WEBHOOK_EVENTS } from '../webhooks.js';

const idParam = z.object({ id: z.string().uuid() });
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });

const level = z.enum(['none', 'read', 'write']);
const permissions = z.object({ customers: level, branches: level, spaces: level, lists: level.default('none'), activities: level.default('none'), documents: level.default('none') })
  .refine((p) => Object.values(p).some((v) => v !== 'none'), { message: 'no_permissions' });
const ipList = z.array(z.string().trim().min(1).max(64).refine(validIpEntry, { message: 'invalid_ip' })).max(50);
const keyBody = z.object({
  name: z.string().trim().min(2).max(80),
  permissions,
  expires_at: z.coerce.date().nullable().default(null),
  allowed_ips: ipList.default([]),
});
const scopeOf = (p: z.infer<typeof permissions>) => (Object.values(p).includes('write') ? 'write' : 'read');

const eventList = z.array(z.string().refine((e) => e === '*' || (WEBHOOK_EVENTS as readonly string[]).includes(e) || /^(customer|branch|space|offer)\.\*$/.test(e))).min(1).max(40);
const webhookBody = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(500).refine((u) => /^https?:\/\//.test(u), { message: 'http_only' }),
  events: eventList,
  active: z.boolean().default(true),
});

const RANGES = { '24h': { span: '24 hours', bucket: 'hour', n: 24 }, '7d': { span: '7 days', bucket: 'day', n: 7 }, '30d': { span: '30 days', bucket: 'day', n: 30 } } as const;

export default async function integrationSettingsRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    r.addHook('preHandler', async (req, reply) => { if (!can(req.session, 'integrations.manage')) return forbid(reply); });

    // ======================= API keys =======================
    r.get('/settings/api-keys', async (req) => {
      const T = req.session.tenantId;
      return withTenant(T, (tx) => tx`
        SELECT k.id, k.name, k.prefix, k.permissions, k.expires_at, k.allowed_ips, k.rotated_from, k.created_at, k.last_used_at, k.requests, k.revoked_at,
               u.full_name AS created_by_name, rf.name AS rotated_from_name, s.req_24h, s.err_24h
        FROM api_keys k
        LEFT JOIN users u ON u.id = k.created_by
        LEFT JOIN api_keys rf ON rf.id = k.rotated_from
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS req_24h, count(*) FILTER (WHERE a.status >= 400)::int AS err_24h
          FROM api_requests a WHERE a.key_id = k.id AND a.created_at > now() - interval '24 hours') s ON true
        WHERE k.tenant_id = ${T}
        ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC`);
    });

    r.post('/settings/api-keys', async (req, reply) => {
      const b = keyBody.parse(req.body);
      if (b.expires_at && b.expires_at <= new Date()) return reply.code(400).send({ error: 'expiry_in_past' });
      const s = req.session;
      const prefix = randomBytes(6).toString('hex');
      const secret = randomBytes(24).toString('base64url');
      const row = await withTenant(s.tenantId, async (tx) => {
        const [k] = await tx`
          INSERT INTO api_keys (tenant_id, name, prefix, secret_hash, scope, permissions, expires_at, allowed_ips, created_by)
          VALUES (${s.tenantId}, ${b.name}, ${prefix}, ${sha256(secret)}, ${scopeOf(b.permissions)}, ${tx.json(b.permissions)},
                  ${b.expires_at}, ${b.allowed_ips}, ${s.userId}) RETURNING id`;
        await audit(tx, s, 'apikey.create', b.name, { prefix, permissions: b.permissions, expires_at: b.expires_at, ips: b.allowed_ips.length });
        return k;
      });
      // The full key is returned only once; only its hash is stored
      return reply.code(201).send({ id: row.id, key: `sos_${prefix}_${secret}`, prefix });
    });

    r.put('/settings/api-keys/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const b = keyBody.parse(req.body);
      const s = req.session;
      const k = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`
          UPDATE api_keys SET name = ${b.name}, permissions = ${tx.json(b.permissions)}, scope = ${scopeOf(b.permissions)},
                 expires_at = ${b.expires_at}, allowed_ips = ${b.allowed_ips}
          WHERE id = ${id} AND revoked_at IS NULL RETURNING prefix`;
        if (x) await audit(tx, s, 'apikey.update', b.name, { prefix: x.prefix, permissions: b.permissions, expires_at: b.expires_at, ips: b.allowed_ips.length });
        return x;
      });
      if (!k) return reply.code(404).send({ error: 'not_found' });
      forgetApiKey(k.prefix); // new rules apply immediately
      return { ok: true };
    });

    // New secret with the same settings; the old key keeps working for the grace period (zero-downtime switch)
    r.post('/settings/api-keys/:id/rotate', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { grace_hours } = z.object({ grace_hours: z.number().int().min(0).max(168).default(24) }).parse(req.body ?? {});
      const s = req.session;
      const prefix = randomBytes(6).toString('hex');
      const secret = randomBytes(24).toString('base64url');
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM api_keys WHERE id = ${id} AND revoked_at IS NULL FOR UPDATE`;
        if (!old) return null;
        const [k] = await tx`
          INSERT INTO api_keys (tenant_id, name, prefix, secret_hash, scope, permissions, expires_at, allowed_ips, rotated_from, created_by)
          VALUES (${s.tenantId}, ${old.name}, ${prefix}, ${sha256(secret)}, ${old.scope}, ${tx.json(old.permissions)},
                  ${old.expires_at}, ${old.allowed_ips}, ${old.id}, ${s.userId}) RETURNING id`;
        if (grace_hours === 0) await tx`UPDATE api_keys SET revoked_at = now() WHERE id = ${old.id}`;
        else await tx`UPDATE api_keys SET expires_at = LEAST(coalesce(expires_at, 'infinity'), now() + (${grace_hours} * interval '1 hour')) WHERE id = ${old.id}`;
        await audit(tx, s, 'apikey.rotate', old.name, { old_prefix: old.prefix, prefix, grace_hours });
        return { id: k.id, oldPrefix: old.prefix as string };
      });
      if (!res) return reply.code(404).send({ error: 'not_found' });
      forgetApiKey(res.oldPrefix);
      return reply.code(201).send({ id: res.id, key: `sos_${prefix}_${secret}`, prefix });
    });

    // Revoke (stops working immediately; history kept)
    r.delete('/settings/api-keys/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const k = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL RETURNING name, prefix`;
        if (x) await audit(tx, s, 'apikey.revoke', x.name, { prefix: x.prefix });
        return x;
      });
      if (!k) return reply.code(404).send({ error: 'not_found' });
      forgetApiKey(k.prefix);
      return { ok: true };
    });

    // Permanent delete (the request log keeps its rows without the key)
    r.delete('/settings/api-keys/:id/permanent', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const k = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`DELETE FROM api_keys WHERE id = ${id} RETURNING name, prefix`;
        if (x) await audit(tx, s, 'apikey.delete', x.name, { prefix: x.prefix });
        return x;
      });
      if (!k) return reply.code(404).send({ error: 'not_found' });
      forgetApiKey(k.prefix);
      return { ok: true };
    });

    // ======================= Usage statistics =======================
    r.get('/settings/integrations/stats', async (req) => {
      const { range } = z.object({ range: z.enum(['24h', '7d', '30d']).default('24h') }).parse(req.query);
      const R = RANGES[range];
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => {
        const since = tx`now() - ${R.span}::interval`;
        const [totals] = await tx`
          SELECT count(*)::int AS requests, count(*) FILTER (WHERE status >= 400)::int AS errors,
                 coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95_ms,
                 coalesce(avg(duration_ms), 0)::int AS avg_ms,
                 coalesce(sum(created), 0)::int AS created, coalesce(sum(updated), 0)::int AS updated, coalesce(sum(failed), 0)::int AS failed
          FROM api_requests WHERE tenant_id = ${T} AND created_at > ${since}`;
        const series = await tx`
          SELECT g.t AS at, coalesce(a.requests, 0)::int AS requests, coalesce(a.errors, 0)::int AS errors
          FROM generate_series(date_trunc(${R.bucket}, now()) - ((${R.n} - 1) || ' ' || ${R.bucket})::interval, date_trunc(${R.bucket}, now()), ('1 ' || ${R.bucket})::interval) g(t)
          LEFT JOIN (
            SELECT date_trunc(${R.bucket}, created_at) AS t, count(*) AS requests, count(*) FILTER (WHERE status >= 400) AS errors
            FROM api_requests WHERE tenant_id = ${T} AND created_at > ${since} GROUP BY 1) a ON a.t = g.t
          ORDER BY g.t`;
        const topErrors = await tx`
          SELECT coalesce(error, CASE WHEN failed > 0 THEN 'item_errors' ELSE 'http_' || status END) AS error, count(*)::int AS n FROM api_requests
          WHERE tenant_id = ${T} AND created_at > ${since} AND (status >= 400 OR failed > 0)
          GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
        const byKey = await tx`
          SELECT a.key_id, k.name, count(*)::int AS requests, count(*) FILTER (WHERE a.status >= 400)::int AS errors
          FROM api_requests a LEFT JOIN api_keys k ON k.id = a.key_id
          WHERE a.tenant_id = ${T} AND a.created_at > ${since} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`;
        const [hooks] = await tx`
          SELECT count(*) FILTER (WHERE status = 'success')::int AS success, count(*) FILTER (WHERE status = 'failed')::int AS failed,
                 count(*) FILTER (WHERE status = 'pending')::int AS pending
          FROM webhook_deliveries WHERE tenant_id = ${T} AND created_at > ${since}`;
        return { range, totals, series, topErrors, byKey, webhooks: hooks };
      });
    });

    // ======================= Request log =======================
    r.get('/settings/integrations/requests', async (req) => {
      const q = z.object({
        cursor: z.string().optional(),
        status: z.enum(['all', 'errors', 'success']).default('all'),
        key_id: z.string().uuid().optional(),
        method: z.enum(['GET', 'PUT', 'POST', 'DELETE']).optional(),
        q: z.string().trim().max(100).optional(),
      }).parse(req.query);
      const cur = decodeCursor<[string, string]>(q.cursor);
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => {
        const rows = await tx`
          SELECT a.id, a.method, a.path, a.status, a.duration_ms, a.ip, a.items, a.created, a.updated, a.failed, a.error, a.created_at,
                 a.key_id, k.name AS key_name
          FROM api_requests a LEFT JOIN api_keys k ON k.id = a.key_id
          WHERE a.tenant_id = ${T}
            ${q.status === 'errors' ? tx`AND (a.status >= 400 OR a.failed > 0)` : q.status === 'success' ? tx`AND a.status < 400 AND coalesce(a.failed, 0) = 0` : tx``}
            ${q.key_id ? tx`AND a.key_id = ${q.key_id}` : tx``}
            ${q.method ? tx`AND a.method = ${q.method}` : tx``}
            ${q.q ? tx`AND a.path ILIKE ${'%' + q.q.replace(/[%_\\]/g, '\\$&') + '%'}` : tx``}
            ${cur ? tx`AND (a.created_at, a.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
          ORDER BY a.created_at DESC, a.id DESC LIMIT 51`;
        const more = rows.length > 50;
        const items = more ? rows.slice(0, 50) : rows;
        const l = items.at(-1);
        return { items, nextCursor: more && l ? encodeCursor([l.created_at, l.id]) : null };
      });
    });

    r.get('/settings/integrations/requests/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const T = req.session.tenantId;
      const [row] = await withTenant(T, (tx) => tx`
        SELECT a.*, k.name AS key_name, k.prefix AS key_prefix FROM api_requests a LEFT JOIN api_keys k ON k.id = a.key_id WHERE a.id = ${id}`);
      return row ?? reply.code(404).send({ error: 'not_found' });
    });

    // ======================= Webhooks =======================
    r.get('/settings/webhooks', async (req) => {
      const T = req.session.tenantId;
      const hooks = await withTenant(T, (tx) => tx`
        SELECT w.id, w.name, w.url, w.events, w.active, w.created_at, w.last_success_at, w.last_failure_at, w.consecutive_failures,
               u.full_name AS created_by_name, s.sent_24h, s.failed_24h, s.pending
        FROM webhooks w
        LEFT JOIN users u ON u.id = w.created_by
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE d.status = 'success')::int AS sent_24h, count(*) FILTER (WHERE d.status = 'failed')::int AS failed_24h,
                 count(*) FILTER (WHERE d.status = 'pending')::int AS pending
          FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.created_at > now() - interval '24 hours') s ON true
        WHERE w.tenant_id = ${T} ORDER BY w.created_at DESC`);
      return { events: WEBHOOK_EVENTS, items: hooks };
    });

    r.post('/settings/webhooks', async (req, reply) => {
      const b = webhookBody.parse(req.body);
      const s = req.session;
      const secret = newWebhookSecret();
      const row = await withTenant(s.tenantId, async (tx) => {
        const [w] = await tx`
          INSERT INTO webhooks (tenant_id, name, url, events, secret, active, created_by)
          VALUES (${s.tenantId}, ${b.name}, ${b.url}, ${b.events}, ${secret}, ${b.active}, ${s.userId}) RETURNING id`;
        await audit(tx, s, 'webhook.create', b.name, { url: b.url, events: b.events });
        return w;
      });
      forgetWebhooks(s.tenantId);
      return reply.code(201).send({ id: row.id, secret });
    });

    r.put('/settings/webhooks/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const b = webhookBody.parse(req.body);
      const s = req.session;
      const ok = await withTenant(s.tenantId, async (tx) => {
        const [w] = await tx`
          UPDATE webhooks SET name = ${b.name}, url = ${b.url}, events = ${b.events}, active = ${b.active},
                 consecutive_failures = CASE WHEN ${b.active} AND NOT active THEN 0 ELSE consecutive_failures END
          WHERE id = ${id} RETURNING id`;
        if (w) await audit(tx, s, 'webhook.update', b.name, { url: b.url, events: b.events, active: b.active });
        return !!w;
      });
      forgetWebhooks(s.tenantId);
      return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
    });

    r.delete('/settings/webhooks/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const ok = await withTenant(s.tenantId, async (tx) => {
        const [w] = await tx`DELETE FROM webhooks WHERE id = ${id} RETURNING name, url`;
        if (w) await audit(tx, s, 'webhook.delete', w.name, { url: w.url });
        return !!w;
      });
      forgetWebhooks(s.tenantId);
      return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
    });

    r.get('/settings/webhooks/:id/secret', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const [w] = await withTenant(s.tenantId, async (tx) => {
        const rows = await tx`SELECT name, secret FROM webhooks WHERE id = ${id}`;
        if (rows[0]) await audit(tx, s, 'webhook.reveal_secret', rows[0].name);
        return rows;
      });
      return w ? { secret: w.secret } : reply.code(404).send({ error: 'not_found' });
    });

    r.post('/settings/webhooks/:id/rotate-secret', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const secret = newWebhookSecret();
      const ok = await withTenant(s.tenantId, async (tx) => {
        const [w] = await tx`UPDATE webhooks SET secret = ${secret} WHERE id = ${id} RETURNING name`;
        if (w) await audit(tx, s, 'webhook.rotate_secret', w.name);
        return !!w;
      });
      return ok ? { secret } : reply.code(404).send({ error: 'not_found' });
    });

    // Sends a "ping" right now and returns the endpoint's answer
    r.post('/settings/webhooks/:id/test', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const d = await withTenant(s.tenantId, async (tx) => {
        const [w] = await tx`SELECT id FROM webhooks WHERE id = ${id}`;
        if (!w) return null;
        const [x] = await tx`
          INSERT INTO webhook_deliveries (tenant_id, webhook_id, event, payload)
          VALUES (${s.tenantId}, ${id}, 'ping', ${tx.json({ event: 'ping', occurred_at: new Date().toISOString(), source: { type: 'user', user_id: s.userId }, data: { message: 'SoftifyOS webhook test' } })})
          RETURNING id`;
        return x;
      });
      if (!d) return reply.code(404).send({ error: 'not_found' });
      const r2 = await deliver(d.id);
      return r2 ? { ok: r2.result.ok, status: r2.result.status, ms: r2.result.ms, error: r2.result.error, body: r2.result.body } : { ok: false };
    });

    r.get('/settings/webhooks/:id/deliveries', async (req) => {
      const { id } = idParam.parse(req.params);
      const q = z.object({ cursor: z.string().optional(), status: z.enum(['all', 'success', 'failed', 'pending']).default('all') }).parse(req.query);
      const cur = decodeCursor<[string, string]>(q.cursor);
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => {
        const rows = await tx`
          SELECT id, event, status, attempts, response_code, response_ms, error, created_at, delivered_at, payload
          FROM webhook_deliveries WHERE webhook_id = ${id}
            ${q.status !== 'all' ? tx`AND status = ${q.status}` : tx``}
            ${cur ? tx`AND (created_at, id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
          ORDER BY created_at DESC, id DESC LIMIT 31`;
        const more = rows.length > 30;
        const items = more ? rows.slice(0, 30) : rows;
        const l = items.at(-1);
        return { items, nextCursor: more && l ? encodeCursor([l.created_at, l.id]) : null };
      });
    });

    // Send a delivery again (queued; retries apply)
    r.post('/settings/webhook-deliveries/:id/redeliver', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const T = req.session.tenantId;
      const ok = await withTenant(T, async (tx) => {
        const [d] = await tx`SELECT id FROM webhook_deliveries WHERE id = ${id}`;
        if (!d) return false;
        return true;
      });
      if (!ok) return reply.code(404).send({ error: 'not_found' });
      // Owner connection: reset the delivery and queue it
      await sql.begin(async (tx) => {
        await tx`UPDATE webhook_deliveries SET status = 'pending', attempts = 0, error = NULL WHERE id = ${id} AND tenant_id = ${T}`;
        await tx`INSERT INTO jobs (kind, payload) VALUES ('webhook', ${tx.json({ deliveryId: id })})`;
      });
      return { ok: true };
    });
  });
}
