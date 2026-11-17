// AI engine: Claude client, per-tenant settings and budget, metering, and the Copilot tools.
// Tools never touch the database directly: they call this API in-process (app.inject) with the user's own
// cookie, so every permission, row-level rule and Module Forms visibility that applies to the user applies to
// the assistant too. Changes are only *proposed* (ai_actions); they run when the user confirms them.
import Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql, withTenant, type Tx } from './db.js';
import type { Session } from './auth.js';
import { FILTERS } from './filters.js';
import { catalogue } from './reports.js';
import { decryptSecret } from './registries.js';

export const MODEL = 'claude-opus-5-5';
/** Server-side fallback on a refusal: the API re-runs the request on a suitable model. */
export const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];
// $ per million tokens (Claude Opus 5.5): input, output, cache read, cache write (5 min)
const PRICE = { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 };

export const FEATURES = ['copilot', 'voice', 'summary', 'reports', 'offer_draft', 'import'] as const;
export type Feature = (typeof FEATURES)[number];
export type AiSettings = {
  enabled: boolean; consent_at: string | null; consent_by: string | null; monthly_budget_usd: number;
  features: Record<Feature, boolean>;
};
export const DEFAULT_SETTINGS: AiSettings = {
  enabled: false, consent_at: null, consent_by: null, monthly_budget_usd: 50,
  features: { copilot: true, voice: true, summary: true, reports: true, offer_draft: true, import: true },
};

// Clients: one per organisation key (Settings → AI), else the server key from .env (fallback for everyone).
let envClient: Anthropic | null | undefined;
const envAi = () => {
  if (envClient === undefined) envClient = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null;
  return envClient;
};
export const hasEnvKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
// Keyed by the encrypted value, so a changed key (on any server instance) gets a new client
const tenantClients = new Map<string, { enc: string; client: Anthropic }>();
/** The client for this organisation, or null when neither it nor the server has a key. */
export async function aiFor(tenantId: string): Promise<Anthropic | null> {
  const [t] = await sql<{ ai_key_enc: string | null }[]>`SELECT ai_key_enc FROM tenants WHERE id = ${tenantId}`;
  if (!t?.ai_key_enc) { tenantClients.delete(tenantId); return envAi(); }
  const hit = tenantClients.get(tenantId);
  if (hit && hit.enc === t.ai_key_enc) return hit.client;
  const key = decryptSecret(t.ai_key_enc);
  if (!key) return envAi();
  const client = new Anthropic({ apiKey: key });
  tenantClients.set(tenantId, { enc: t.ai_key_enc, client });
  return client;
}
/** Client for a key typed in Settings (to test it before saving). */
export const clientWithKey = (apiKey: string) => new Anthropic({ apiKey });

export async function loadSettings(tenantId: string): Promise<AiSettings> {
  const [t] = await sql<{ ai_settings: Partial<AiSettings> }[]>`SELECT ai_settings FROM tenants WHERE id = ${tenantId}`;
  const s = t?.ai_settings ?? {};
  return { ...DEFAULT_SETTINGS, ...s, features: { ...DEFAULT_SETTINGS.features, ...(s.features ?? {}) } };
}

export async function monthSpend(tx: Tx, tenantId: string) {
  const [r] = await tx<{ usd: string }[]>`
    SELECT coalesce(sum(cost_usd), 0) AS usd FROM ai_usage WHERE tenant_id = ${tenantId} AND created_at >= date_trunc('month', now())`;
  return Number(r.usd);
}

/** Why the user cannot use a feature right now, or null. */
export async function gate(s: Session, feature: Feature): Promise<string | null> {
  if (!(await aiFor(s.tenantId))) return 'ai_not_configured';
  if (!(s.role === 'owner' || s.perms?.includes('ai.use'))) return 'forbidden';
  const st = await loadSettings(s.tenantId);
  if (!st.enabled || !st.consent_at) return 'ai_disabled';
  if (!st.features[feature]) return 'feature_disabled';
  const spent = await withTenant(s.tenantId, (tx) => monthSpend(tx, s.tenantId));
  if (spent >= st.monthly_budget_usd) return 'budget_exceeded';
  return null;
}

