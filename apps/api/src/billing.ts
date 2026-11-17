// SaaS plans, limits and Stripe billing.
// Billing is active only when STRIPE_SECRET_KEY is set (or BILLING_ENFORCE=true for testing limits);
// a self-hosted single-company installation without it has no limits at all.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from './db.js';
import { env } from './env.js';

export const PLAN_KEYS = ['trial', 'starter', 'business', 'enterprise'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type Feature = 'ai' | 'api' | 'calendar';
export type Plan = { users: number | null; storage_gb: number; features: Record<Feature, boolean>; month: number | null; year: number | null };

/** Prices in EUR (VAT excluded). Yearly = 10 months. Stripe price ids come from STRIPE_PRICE_<PLAN>_<MONTH|YEAR>. */
export const PLANS: Record<PlanKey, Plan> = {
  trial:      { users: 5,    storage_gb: 5,    features: { ai: true, api: true, calendar: true },  month: null, year: null },
  starter:    { users: 3,    storage_gb: 10,   features: { ai: false, api: false, calendar: true }, month: 29,  year: 290 },
  business:   { users: 15,   storage_gb: 100,  features: { ai: true, api: true, calendar: true },  month: 99,  year: 990 },
  enterprise: { users: null, storage_gb: 1000, features: { ai: true, api: true, calendar: true },  month: 299, year: 2990 },
};
export const PAID: PlanKey[] = ['starter', 'business', 'enterprise'];
export const GRACE_DAYS = 7;

export const billingEnabled = () => !!env.stripe.secretKey || env.stripe.enforce;
export const priceId = (plan: PlanKey, interval: 'month' | 'year') => env.stripe.prices[`${plan}_${interval}`] ?? '';
function planFromPrice(id: string): { plan: PlanKey; interval: 'month' | 'year' } | null {
  for (const [k, v] of Object.entries(env.stripe.prices)) if (v && v === id) { const [plan, interval] = k.split('_'); return { plan: plan as PlanKey, interval: interval as 'month' | 'year' }; }
  return null;
}

export type TenantPlan = {
  plan: PlanKey; status: 'trialing' | 'active' | 'past_due' | 'canceled'; interval: 'month' | 'year' | null;
  trial_ends_at: Date | null; current_period_end: Date | null; cancel_at_period_end: boolean; past_due_since: Date | null;
  stripe_customer_id: string | null; limits: Plan; active: boolean; reason: string | null; enforced: boolean;
};

const cache = new Map<string, { at: number; v: TenantPlan }>();
export const invalidatePlan = (tenantId: string) => cache.delete(tenantId);

/** Plan, limits and whether the organisation may write (cached 30 s). */
export async function planOf(tenantId: string): Promise<TenantPlan> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const [t] = await sql`
    SELECT plan, plan_status, billing_interval, trial_ends_at, current_period_end, cancel_at_period_end, past_due_since, stripe_customer_id
    FROM tenants WHERE id = ${tenantId}`;
  const enforced = billingEnabled();
  const plan = (t?.plan ?? 'enterprise') as PlanKey;
  const status = (t?.plan_status ?? 'active') as TenantPlan['status'];
  let reason: string | null = null;
  if (enforced) {
    if (status === 'trialing' && t.trial_ends_at && new Date(t.trial_ends_at) < new Date()) reason = 'trial_ended';
    else if (status === 'canceled') reason = 'canceled';
    else if (status === 'past_due' && t.past_due_since && Date.now() - new Date(t.past_due_since).getTime() > GRACE_DAYS * 864e5) reason = 'past_due';
  }
  const v: TenantPlan = {
    plan, status, interval: t?.billing_interval ?? null, trial_ends_at: t?.trial_ends_at ?? null, current_period_end: t?.current_period_end ?? null,
    cancel_at_period_end: !!t?.cancel_at_period_end, past_due_since: t?.past_due_since ?? null, stripe_customer_id: t?.stripe_customer_id ?? null,
    limits: enforced ? PLANS[plan] : { users: null, storage_gb: PLANS.enterprise.storage_gb, features: { ai: true, api: true, calendar: true }, month: null, year: null },
    active: !reason, reason, enforced,
  };
  cache.set(tenantId, { at: Date.now(), v });
  return v;
}

