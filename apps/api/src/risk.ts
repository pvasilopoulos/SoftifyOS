// Customers at risk: a 0-100 score from facts the CRM already has (no AI, no cost). The worker recomputes every
// organisation every few hours, streaming its customers in batches, and keeps only those with a real signal.
import { sql } from './db.js';

export type RiskFacts = {
  customer_created: Date;
  last_contact: Date | null;       // latest completed activity
  upcoming: number;                // planned activities still ahead
  overdue: number;                 // planned activities already late
  cancelled_90: number;
  done_90: number;                 // completed in the last 90 days
  done_prev_90: number;            // completed in the 90 days before that
  offers_expired: number;          // sent, validity passed, no answer
  offers_expiring: number;         // sent, validity ends within 7 days
  offers_rejected_180: number;
  open_amount: number;             // offers sent / awaiting answer
};
export type RiskReason =
  | { code: 'no_contact'; days: number } | { code: 'never_contacted'; days: number }
  | { code: 'overdue'; n: number } | { code: 'offers_expired'; n: number } | { code: 'offers_expiring'; n: number; amount: number }
  | { code: 'offers_rejected'; n: number } | { code: 'cancellations'; n: number } | { code: 'activity_drop'; from: number; to: number };
export type Risk = { score: number; level: 'low' | 'medium' | 'high'; reasons: RiskReason[] };

export const RISK_MIN_SCORE = 25;   // below this a customer is not listed

const DAY = 864e5;