export async function meter(s: Session, feature: Feature, model: string, u: Anthropic.Beta.BetaUsage | undefined) {
  if (!u) return;
  const cr = u.cache_read_input_tokens ?? 0, cw = u.cache_creation_input_tokens ?? 0;
  const cost = (u.input_tokens * PRICE.in + u.output_tokens * PRICE.out + cr * PRICE.cacheRead + cw * PRICE.cacheWrite) / 1e6;
  await withTenant(s.tenantId, (tx) => tx`
    INSERT INTO ai_usage (tenant_id, user_id, feature, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd)
    VALUES (${s.tenantId}, ${s.userId}, ${feature}, ${model}, ${u.input_tokens}, ${u.output_tokens}, ${cr}, ${cw}, ${cost})`);
}

// ============================================================ in-process API calls as the user
export type Caller = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown) => Promise<{ status: number; data: unknown }>;
export function callerFor(app: FastifyInstance, req: FastifyRequest): Caller {
  const cookie = req.headers.cookie ?? '';
  return async (method, url, body) => {
    const res = await app.inject({ method, url: `/api${url}`, headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body) });
    let data: unknown = null;
    try { data = res.json(); } catch { data = res.body; }
    return { status: res.statusCode, data };
  };
}

/** Fields this user cannot see in a form (Module Forms): removed from everything the model reads. */
async function hiddenFields(call: Caller, form: 'customer' | 'branch' | 'offer' | 'activity') {
  const r = await call('GET', `/forms/${form}/effective`);
  const fields = ((r.data as { fields?: { key: string; hidden: boolean }[] })?.fields ?? []).filter((f) => f.hidden).map((f) => f.key);
  return new Set(fields);
}
function strip(o: unknown, hidden: Set<string>): unknown {
  if (Array.isArray(o)) return o.map((x) => strip(x, hidden));
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (hidden.has(k) || hidden.has(`${k}_id`)) continue;
    if (k === 'custom' && v && typeof v === 'object') {
      out.custom = Object.fromEntries(Object.entries(v).filter(([ck]) => !hidden.has(`cf_${ck}`)));
      continue;
    }
    // ids, image urls and internal search columns cost tokens and say nothing
    if (k === 'search' || k === 'image_url' || k === 'tenant_id') continue;
    out[k] = v;
  }
  return out;
}
const ok = (r: { status: number; data: unknown }) => {
  if (r.status >= 400) throw new ToolError(typeof r.data === 'object' && r.data && 'error' in r.data ? String((r.data as { error: unknown }).error) : `http_${r.status}`);
  return r.data;
};
export class ToolError extends Error {}

// ============================================================ tools
const uuid = { type: 'string', description: 'UUID' } as const;
const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

type ToolCtx = { call: Caller; s: Session; conversationId: string | null; hidden: () => Promise<{ customer: Set<string>; branch: Set<string> }> };
type ToolDef = { tool: Anthropic.Beta.BetaTool; label: { el: string; en: string }; schema: z.ZodType; run: (input: never, ctx: ToolCtx) => Promise<unknown> };