/** Why the plan does not allow this, or null. */
export async function planBlocks(tenantId: string, feature: Feature) {
  const p = await planOf(tenantId);
  if (!p.active) return 'subscription_inactive';
  return p.limits.features[feature] ? null : 'plan_feature';
}

// ------------------------------------------------------------------ Stripe (REST, form-encoded)
function form(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${env.stripe.secretKey}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? form(body) : undefined,
  });
  const j = (await r.json()) as T & { error?: { message: string } };
  if (!r.ok) throw new Error(`stripe: ${j.error?.message ?? r.status}`);
  return j;
}

/** Stripe-Signature check (HMAC-SHA256 of "t.payload", 5 minute tolerance). */
export function verifyStripeSignature(raw: Buffer, header: string | undefined) {
  if (!header || !env.stripe.webhookSecret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac('sha256', env.stripe.webhookSecret).update(`${t}.`).update(raw).digest();
  return header.split(',').filter((p) => p.startsWith('v1=')).some((p) => {
    const got = Buffer.from(p.slice(3), 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

type Sub = {
  id: string; customer: string; status: string; cancel_at_period_end: boolean; current_period_end?: number; metadata?: Record<string, string>;
  items: { data: { price: { id: string }; current_period_end?: number }[] };
};

/** Copies a Stripe subscription onto the organisation (plan, status, period, storage quota). */
export async function applySubscription(sub: Sub, tenantHint?: string | null) {
  const tenantId = tenantHint ?? sub.metadata?.tenant_id
    ?? (await sql`SELECT id FROM tenants WHERE stripe_customer_id = ${sub.customer}`)[0]?.id;
  if (!tenantId) return null;
  const price = planFromPrice(sub.items.data[0]?.price.id ?? '');
  const status = ({ active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled', incomplete_expired: 'canceled', paused: 'canceled' } as Record<string, TenantPlan['status']>)[sub.status];
  if (!status) return tenantId;   // incomplete: wait for the next event
  const periodEnd = sub.current_period_end ?? sub.items.data[0]?.current_period_end;
  const plan = status === 'canceled' ? null : price?.plan ?? null;
  await sql`
    UPDATE tenants SET
      plan = coalesce(${plan}, plan), plan_status = ${status}, billing_interval = coalesce(${price?.interval ?? null}, billing_interval),
      current_period_end = ${periodEnd ? new Date(periodEnd * 1000) : null}, cancel_at_period_end = ${sub.cancel_at_period_end},
      past_due_since = CASE WHEN ${status} = 'past_due' THEN coalesce(past_due_since, now()) ELSE NULL END,
      trial_ends_at = CASE WHEN ${status} = 'active' THEN NULL ELSE trial_ends_at END,
      stripe_customer_id = ${sub.customer}, stripe_subscription_id = ${status === 'canceled' ? null : sub.id},
      storage_quota_bytes = CASE WHEN ${plan}::text IS NULL THEN storage_quota_bytes ELSE ${plan ? PLANS[plan].storage_gb : 0}::bigint * 1073741824 END
    WHERE id = ${tenantId}`;
  invalidatePlan(tenantId);
  return tenantId;
}

/** What the app shell needs for the trial / payment banner. */
export async function billingSummary(tenantId: string) {
  const p = await planOf(tenantId);
  if (!p.enforced) return null;
  return { plan: p.plan, status: p.status, active: p.active, reason: p.reason, trial_ends_at: p.trial_ends_at, past_due_since: p.past_due_since, cancel_at_period_end: p.cancel_at_period_end, current_period_end: p.current_period_end };
}
