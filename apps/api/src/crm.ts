// CRM activities: read model, creation (with recurrence), automation rules and webhook events.
// Used by the CRM routes, the offer / customer routes (rule triggers), the integration API and the worker.
import type postgres from 'postgres';
import type { Tx } from './db.js';
import { emitEvents, type EventSource, type WebhookEvent } from './webhooks.js';

type Db = Tx | postgres.Sql;
type Frag = postgres.PendingQuery<postgres.Row[]>;
export type Row = Record<string, unknown>;

export const STATUSES = ['planned', 'in_progress', 'done', 'cancelled'] as const;
export const OPEN = ['planned', 'in_progress'] as const;
export type Status = (typeof STATUSES)[number];
export type Recurrence = { freq: 'daily' | 'weekly' | 'monthly'; interval: number; count?: number; until?: string };

/** One shape for the app, the API v1 and the webhooks. */
export const activityOut = (tx: Db, T: string): Frag => tx`
  SELECT a.id, a.external_id, a.type, t.name AS type_name, t.icon AS type_icon, t.color AS type_color,
         a.subject, a.body, a.status, a.priority, a.due_at, a.duration_min, a.all_day, a.location,
         a.owner_id, ow.full_name AS owner_name, ow.email AS owner_email, a.created_by, cb.full_name AS created_by_name,
         a.customer_id, c.name AS customer_name, c.code AS customer_code, c.external_id AS customer_external_id,
         a.branch_id, b.name AS branch_name, a.contact_id, ct.full_name AS contact_name, ct.phone AS contact_phone, ct.mobile AS contact_mobile, ct.email AS contact_email,
         a.offer_id, o.number AS offer_number,
         a.outcome, oc.name AS outcome_name, oc.color AS outcome_color, a.outcome_note, a.completed_at, a.completed_by,
         a.remind_before_min, a.remind_at, a.series_id, a.recurrence, a.parent_id, a.rule_id, a.custom,
         (a.status IN ('planned', 'in_progress') AND a.due_at IS NOT NULL AND a.due_at < now()) AS overdue,
         a.created_at, a.updated_at
  FROM crm_activities a
  LEFT JOIN crm_activity_types t ON t.tenant_id = a.tenant_id AND t.key = a.type
  LEFT JOIN crm_outcomes oc ON oc.tenant_id = a.tenant_id AND oc.key = a.outcome
  LEFT JOIN users ow ON ow.id = a.owner_id
  LEFT JOIN users cb ON cb.id = a.created_by
  LEFT JOIN customers c ON c.id = a.customer_id
  LEFT JOIN branches b ON b.id = a.branch_id
  LEFT JOIN contacts ct ON ct.id = a.contact_id
  LEFT JOIN offers o ON o.id = a.offer_id
  WHERE a.tenant_id = ${T}`;

export async function emitActivityEvents(tx: Db, T: string, event: 'created' | 'updated' | 'completed' | 'deleted', ids: string[], source: EventSource) {
  if (!ids.length) return;
  if (event === 'deleted') {
    await emitEvents(tx as Tx, T, ids.map((id) => ({ event: 'activity.deleted' as WebhookEvent, data: { id } })), source);
    return;
  }
  const rows = await tx`${activityOut(tx, T)} AND a.id = ANY(${ids}::uuid[])`;
  await emitEvents(tx as Tx, T, rows.map((r) => ({ event: `activity.${event}` as WebhookEvent, data: { ...r } })), source);
}

/** Dates of the occurrences of a recurring activity (the first one included), at most 100 / 2 years. */
export function occurrences(start: Date, r: Recurrence) {
  const out: Date[] = [];
  const until = r.until ? new Date(`${r.until}T23:59:59`) : new Date(start.getTime() + 366 * 864e5);
  const max = Math.min(r.count ?? 100, 100);
  const hardEnd = new Date(start.getTime() + 2 * 366 * 864e5);
  for (let i = 0; out.length < max; i++) {
    const d = new Date(start);
    if (r.freq === 'daily') d.setDate(d.getDate() + i * r.interval);
    else if (r.freq === 'weekly') d.setDate(d.getDate() + i * 7 * r.interval);
    else {
      d.setMonth(d.getMonth() + i * r.interval);
      if (d.getDate() !== start.getDate()) d.setDate(0); // 31st → last day of shorter months
    }
    if (d > until || d > hardEnd) break;
    out.push(d);
  }
  return out;
}