const customerFilterKeys = Object.keys(FILTERS).filter((k) => !k.startsWith('s_'));
const ACTION_KINDS = ['task', 'activity', 'offer_draft', 'save_report'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

async function propose(ctx: ToolCtx, kind: ActionKind, payload: unknown, summary: Record<string, unknown>) {
  const [a] = await withTenant(ctx.s.tenantId, (tx) => tx<{ id: string }[]>`
    INSERT INTO ai_actions (tenant_id, user_id, conversation_id, kind, payload, summary)
    VALUES (${ctx.s.tenantId}, ${ctx.s.userId}, ${ctx.conversationId}, ${kind}, ${tx.json(payload as never)}, ${tx.json(summary as never)})
    RETURNING id`);
  return { proposed_action_id: a.id, status: 'awaiting_user_confirmation',
    note: 'Shown to the user as a card with Confirm / Cancel. It has NOT been done yet; do not say it was.' };
}

const T = <S extends z.ZodType>(name: string, label: [string, string], description: string, properties: Record<string, unknown>, required: string[], schema: S,
  run: (input: z.infer<S>, ctx: ToolCtx) => Promise<unknown>): ToolDef => ({
  tool: { name, description, input_schema: { type: 'object', properties, required, additionalProperties: false } as Anthropic.Beta.BetaTool.InputSchema },
  label: { el: label[0], en: label[1] }, schema, run: run as ToolDef['run'],
});

const S = { opt: z.string().trim().max(400).nullish(), id: z.string().uuid() };
const dateRe = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/;

export const TOOLS: ToolDef[] = [
  T('search_customers', ['Αναζήτηση πελατών', 'Searching customers'],
    `Search customers (companies and groups). Free text matches name, trade name, code, VAT no., e-mail, phone, city (Greek or greeklish). ` +
    `Optional filters, as an object of key → value. Keys: ${customerFilterKeys.join(', ')}. ` +
    `c_status: active|prospect|negotiation|inactive. c_manager: "me" or a user id. c_value_min / c_value_max: annual value range. ` +
    `c_created / c_updated: within the last N days. Text filters (c_prefecture, c_city, c_category) match exact values. Returns at most \`limit\` rows (default 20).`,
    { q: { type: 'string' }, filters: { type: 'object', additionalProperties: { type: 'string' } }, sort: { type: 'string', enum: ['name', 'value_desc', 'recent'] }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
    [], z.object({ q: S.opt, filters: z.record(z.string(), z.coerce.string()).nullish(), sort: z.enum(['name', 'value_desc', 'recent']).nullish(), limit: z.number().int().min(1).max(50).nullish() }),
    async (i, ctx) => {
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(i.filters ?? {})) {
        const m = /^(.+?)(_min|_max)?$/.exec(k)!;
        if (customerFilterKeys.includes(m[1])) f[`f_${k}`] = v;
      }
      const sort = i.sort === 'value_desc' ? 'value' : i.sort === 'recent' ? 'recent' : undefined;
      const data = ok(await ctx.call('GET', `/customers${qs({ q: i.q, limit: i.limit ?? 20, sort, ...f })}`)) as { items: unknown[]; nextCursor: unknown };
      const h = await ctx.hidden();
      return { items: strip(data.items, h.customer), more: !!data.nextCursor };
    }),
  T('get_customer', ['Ανάγνωση καρτέλας πελάτη', 'Reading customer card'],
    'Full customer card: details, stores (with spaces), contacts, latest activities, open offers and open tasks. Use the id from search_customers.',
    { id: uuid }, ['id'], z.object({ id: S.id }),
    async (i, ctx) => {
      const h = await ctx.hidden();
      const [c, b, acts, offers, tasks] = await Promise.all([
        ctx.call('GET', `/customers/${i.id}`), ctx.call('GET', `/customers/${i.id}/branches`),
        ctx.call('GET', `/crm/activities${qs({ customer_id: i.id, scope: 'all', status: 'any', limit: 15 })}`),
        ctx.call('GET', `/offers${qs({ customer: i.id, limit: 15 })}`),
        ctx.call('GET', `/tasks${qs({ customer_id: i.id, view: 'team', status: 'open', limit: 20 })}`),
      ]);
      return {
        customer: strip(ok(c), h.customer), stores: strip(b.status < 400 ? b.data : null, h.branch),
        activities: acts.status < 400 ? acts.data : null, offers: offers.status < 400 ? offers.data : null, open_tasks: tasks.status < 400 ? tasks.data : null,
      };
    }),
  T('search_stores', ['Αναζήτηση καταστημάτων', 'Searching stores'],
    'Search stores (branches) of all customers by name, trade name, address, city or customer. Same filters object as search_customers (b_* keys apply to the store).',
    { q: { type: 'string' }, filters: { type: 'object', additionalProperties: { type: 'string' } }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
    [], z.object({ q: S.opt, filters: z.record(z.string(), z.coerce.string()).nullish(), limit: z.number().int().min(1).max(50).nullish() }),
    async (i, ctx) => {
      const f = Object.fromEntries(Object.entries(i.filters ?? {}).filter(([k]) => customerFilterKeys.includes(k.replace(/_(min|max)$/, ''))).map(([k, v]) => [`f_${k}`, v]));
      const data = ok(await ctx.call('GET', `/branches${qs({ q: i.q, limit: i.limit ?? 20, ...f })}`)) as { items: unknown[] };
      return { items: strip(data.items, (await ctx.hidden()).branch) };
    }),
  T('list_offers', ['Ανάγνωση προσφορών', 'Reading offers'],
    'List offers, newest first, optionally of one customer and/or with a status (draft, pending_approval, approved, rejected, sent, accepted, declined, expired).',
    { customer_id: uuid, status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, [],
    z.object({ customer_id: S.id.nullish(), status: z.string().max(40).nullish(), limit: z.number().int().min(1).max(100).nullish() }),
    async (i, ctx) => ok(await ctx.call('GET', `/offers${qs({ customer: i.customer_id, status: i.status, limit: i.limit ?? 30 })}`))),
  T('get_offer', ['Ανάγνωση προσφοράς', 'Reading offer'], 'One offer with its lines, versions and history.', { id: uuid }, ['id'], z.object({ id: S.id }),
    async (i, ctx) => ok(await ctx.call('GET', `/offers/${i.id}`))),
  T('list_activities', ['Ανάγνωση ενεργειών CRM', 'Reading CRM activities'],
    'CRM activities (calls, visits, meetings…). scope "mine" or "all" (all needs permission). status open|planned|in_progress|done|cancelled|any. due overdue|today|tomorrow|week|upcoming|nodate|range (range uses from/to, ISO dates).',
    { scope: { type: 'string', enum: ['mine', 'all'] }, status: { type: 'string' }, due: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, customer_id: uuid, q: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, [],
    z.object({ scope: z.enum(['mine', 'all']).nullish(), status: z.string().max(20).nullish(), due: z.string().max(20).nullish(), from: z.string().regex(dateRe).nullish(), to: z.string().regex(dateRe).nullish(), customer_id: S.id.nullish(), q: S.opt, limit: z.number().int().min(1).max(100).nullish() }),
    async (i, ctx) => ok(await ctx.call('GET', `/crm/activities${qs({ ...i, limit: i.limit ?? 30 })}`))),
  T('list_tasks', ['Ανάγνωση εργασιών', 'Reading tasks'],
    'Tasks. view mine|created|watching|team. status open|todo|in_progress|waiting|done|cancelled|any. due overdue|today|week|nodate.',
    { view: { type: 'string', enum: ['mine', 'created', 'watching', 'team'] }, status: { type: 'string' }, due: { type: 'string' }, customer_id: uuid, q: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, [],
    z.object({ view: z.enum(['mine', 'created', 'watching', 'team']).nullish(), status: z.string().max(20).nullish(), due: z.string().max(20).nullish(), customer_id: S.id.nullish(), q: S.opt, limit: z.number().int().min(1).max(100).nullish() }),
    async (i, ctx) => ok(await ctx.call('GET', `/tasks${qs({ ...i, limit: i.limit ?? 30 })}`))),
  T('run_report', ['Υπολογισμός αναφοράς', 'Running a report'],
    'Run an aggregate report (counts, sums, rates grouped by a dimension over a period) with the report engine. The definition uses the source / measure / group keys listed in the system prompt.',
    { definition: { type: 'object', properties: {
      source: { type: 'string' }, measure: { type: 'string' }, group: { type: 'string' },
      period: { type: 'object', properties: { preset: { type: 'string', enum: ['7d', '30d', '90d', 'month', 'last_month', 'quarter', 'year', 'last_year', 'all', 'custom'] }, from: { type: 'string' }, to: { type: 'string' } } },
      compare: { type: 'boolean' }, filters: { type: 'object', properties: { owner: { type: 'string' }, status: { type: 'string' }, category: { type: 'string' }, region: { type: 'string' } } },
      limit: { type: 'integer' }, chart: { type: 'string', enum: ['bar', 'column', 'line', 'table', 'kpi'] } }, required: ['source', 'measure'] } }, ['definition'],
    z.object({ definition: z.record(z.string(), z.unknown()) }),
    async (i, ctx) => ok(await ctx.call('POST', '/reports/run', { definition: i.definition }))),
  T('search_products', ['Αναζήτηση στον κατάλογο', 'Searching the catalogue'], 'Search the product / service catalogue (name, SKU). Returns id, name, unit, unit_price, vat_rate.',
    { q: { type: 'string' } }, ['q'], z.object({ q: z.string().trim().min(1).max(100) }),
    async (i, ctx) => ok(await ctx.call('GET', `/products${qs({ q: i.q })}`))),
  T('list_users', ['Ανάγνωση χρηστών', 'Reading users'], 'Users of the organisation (id, name) to assign tasks or activities.', {}, [], z.object({}),
    async (_i, ctx) => (ok(await ctx.call('GET', '/crm/meta')) as { users: unknown }).users),

  // ------------------------------------------------ proposals (run only after the user confirms)
  T('propose_task', ['Πρόταση εργασίας', 'Proposing a task'],
    'Propose a new task. The user sees a card and must confirm it. due_at ISO date-time in the organisation timezone. priority 1 high, 2 normal, 3 low.',
    { title: { type: 'string' }, description: { type: 'string' }, due_at: { type: 'string' }, priority: { type: 'integer', enum: [1, 2, 3] }, owner_id: uuid, customer_id: uuid, branch_id: uuid, offer_id: uuid }, ['title'],
    z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(5000).nullish(), due_at: z.string().regex(dateRe).nullish(), priority: z.number().int().min(1).max(3).nullish(),
      owner_id: S.id.nullish(), customer_id: S.id.nullish(), branch_id: S.id.nullish(), offer_id: S.id.nullish() }),
    async (i, ctx) => propose(ctx, 'task', i, { title: i.title, due_at: i.due_at ?? null })),
  T('propose_activity', ['Πρόταση ενέργειας CRM', 'Proposing a CRM activity'],
    'Propose a CRM activity (log a visit/call that happened with status "done" and an outcome, or plan one with status "planned" and due_at). type and outcome must be keys from the system prompt lists.',
    { type: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, status: { type: 'string', enum: ['planned', 'done'] }, due_at: { type: 'string' }, duration_min: { type: 'integer' },
      outcome: { type: 'string' }, outcome_note: { type: 'string' }, owner_id: uuid, customer_id: uuid, branch_id: uuid, contact_id: uuid, offer_id: uuid }, ['type', 'subject', 'status'],
    z.object({ type: z.string().max(40), subject: z.string().trim().min(1).max(200), body: z.string().max(20000).nullish(), status: z.enum(['planned', 'done']), due_at: z.string().regex(dateRe).nullish(),
      duration_min: z.number().int().min(0).max(10080).nullish(), outcome: z.string().max(40).nullish(), outcome_note: z.string().max(5000).nullish(),
      owner_id: S.id.nullish(), customer_id: S.id.nullish(), branch_id: S.id.nullish(), contact_id: S.id.nullish(), offer_id: S.id.nullish() }),
    async (i, ctx) => propose(ctx, 'activity', i, { subject: i.subject, type: i.type, status: i.status, due_at: i.due_at ?? null })),
  T('propose_offer_draft', ['Πρόχειρη προσφορά', 'Drafting an offer'],
    'Propose a DRAFT offer for a customer (optionally a store and a space). Use search_products for catalogue lines (product_id, unit_price, vat_rate); free-text lines are allowed. On confirmation it is saved as a draft the user then edits and submits.',
    { customer_id: uuid, branch_id: uuid, space_id: uuid, notes: { type: 'string' }, valid_until: { type: 'string' },
      items: { type: 'array', items: { type: 'object', properties: { product_id: uuid, description: { type: 'string' }, unit: { type: 'string' }, quantity: { type: 'number' }, unit_price: { type: 'number' }, discount: { type: 'number' }, vat_rate: { type: 'number' } }, required: ['description', 'quantity', 'unit_price'] } } },
    ['customer_id', 'items'],
    z.object({ customer_id: S.id, branch_id: S.id.nullish(), space_id: S.id.nullish(), notes: z.string().max(5000).nullish(), valid_until: z.string().regex(dateRe).nullish(),
      items: z.array(z.object({ product_id: S.id.nullish(), description: z.string().trim().min(1).max(500), unit: z.string().max(20).nullish(), quantity: z.number().positive(), unit_price: z.number().min(0),
        discount: z.number().min(0).max(100).nullish(), vat_rate: z.number().min(0).max(100).nullish() })).min(1).max(100) }),
    async (i, ctx) => {
      const net = i.items.reduce((a, x) => a + x.quantity * x.unit_price * (1 - (x.discount ?? 0) / 100), 0);
      return propose(ctx, 'offer_draft', i, { lines: i.items.length, net: Math.round(net * 100) / 100 });
    }),
  T('propose_save_report', ['Αποθήκευση αναφοράς', 'Saving a report'],
    'Propose saving a report definition (as tested with run_report) under a name, private to the user.',
    { name: { type: 'string' }, definition: { type: 'object' } }, ['name', 'definition'],
    z.object({ name: z.string().trim().min(1).max(120), definition: z.record(z.string(), z.unknown()) }),
    async (i, ctx) => propose(ctx, 'save_report', { name: i.name, definition: i.definition, scope: 'private' }, { name: i.name })),
];
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.tool.name, t]));

