// Outgoing webhooks: SoftifyOS → your systems.
//
// emit*()   runs inside the business transaction: it writes one delivery row per matching webhook and queues
//           a job, so an event is sent only if the change was committed (transactional outbox).
// deliver() is called by the worker (and by the "test" button): signed POST, timeout, result recorded.
//
// Signature header:  X-Softify-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { env } from './env.js';
import { sql, type Tx } from './db.js';

export const WEBHOOK_EVENTS = [
  'customer.created', 'customer.updated', 'customer.archived', 'customer.deleted',
  'branch.created', 'branch.updated', 'branch.deleted',
  'space.created', 'space.updated', 'space.deleted',
  'offer.created', 'offer.submitted', 'offer.approved', 'offer.sent', 'offer.accepted', 'offer.rejected',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type EventSource = { type: 'user'; user_id: string } | { type: 'api'; key: string } | { type: 'customer' } | { type: 'system' };
export type OutEvent = { event: WebhookEvent; data: Record<string, unknown> };

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

// Most tenants have no webhooks: remember that briefly so writes don't pay for the lookup.
const active = new Map<string, { has: boolean; at: number }>();
export function forgetWebhooks(tenantId: string) { active.delete(tenantId); }
async function hasWebhooks(tx: Tx, tenantId: string) {
  const c = active.get(tenantId);
  if (c && Date.now() - c.at < 15_000) return c.has;
  const [r] = await tx`SELECT EXISTS (SELECT 1 FROM webhooks WHERE tenant_id = ${tenantId} AND active) AS has`;
  active.set(tenantId, { has: r.has, at: Date.now() });
  return r.has as boolean;
}

/** Queues deliveries for every active webhook subscribed to these events (exact, "entity.*" or "*"). */
export async function emitEvents(tx: Tx, tenantId: string, events: OutEvent[], source: EventSource) {
  if (!events.length || !(await hasWebhooks(tx, tenantId))) return;
  await tx`
    WITH ev AS (
      SELECT e->>'event' AS event, e->'data' AS data FROM jsonb_array_elements(${tx.json(events as never)}::jsonb) e),
    d AS (
      INSERT INTO webhook_deliveries (tenant_id, webhook_id, event, payload)
      SELECT ${tenantId}, w.id, ev.event,
             jsonb_build_object('event', ev.event, 'occurred_at', now(), 'source', ${tx.json(source as never)}::jsonb, 'data', ev.data)
      FROM ev JOIN webhooks w ON w.tenant_id = ${tenantId} AND w.active
       AND (ev.event = ANY (w.events) OR '*' = ANY (w.events) OR split_part(ev.event, '.', 1) || '.*' = ANY (w.events))
      RETURNING id)
    INSERT INTO jobs (kind, payload) SELECT 'webhook', jsonb_build_object('deliveryId', id) FROM d`;
}

type Entity = 'customer' | 'branch' | 'space';
/** Builds the event payload from the current row (id, your external_id, name, parent refs). */
export async function emitEntityEvents(tx: Tx, tenantId: string, entity: Entity, action: 'created' | 'updated' | 'archived', ids: string[], source: EventSource) {
  if (!ids.length || !(await hasWebhooks(tx, tenantId))) return;
  const rows = entity === 'customer'
    ? await tx`SELECT id, external_id, code, name, status, archived_at FROM customers WHERE id = ANY(${ids}::uuid[])`
    : entity === 'branch'
      ? await tx`SELECT b.id, b.external_id, b.name, b.status, b.customer_id, c.external_id AS customer_external_id
                 FROM branches b JOIN customers c ON c.id = b.customer_id WHERE b.id = ANY(${ids}::uuid[])`
      : await tx`SELECT s.id, s.external_id, s.name, s.kind, s.branch_id, b.external_id AS branch_external_id
                 FROM spaces s JOIN branches b ON b.id = s.branch_id WHERE s.id = ANY(${ids}::uuid[])`;
  await emitEvents(tx, tenantId, rows.map((r) => ({ event: `${entity}.${action}` as WebhookEvent, data: { ...r } })), source);
}

// ---------------------------------------------------------------- delivery
const TIMEOUT_MS = 10_000;
/** Retry schedule after a failed attempt: 30s, 2m, 10m, 30m, 2h, 6h, 12h → gives up after ~21h. */
export const RETRY_DELAYS_S = [30, 120, 600, 1800, 7200, 21600, 43200];
const AUTO_DISABLE_AFTER = 50; // consecutive failed deliveries

// In production webhooks may not target the server itself or the private network (SSRF).
const privateNets = new BlockList();
for (const [net, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['0.0.0.0', 8], ['100.64.0.0', 10]] as const) {
  privateNets.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [['::1', 128], ['fc00::', 7], ['fe80::', 10], ['::', 128]] as const) privateNets.addSubnet(net, bits, 'ipv6');
const allowPrivate = !env.isProd || process.env.WEBHOOKS_ALLOW_PRIVATE === 'true';

async function assertPublicHost(url: URL) {
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const a of addrs) {
    const mapped = a.address.startsWith('::ffff:') ? a.address.slice(7) : a.address;
    if (privateNets.check(mapped, isIP(mapped) === 6 ? 'ipv6' : 'ipv4')) throw new Error('blocked_private_address');
  }
}

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export type DeliveryResult = { ok: boolean; status: number | null; ms: number; error: string | null; body: string | null };