export type NewActivity = {
  type: string; subject: string; body?: string | null; status?: Status; priority?: number;
  due_at?: Date | null; duration_min?: number; all_day?: boolean; location?: string | null;
  owner_id?: string | null; customer_id?: string | null; branch_id?: string | null; contact_id?: string | null; offer_id?: string | null;
  outcome?: string | null; outcome_note?: string | null; remind_before_min?: number | null;
  recurrence?: Recurrence | null; parent_id?: string | null; rule_id?: string | null; custom?: Row; external_id?: string | null;
};
const remindAt = (due: Date | null | undefined, before: number | null | undefined, status: string) =>
  due && before !== null && before !== undefined && (status === 'planned' || status === 'in_progress') ? new Date(due.getTime() - before * 60_000) : null;

/** Inserts an activity (and the rest of its series when recurring). Returns the ids, first one first. */
export async function insertActivity(tx: Db, T: string, by: string | null, a: NewActivity) {
  const status = a.status ?? 'planned';
  const done = status === 'done';
  const due = a.due_at ?? (done ? new Date() : null);
  const base = {
    tenant_id: T, external_id: a.external_id ?? null, type: a.type, subject: a.subject, body: a.body ?? null, status,
    priority: a.priority ?? 2, duration_min: a.duration_min ?? 0, all_day: a.all_day ?? false, location: a.location ?? null,
    owner_id: a.owner_id === undefined ? by : a.owner_id, created_by: by,
    customer_id: a.customer_id ?? null, branch_id: a.branch_id ?? null, contact_id: a.contact_id ?? null, offer_id: a.offer_id ?? null,
    outcome: a.outcome ?? null, outcome_note: a.outcome_note ?? null,
    completed_at: done ? new Date() : null, completed_by: done ? by : null,
    remind_before_min: a.remind_before_min ?? null, parent_id: a.parent_id ?? null, rule_id: a.rule_id ?? null,
    custom: tx.json((a.custom ?? {}) as never),
  };
  const dates = a.recurrence && due && !done ? occurrences(due, a.recurrence) : [due];
  const [first] = await tx`INSERT INTO crm_activities ${tx({ ...base, due_at: dates[0], remind_at: remindAt(dates[0], a.remind_before_min, status),
    recurrence: a.recurrence && dates.length > 1 ? tx.json(a.recurrence as never) : null } as never)} RETURNING id`;
  const ids = [first.id as string];
  if (dates.length > 1) {
    await tx`UPDATE crm_activities SET series_id = ${first.id} WHERE id = ${first.id}`;
    const rest = dates.slice(1).map((d) => ({ ...base, external_id: null, due_at: d, remind_at: remindAt(d, a.remind_before_min, status),
      recurrence: tx.json(a.recurrence as never), series_id: first.id }));
    const more = await tx`INSERT INTO crm_activities ${tx(rest as never)} RETURNING id`;
    ids.push(...more.map((r) => r.id as string));
  }
  return ids;
}
export { remindAt };

// ---------------------------------------------------------------- automation rules
export type RuleTrigger = 'offer_created' | 'offer_sent' | 'offer_accepted' | 'offer_rejected' | 'customer_created' | 'activity_done' | 'no_contact';
type RuleCtx = { customer_id?: string | null; offer_id?: string | null; actor_id?: string | null; activity?: Row | null };
type RuleAction = { type: string; subject: string; body?: string | null; due_in_days?: number; priority?: number; assign?: string; remind_before_min?: number | null };

/** Creates the activities of the active rules for this trigger. Rules never fail the operation that fired them. */
export async function runRules(tx: Db, T: string, trigger: RuleTrigger, ctx: RuleCtx) {
  try {
    const rules = await tx`SELECT id, config, action FROM crm_rules WHERE tenant_id = ${T} AND active AND trigger = ${trigger}`;
    if (!rules.length) return 0;
    const [cust] = ctx.customer_id ? await tx`SELECT id, name, account_manager_id, status FROM customers WHERE id = ${ctx.customer_id}` : [undefined];
    const [offer] = ctx.offer_id ? await tx`SELECT id, number, owner_id, customer_id FROM offers WHERE id = ${ctx.offer_id}` : [undefined];
    let made = 0;
    for (const r of rules) {
      const cfg = (r.config ?? {}) as { type?: string; outcome?: string; customer_status?: string };
      if (trigger === 'activity_done') {
        if (cfg.type && ctx.activity?.type !== cfg.type) continue;
        if (cfg.outcome && ctx.activity?.outcome !== cfg.outcome) continue;
      }
      if (cfg.customer_status && cust?.status !== cfg.customer_status) continue;
      made += await createFromRule(tx, T, r.id as string, r.action as RuleAction, {
        customer: cust as Row | undefined, offer: offer as Row | undefined, actor: ctx.actor_id ?? null, activity: ctx.activity ?? null,
      });
    }
    return made;
  } catch (e) {
    console.error('crm rule failed', trigger, e);
    return 0;
  }
}