/** Runs a confirmed action as the user (through the normal endpoints, with their permissions). */
export async function executeAction(call: Caller, kind: ActionKind, p: Record<string, unknown>) {
  switch (kind) {
    case 'task': return { ...(ok(await call('POST', '/tasks', p)) as object), link: null };
    case 'activity': return ok(await call('POST', '/crm/activities', p));
    case 'offer_draft': {
      const items = (p.items as Record<string, unknown>[]).map((x) => ({ unit: 'τεμ.', discount: 0, vat_rate: 24, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null)) }));
      return ok(await call('POST', '/offers', { ...p, items }));
    }
    case 'save_report': return ok(await call('POST', '/reports/saved', p));
  }
}

// ============================================================ system prompt (stable per tenant → cached)
export async function systemPrompt(s: Session, locale: string) {
  const ctx = await withTenant(s.tenantId, async (tx) => {
    const [t] = await tx`SELECT name, currency, timezone FROM tenants WHERE id = ${s.tenantId}`;
    const types = await tx`SELECT key, name FROM crm_activity_types WHERE tenant_id = ${s.tenantId} AND active ORDER BY sort`;
    const outcomes = await tx`SELECT key, name FROM crm_outcomes WHERE tenant_id = ${s.tenantId} AND active ORDER BY sort`;
    return { t, types, outcomes };
  });
  const cat = catalogue() as Record<string, { measures: Record<string, unknown>; dims: Record<string, unknown> }>;
  const reports = Object.entries(cat).map(([k, v]) => `- ${k}: measures ${Object.keys(v.measures).join(', ')}; group by ${Object.keys(v.dims).join(', ')}`).join('\n');
  return `You are the SoftifyOS assistant inside the business app of "${ctx.t.name}" (a B2B sales organisation: customers → stores → spaces, offers, CRM activities, tasks, documents, reports). Currency ${ctx.t.currency ?? 'EUR'}, timezone ${ctx.t.timezone ?? 'Europe/Athens'}.

Answer in the language the user writes in (usually Greek). Be concise and practical: short paragraphs or bullet lists, figures with units. When you mention a record, link it with markdown: customers [Name](/customers/<id>), offers [#number](/offers/<id>), tasks [title](/tasks?open=<id>), activities [subject](/crm?open=<id>).

Use the tools to look things up; never invent customers, amounts or dates. You see only what this user is allowed to see; if a tool returns "forbidden", say the user's role does not allow it. If a search finds several possible matches, ask which one.

You cannot change data yourself. To create a task, log or plan a CRM activity, draft an offer or save a report, call the matching propose_* tool: the user gets a card to confirm. After proposing, say briefly what you proposed and that it waits for their confirmation. Propose several items at once when the user asks for several things.

CRM activity types (key: name): ${ctx.types.map((x) => `${x.key}: ${x.name}`).join(', ') || 'call, meeting, visit, email'}.
Activity outcomes (key: name): ${ctx.outcomes.map((x) => `${x.key}: ${x.name}`).join(', ') || '—'}.

Report sources (run_report):
${reports}
Periods: 7d, 30d, 90d, month, last_month, quarter, year, last_year, all, custom (from/to ISO dates). compare=true adds the previous period.

Interface language: ${locale}.`;
}

/** Context line put in front of every user message (date and where the user is), kept in history. */
export function contextLine(page?: { kind?: string; id?: string; title?: string } | null) {
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Athens' }).replace(' ', 'T');
  return `[now: ${now} Europe/Athens${page?.kind ? ` · user is looking at ${page.kind}${page.id ? ` ${page.id}` : ''}${page.title ? ` "${page.title}"` : ''}` : ''}]`;
}
