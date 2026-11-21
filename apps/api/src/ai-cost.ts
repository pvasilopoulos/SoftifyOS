// AI cost control: price list per model, limits (organisation, role, user, feature, rate), the per-call ledger,
// 80% / 100% / spike notices, and reconciliation with the cost Anthropic actually bills (Admin API).
import Anthropic from '@anthropic-ai/sdk';
import { sql } from './db.js';
import type { Session } from './auth.js';
import { decryptSecret } from './registries.js';

export type Price = { input: number; output: number; cache_read: number; cache_write: number };
/** $ per million tokens (5-minute cache writes); the model reference, as of Nov 2026. Editable per organisation. */
export const DEFAULT_PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  'claude-opus-5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  'claude-fable-5-2': { input: 8, output: 40, cache_read: 0.2, cache_write: 10 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
};

export type Limit = { monthly: number | null; daily: number | null };
export type Limits = {
  warn_pct: number;                          // notify at this % of a limit
  rate_per_min: number | null;               // calls per user per minute
  roles: Record<string, Limit>;              // default per role
  users: Record<string, Limit>;              // per user (overrides the role)
  features: Record<string, number | null>;   // monthly $ per feature, whole organisation
};
export const DEFAULT_LIMITS: Limits = { warn_pct: 80, rate_per_min: 20, roles: {}, users: {}, features: {} };
export const withLimitDefaults = (l?: Partial<Limits> | null): Limits => ({
  ...DEFAULT_LIMITS, ...(l ?? {}), roles: l?.roles ?? {}, users: l?.users ?? {}, features: l?.features ?? {},
});

const month0 = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };
const monthKey = () => month0().toISOString().slice(0, 10);

// ---------------------------------------------------------------- prices
const priceCache = new Map<string, { at: number; rows: { model: string; valid_from: string; p: Price }[] }>();
export function invalidatePrices(T: string) { priceCache.delete(T); }
export async function priceFor(T: string, model: string, on = new Date()): Promise<Price> {
  let c = priceCache.get(T);
  if (!c || Date.now() - c.at > 60_000) {
    const rows = await sql`SELECT model, valid_from::text, input::float, output::float, cache_read::float, cache_write::float FROM ai_prices WHERE tenant_id = ${T} ORDER BY valid_from DESC`;
    c = { at: Date.now(), rows: rows.map((r) => ({ model: r.model as string, valid_from: r.valid_from as string, p: { input: r.input, output: r.output, cache_read: r.cache_read, cache_write: r.cache_write } as Price })) };
    priceCache.set(T, c);
  }
  const day = on.toISOString().slice(0, 10);
  // Dated aliases (claude-x-YYYYMMDD) price like their base id
  const base = model.replace(/-\d{8}$/, '');
  const own = c.rows.find((r) => (r.model === model || r.model === base) && r.valid_from <= day);
  if (own) return own.p;
  const key = Object.keys(DEFAULT_PRICES).sort((a, b) => b.length - a.length).find((k) => base === k || base.startsWith(`${k}-`));
  return DEFAULT_PRICES[key ?? 'claude-opus-5-5'];
}
export const costOf = (p: Price, u: { input: number; output: number; cache_read: number; cache_write: number }) =>
  (u.input * p.input + u.output * p.output + u.cache_read * p.cache_read + u.cache_write * p.cache_write) / 1e6;

// ---------------------------------------------------------------- limits
type Spend = { org: number; user: number; userDay: number; feature: number; lastMinute: number; extra: number; reserve: number };
async function spend(s: Session, feature: string): Promise<Spend> {
  const m0 = month0();
  const [r] = await sql`
    SELECT coalesce(sum(cost_usd), 0)::float AS org,
           coalesce(sum(cost_usd) FILTER (WHERE user_id = ${s.userId}), 0)::float AS "user",
           coalesce(sum(cost_usd) FILTER (WHERE user_id = ${s.userId} AND created_at >= date_trunc('day', now())), 0)::float AS "userDay",
           coalesce(sum(cost_usd) FILTER (WHERE feature = ${feature}), 0)::float AS feature,
           count(*) FILTER (WHERE user_id = ${s.userId} AND created_at > now() - interval '1 minute' AND status <> 'blocked')::int AS "lastMinute"
    FROM ai_usage WHERE tenant_id = ${s.tenantId} AND created_at >= ${m0}`;
  const [x] = await sql`SELECT coalesce(sum(amount_usd), 0)::float AS extra FROM ai_budget_requests
                        WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId} AND month = ${monthKey()} AND status = 'approved'`;
  // What a call of this feature usually costs: checked before calling, so one call cannot jump far over a limit
  const [a] = await sql`SELECT coalesce(avg(cost_usd), 0)::float AS avg FROM (SELECT cost_usd FROM ai_usage
                        WHERE tenant_id = ${s.tenantId} AND feature = ${feature} AND status = 'ok' ORDER BY created_at DESC LIMIT 20) z`;
  return { org: r.org, user: r.user, userDay: r.userDay, feature: r.feature, lastMinute: r.lastMinute, extra: x.extra, reserve: Math.max(0.005, a.avg || 0.02) };
}
export function userLimit(limits: Limits, s: Pick<Session, 'userId' | 'role'>): Limit {
  return limits.users[s.userId] ?? limits.roles[s.role] ?? { monthly: null, daily: null };
}