export async function createFromRule(tx: Db, T: string, ruleId: string, act: RuleAction,
  c: { customer?: Row; offer?: Row; actor: string | null; activity: Row | null }) {
  const customerId = (c.customer?.id ?? c.offer?.customer_id ?? c.activity?.customer_id ?? null) as string | null;
  // One open activity per rule and customer/offer
  const [dup] = await tx`SELECT 1 FROM crm_activities WHERE tenant_id = ${T} AND rule_id = ${ruleId} AND status IN ('planned', 'in_progress')
    AND customer_id IS NOT DISTINCT FROM ${customerId} AND offer_id IS NOT DISTINCT FROM ${(c.offer?.id as string) ?? null} LIMIT 1`;
  if (dup) return 0;
  const assign = act.assign ?? 'actor';
  const owner = assign === 'account_manager' ? (c.customer?.account_manager_id as string) ?? c.actor
    : assign === 'owner' ? ((c.offer?.owner_id ?? c.activity?.owner_id ?? c.customer?.account_manager_id) as string) ?? c.actor
      : assign === 'actor' ? c.actor ?? (c.customer?.account_manager_id as string) ?? null
        : assign;
  const fill = (s: string) => s.replace(/\{customer\}/g, String(c.customer?.name ?? '')).replace(/\{offer\}/g, String(c.offer?.number ?? ''))
    .replace(/\{subject\}/g, String(c.activity?.subject ?? '')).replace(/\s+/g, ' ').trim();
  const due = new Date(Date.now() + (act.due_in_days ?? 1) * 864e5);
  due.setHours(10, 0, 0, 0);
  await insertActivity(tx, T, owner ?? null, {
    type: act.type, subject: fill(act.subject) || act.subject, body: act.body ? fill(act.body) : null, priority: act.priority ?? 2,
    due_at: due, owner_id: owner ?? null, customer_id: customerId, offer_id: (c.offer?.id as string) ?? null,
    parent_id: (c.activity?.id as string) ?? null, rule_id: ruleId, remind_before_min: act.remind_before_min ?? null,
  });
  await tx`UPDATE crm_rules SET runs = runs + 1, last_run_at = now() WHERE id = ${ruleId}`;
  return 1;
}

/** Daily: customers without a completed activity for N days (and nothing planned) get one. Worker only (all tenants). */
export async function runNoContactRules(db: postgres.Sql) {
  const rules = await db`SELECT id, tenant_id, config, action FROM crm_rules
    WHERE active AND trigger = 'no_contact' AND (last_run_at IS NULL OR last_run_at < now() - interval '20 hours')`;
  for (const r of rules) {
    const days = Math.max(1, Number((r.config as { days?: number }).days ?? 60));
    const status = (r.config as { customer_status?: string }).customer_status ?? null;
    const T = r.tenant_id as string;
    const custs = await db`
      SELECT c.id, c.name, c.account_manager_id, c.status FROM customers c
      WHERE c.tenant_id = ${T} AND c.archived_at IS NULL AND c.created_at < now() - (${days} * interval '1 day')
        ${status ? db`AND c.status = ${status}` : db``}
        AND NOT EXISTS (SELECT 1 FROM crm_activities a WHERE a.tenant_id = ${T} AND a.customer_id = c.id
          AND (a.status IN ('planned', 'in_progress') OR (a.status = 'done' AND a.completed_at > now() - (${days} * interval '1 day'))))
      LIMIT 200`;
    await db.begin(async (tx) => {
      for (const c of custs) await createFromRule(tx as unknown as Tx, T, r.id as string, r.action as RuleAction, { customer: c, actor: null, activity: null });
      await tx`UPDATE crm_rules SET last_run_at = now() WHERE id = ${r.id}`;
    });
  }
}