async function post(url: string, secret: string, deliveryId: string, event: string, body: string): Promise<DeliveryResult> {
  const t0 = Date.now();
  try {
    const u = new URL(url);
    await assertPublicHost(u);
    const res = await fetch(u, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json', 'user-agent': 'SoftifyOS-Webhooks/1.0',
        'x-softify-event': event, 'x-softify-delivery': deliveryId, 'x-softify-signature': sign(secret, body),
      },
      body,
    });
    const text = (await res.text().catch(() => '')).slice(0, 500);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, ms: Date.now() - t0, error: res.ok ? null : `HTTP ${res.status}`, body: text || null };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const msg = err.name === 'TimeoutError' ? 'timeout' : err.cause?.code ?? err.message;
    return { ok: false, status: null, ms: Date.now() - t0, error: msg, body: null };
  }
}

/** Sends one delivery (owner connection, cross-tenant). Returns when to retry, or null when finished. */
export async function deliver(deliveryId: string): Promise<{ result: DeliveryResult; retryIn: number | null } | null> {
  const [d] = await sql`
    SELECT d.id, d.event, d.payload, d.attempts, d.status, w.id AS webhook_id, w.url, w.secret, w.active
    FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = ${deliveryId}`;
  if (!d || d.status === 'success') return null;
  if (!d.active && d.event !== 'ping') {
    await sql`UPDATE webhook_deliveries SET status = 'failed', error = 'webhook_disabled' WHERE id = ${d.id}`;
    return null;
  }
  const body = JSON.stringify({ id: d.id, ...d.payload });
  const result = await post(d.url, d.secret, d.id, d.event, body);
  const attempts = d.attempts + 1;
  const retryIn = !result.ok && d.event !== 'ping' && attempts <= RETRY_DELAYS_S.length ? RETRY_DELAYS_S[attempts - 1] : null;
  const status = result.ok ? 'success' : retryIn ? 'pending' : 'failed';
  await sql`
    UPDATE webhook_deliveries SET attempts = ${attempts}, status = ${status}, response_code = ${result.status},
      response_ms = ${result.ms}, error = ${result.error}, delivered_at = ${result.ok ? sql`now()` : null}
    WHERE id = ${d.id}`;
  if (result.ok) {
    await sql`UPDATE webhooks SET last_success_at = now(), consecutive_failures = 0 WHERE id = ${d.webhook_id}`;
  } else if (!retryIn) {
    // Final failure: count it, and switch the endpoint off if it keeps failing
    await sql`UPDATE webhooks SET last_failure_at = now(), consecutive_failures = consecutive_failures + 1,
                active = CASE WHEN consecutive_failures + 1 >= ${AUTO_DISABLE_AFTER} THEN false ELSE active END
              WHERE id = ${d.webhook_id}`;
  } else {
    await sql`UPDATE webhooks SET last_failure_at = now() WHERE id = ${d.webhook_id}`;
  }
  return { result, retryIn };
}