/** Budget / limit checks before a call. Returns a refusal code (and records the blocked call) or null. */
export async function checkLimits(s: Session, feature: string, orgBudget: number, limits: Limits): Promise<string | null> {
  const sp = await spend(s, feature);
  const lim = userLimit(limits, s);
  let code: string | null = null;
  if (limits.rate_per_min && sp.lastMinute >= limits.rate_per_min) code = 'rate_limited';
  else if (sp.org + sp.reserve > orgBudget) code = 'budget_exceeded';
  else if (lim.monthly !== null && sp.user + sp.reserve > lim.monthly + sp.extra) code = 'user_budget_exceeded';
  else if (lim.daily !== null && sp.userDay + sp.reserve > lim.daily) code = 'user_daily_exceeded';
  else if (limits.features[feature] != null && sp.feature + sp.reserve > (limits.features[feature] as number)) code = 'feature_budget_exceeded';
  if (code) {
    await sql`INSERT INTO ai_usage (tenant_id, user_id, feature, model, status, error) VALUES (${s.tenantId}, ${s.userId}, ${feature}, '-', 'blocked', ${code})`;
  }
  return code;
}

// ---------------------------------------------------------------- ledger
export type CallMeta = { requested_model?: string; request_id?: string | null; duration_ms?: number; entity?: 'customer' | 'conversation' | 'report' | 'offer'; entity_id?: string | null };
type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined | null;

export async function recordCall(s: Session, feature: string, model: string, u: Usage, meta: CallMeta = {}, status: 'ok' | 'refused' = 'ok') {
  const t = { input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cache_read: u?.cache_read_input_tokens ?? 0, cache_write: u?.cache_creation_input_tokens ?? 0 };
  const cost = costOf(await priceFor(s.tenantId, model), t);
  await sql`
    INSERT INTO ai_usage (tenant_id, user_id, feature, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd,
                          request_id, requested_model, status, duration_ms, entity, entity_id)
    VALUES (${s.tenantId}, ${s.userId}, ${feature}, ${model}, ${t.input}, ${t.output}, ${t.cache_read}, ${t.cache_write}, ${cost},
            ${meta.request_id ?? null}, ${meta.requested_model ?? null}, ${status}, ${meta.duration_ms ?? null}, ${meta.entity ?? null}, ${meta.entity_id ?? null})`;
  await afterSpend(s, cost).catch(() => {});
}

/** A failed call (API error, timeout): no tokens billed, but counted for the error rate. */
export async function recordError(s: Session, feature: string, e: unknown, meta: CallMeta = {}) {
  const code = e instanceof Anthropic.RateLimitError ? 'rate_limited' : e instanceof Anthropic.AuthenticationError ? 'auth'
    : e instanceof Anthropic.APIConnectionError ? 'connection' : e instanceof Anthropic.APIError ? `api_${e.status ?? 'error'}` : 'error';
  const rid = (e as { requestID?: string | null })?.requestID ?? null;
  await sql`INSERT INTO ai_usage (tenant_id, user_id, feature, model, status, error, request_id, requested_model, duration_ms, entity, entity_id)
            VALUES (${s.tenantId}, ${s.userId}, ${feature}, ${meta.requested_model ?? '-'}, 'error', ${`${code}: ${(e as Error)?.message ?? ''}`.slice(0, 300)},
                    ${rid}, ${meta.requested_model ?? null}, ${meta.duration_ms ?? null}, ${meta.entity ?? null}, ${meta.entity_id ?? null})`.catch(() => {});
}