/** Score and the reasons behind it, most important first. Pure: easy to test and to explain. */
export function scoreRisk(f: RiskFacts, now = new Date()): Risk {
  const parts: { pts: number; reason: RiskReason }[] = [];
  const ageDays = Math.floor((now.getTime() - f.customer_created.getTime()) / DAY);
  // Someone already has something planned: the silence matters less
  const planned = f.upcoming > 0 ? 0.5 : 1;
  if (f.last_contact) {
    const days = Math.floor((now.getTime() - f.last_contact.getTime()) / DAY);
    const pts = days >= 90 ? 35 : days >= 60 ? 25 : days >= 30 ? 10 : 0;
    if (pts) parts.push({ pts: Math.round(pts * planned), reason: { code: 'no_contact', days } });
  } else if (ageDays >= 30) {
    parts.push({ pts: Math.round(20 * planned), reason: { code: 'never_contacted', days: ageDays } });
  }
  if (f.overdue > 0) parts.push({ pts: Math.min(3, f.overdue) * 8, reason: { code: 'overdue', n: f.overdue } });
  if (f.offers_expired > 0) parts.push({ pts: Math.min(2, f.offers_expired) * 15, reason: { code: 'offers_expired', n: f.offers_expired } });
  if (f.offers_expiring > 0) parts.push({ pts: 10, reason: { code: 'offers_expiring', n: f.offers_expiring, amount: f.open_amount } });
  if (f.offers_rejected_180 > 0) parts.push({ pts: Math.min(2, f.offers_rejected_180) * 10, reason: { code: 'offers_rejected', n: f.offers_rejected_180 } });
  if (f.cancelled_90 >= 2) parts.push({ pts: 10, reason: { code: 'cancellations', n: f.cancelled_90 } });
  if (f.done_prev_90 >= 3 && f.done_90 * 3 <= f.done_prev_90) parts.push({ pts: 15, reason: { code: 'activity_drop', from: f.done_prev_90, to: f.done_90 } });
  parts.sort((a, b) => b.pts - a.pts);
  const score = Math.min(100, parts.reduce((s, p) => s + p.pts, 0));
  return { score, level: score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low', reasons: parts.map((p) => p.reason) };
}

type FactRow = Omit<RiskFacts, 'open_amount'> & { id: string; open_amount: string | number | null };

/** Recomputes one organisation. Customers without a signal are removed from the list. */
export async function computeRisk(T: string, now = new Date()) {
  const started = new Date();
  let kept = 0;
  const cursor = sql<FactRow[]>`
    WITH act AS (
      SELECT customer_id,
             max(coalesce(completed_at, due_at)) FILTER (WHERE status = 'done') AS last_contact,
             count(*) FILTER (WHERE status IN ('planned', 'in_progress') AND due_at >= now())::int AS upcoming,
             count(*) FILTER (WHERE status IN ('planned', 'in_progress') AND due_at < now())::int AS overdue,
             count(*) FILTER (WHERE status = 'cancelled' AND updated_at > now() - interval '90 days')::int AS cancelled_90,
             count(*) FILTER (WHERE status = 'done' AND coalesce(completed_at, due_at) > now() - interval '90 days')::int AS done_90,
             count(*) FILTER (WHERE status = 'done' AND coalesce(completed_at, due_at) <= now() - interval '90 days'
                                AND coalesce(completed_at, due_at) > now() - interval '180 days')::int AS done_prev_90
      FROM crm_activities WHERE tenant_id = ${T} AND customer_id IS NOT NULL GROUP BY customer_id),
    off AS (
      SELECT customer_id,
             count(*) FILTER (WHERE status = 'sent' AND valid_until < current_date)::int AS offers_expired,
             count(*) FILTER (WHERE status = 'sent' AND valid_until BETWEEN current_date AND current_date + 7)::int AS offers_expiring,
             count(*) FILTER (WHERE status = 'rejected' AND updated_at > now() - interval '180 days')::int AS offers_rejected_180,
             sum(total_amount) FILTER (WHERE status = 'sent' AND (valid_until IS NULL OR valid_until >= current_date)) AS open_amount
      FROM offers WHERE tenant_id = ${T} GROUP BY customer_id)
    SELECT c.id, c.created_at AS customer_created, a.last_contact,
           coalesce(a.upcoming, 0) AS upcoming, coalesce(a.overdue, 0) AS overdue, coalesce(a.cancelled_90, 0) AS cancelled_90,
           coalesce(a.done_90, 0) AS done_90, coalesce(a.done_prev_90, 0) AS done_prev_90,
           coalesce(o.offers_expired, 0) AS offers_expired, coalesce(o.offers_expiring, 0) AS offers_expiring,
           coalesce(o.offers_rejected_180, 0) AS offers_rejected_180, coalesce(o.open_amount, 0) AS open_amount
    FROM customers c LEFT JOIN act a ON a.customer_id = c.id LEFT JOIN off o ON o.customer_id = c.id
    WHERE c.tenant_id = ${T} AND c.archived_at IS NULL AND c.status <> 'inactive'`.cursor(5000);
  for await (const rows of cursor) {
    const out = rows
      .map((r) => ({ id: r.id, ...scoreRisk({ ...r, open_amount: Number(r.open_amount ?? 0) }, now) }))
      .filter((r) => r.score >= RISK_MIN_SCORE);
    if (!out.length) continue;
    kept += out.length;
    await sql`
      INSERT INTO customer_risk (tenant_id, customer_id, score, level, reasons, computed_at)
      SELECT ${T}, x.id, x.score, x.level, x.reasons, ${started}
      FROM jsonb_to_recordset(${sql.json(out as never)}) AS x(id uuid, score smallint, level text, reasons jsonb)
      ON CONFLICT (tenant_id, customer_id) DO UPDATE
        SET score = EXCLUDED.score, level = EXCLUDED.level, reasons = EXCLUDED.reasons, computed_at = EXCLUDED.computed_at`;
  }
  // Whatever was not refreshed in this run has no signal any more
  await sql`DELETE FROM customer_risk WHERE tenant_id = ${T} AND computed_at < ${started}`;
  await sql`UPDATE tenants SET risk_computed_at = now() WHERE id = ${T}`;
  return { kept };
}

/** Organisations whose list is older than `hours` (worker, a few at a time). */
export async function computeRiskDue(hours = 6, max = 20) {
  const due = await sql<{ id: string }[]>`
    SELECT id FROM tenants WHERE coalesce(risk_computed_at, 'epoch') < now() - make_interval(hours => ${hours})
    ORDER BY risk_computed_at NULLS FIRST LIMIT ${max}`;
  for (const t of due) await computeRisk(t.id);
  return due.length;
}