// ---------------------------------------------------------------- notices: once per month / hour
async function once(T: string, key: string) {
  const r = await sql`INSERT INTO ai_notices (tenant_id, key, month) VALUES (${T}, ${key}, ${monthKey()}) ON CONFLICT DO NOTHING RETURNING key`;
  return r.length > 0;
}
async function notify(T: string, userIds: string[], title: string, body: string, url: string) {
  if (!userIds.length) return;
  await sql`INSERT INTO jobs (kind, payload) VALUES ('notify', ${sql.json({ tenantId: T, userIds, title, body, url } as never)})`;
}
async function admins(T: string) {
  return (await sql`SELECT m.user_id FROM memberships m LEFT JOIN roles r ON r.tenant_id = m.tenant_id AND r.key = m.role
                    WHERE m.tenant_id = ${T} AND (m.role = 'owner' OR 'settings.manage' = ANY(r.permissions))`).map((x) => x.user_id as string);
}
const usd = (n: number) => `${n.toFixed(2)} $`;

async function afterSpend(s: Session, cost: number) {
  if (cost <= 0) return;
  const [t] = await sql`SELECT ai_settings FROM tenants WHERE id = ${s.tenantId}`;
  const st = (t?.ai_settings ?? {}) as { monthly_budget_usd?: number; limits?: Partial<Limits> };
  const limits = withLimitDefaults(st.limits);
  const budget = st.monthly_budget_usd ?? 50;
  const sp = await spend(s, '-');
  const [me] = await sql`SELECT full_name FROM users WHERE id = ${s.userId}`;
  const who = (me?.full_name as string) ?? '';
  const warn = limits.warn_pct / 100;
  // Organisation budget
  for (const [pct, key] of [[1, 'org:100'], [warn, `org:${limits.warn_pct}`]] as const) {
    if (sp.org >= budget * pct && await once(s.tenantId, key)) {
      await notify(s.tenantId, await admins(s.tenantId), pct === 1 ? 'AI: εξαντλήθηκε το μηνιαίο όριο' : `AI: ${limits.warn_pct}% του μηνιαίου ορίου`,
        `Χρήση ${usd(sp.org)} από ${usd(budget)} αυτόν τον μήνα.`, '/settings?s=ai');
      break;
    }
  }
  // User limit
  const lim = userLimit(limits, s);
  if (lim.monthly !== null) {
    const cap = lim.monthly + sp.extra;
    for (const [pct, tag] of [[1, '100'], [warn, String(limits.warn_pct)]] as const) {
      if (sp.user >= cap * pct && await once(s.tenantId, `user:${s.userId}:${tag}:${cap}`)) {
        await notify(s.tenantId, [s.userId], pct === 1 ? 'AI: εξαντλήθηκε το όριό σας' : `AI: ${limits.warn_pct}% του ορίου σας`,
          `Χρήση ${usd(sp.user)} από ${usd(cap)} αυτόν τον μήνα.${pct === 1 ? ' Μπορείτε να ζητήσετε αύξηση.' : ''}`, '/settings?s=profile');
        if (pct === 1) await notify(s.tenantId, (await admins(s.tenantId)).filter((x) => x !== s.userId), `AI: ο/η ${who} έφτασε το όριο`, `Χρήση ${usd(sp.user)} από ${usd(cap)}.`, '/settings?s=ai');
        break;
      }
    }
  }
  // Spike: the last hour cost more than 5× the user's average hour of the last 14 days (and at least 1 $)
  const [h] = await sql`
    SELECT coalesce(sum(cost_usd) FILTER (WHERE created_at > now() - interval '1 hour'), 0)::float AS hour,
           coalesce(sum(cost_usd) FILTER (WHERE created_at <= now() - interval '1 hour'), 0)::float / (14 * 24) AS avg
    FROM ai_usage WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId} AND created_at > now() - interval '14 days'`;
  if (h.hour >= 1 && h.hour > 5 * h.avg && await once(s.tenantId, `spike:${s.userId}:${new Date().toISOString().slice(0, 13)}`)) {
    await notify(s.tenantId, await admins(s.tenantId), `AI: ασυνήθιστη χρήση από ${who}`, `${usd(h.hour)} την τελευταία ώρα (συνήθως ${usd(h.avg)}/ώρα).`, '/settings?s=ai');
  }
}

// ---------------------------------------------------------------- reconciliation with Anthropic (Admin API)
export async function adminClient(T: string) {
  const [t] = await sql`SELECT ai_admin_key_enc, ai_admin_meta FROM tenants WHERE id = ${T}`;
  const key = decryptSecret((t?.ai_admin_key_enc as string | null) ?? null);
  return key ? { client: new Anthropic({ apiKey: key }), meta: (t?.ai_admin_meta ?? {}) as { api_key_ids?: string[] } } : null;
}

/** API keys of the Anthropic organisation, and which one(s) this installation uses (by the last 4 characters). */
export async function anthropicKeys(client: Anthropic, last4s: string[]) {
  const keys: { id: string; name: string; hint: string; status: string; ours: boolean }[] = [];
  for await (const k of client.beta.organization.apiKeys.list({ limit: 100 })) {
    const hint = String((k as { partial_key_hint?: string | null }).partial_key_hint ?? '');
    keys.push({ id: k.id, name: k.name, hint, status: k.status, ours: last4s.some((l) => l && hint.endsWith(l)) });
  }
  return keys;
}

/** Billed cost per UTC day (last `days` complete days + today so far) next to our estimate. */
export async function reconcile(T: string, days = 7) {
  const ac = await adminClient(T);
  if (!ac) throw new Error('no_admin_key');
  const ids = ac.meta.api_key_ids ?? [];
  if (!ids.length) throw new Error('no_api_key_selected');
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const billed = new Map<string, { amount: number; list: number; requests: number; models: Record<string, number> }>();
  for await (const it of ac.client.beta.organization.analytics.cost.list({
    starting_at: start.toISOString(), ending_at: end.toISOString(), time_bucket_width: '1d', group_by: ['model'], api_key_ids: ids, limit: 1000,
  })) {
    const day = it.starting_at.slice(0, 10);
    const b = billed.get(day) ?? { amount: 0, list: 0, requests: 0, models: {} };
    const amount = Number(it.cost.amount) / 100, list = Number(it.cost.list_amount) / 100;   // cents → $
    b.amount += amount; b.list += list; b.requests += it.cost.requests ?? 0;
    const m = it.group.model ?? '—'; b.models[m] = (b.models[m] ?? 0) + amount;
    billed.set(day, b);
  }
  // Our side: this organisation, or every organisation on the shared server key when it has no key of its own
  const [own] = await sql`SELECT ai_key_enc IS NOT NULL AS own FROM tenants WHERE id = ${T}`;
  const est = await sql`
    SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, sum(cost_usd)::float AS usd FROM ai_usage
    WHERE created_at >= ${start} AND created_at < ${end}
      AND ${own?.own ? sql`tenant_id = ${T}` : sql`tenant_id IN (SELECT id FROM tenants WHERE ai_key_enc IS NULL)`}
    GROUP BY 1`;
  const estBy = new Map(est.map((r) => [r.day as string, r.usd as number]));
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 864e5)) {
    const day = d.toISOString().slice(0, 10);
    const b = billed.get(day);
    await sql`INSERT INTO ai_reconciliation (tenant_id, day, estimated_usd, billed_usd, list_usd, requests, by_model, fetched_at)
              VALUES (${T}, ${day}, ${estBy.get(day) ?? 0}, ${b ? b.amount : null}, ${b ? b.list : null}, ${b ? b.requests : null}, ${sql.json((b?.models ?? {}) as never)}, now())
              ON CONFLICT (tenant_id, day) DO UPDATE SET estimated_usd = EXCLUDED.estimated_usd, billed_usd = EXCLUDED.billed_usd, list_usd = EXCLUDED.list_usd,
                requests = EXCLUDED.requests, by_model = EXCLUDED.by_model, fetched_at = now()`;
  }
  await sql`UPDATE tenants SET ai_admin_meta = coalesce(ai_admin_meta, '{}'::jsonb) || ${sql.json({ last_run_at: new Date().toISOString(), last_error: null } as never)} WHERE id = ${T}`;
  return { days: billed.size, shared_key: !own?.own };
}

/** Worker: once a day for every organisation with an Admin API key. */
export async function reconcileDue() {
  const due = await sql`SELECT id FROM tenants WHERE ai_admin_key_enc IS NOT NULL
                        AND coalesce((ai_admin_meta->>'last_run_at')::timestamptz, 'epoch') < now() - interval '20 hours'`;
  for (const t of due) {
    try { await reconcile(t.id as string); }
    catch (e) {
      await sql`UPDATE tenants SET ai_admin_meta = coalesce(ai_admin_meta, '{}'::jsonb) || ${sql.json({ last_run_at: new Date().toISOString(), last_error: (e as Error).message.slice(0, 300) } as never)} WHERE id = ${t.id as string}`;
    }
  }
}
