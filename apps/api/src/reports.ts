// Report engine: a report = source × measure × grouping, over a period (optionally compared with the previous one),
// with filters. Only whitelisted SQL pieces are used (no user SQL). Results are cached for a few minutes.
import { z } from 'zod';
import type postgres from 'postgres';
import type { Tx } from './db.js';

type Db = Tx | postgres.Sql;
type L = { el: string; en: string };
const L = (el: string, en: string): L => ({ el, en });

type Dim = { label: L; sql: string; time?: boolean; join?: string };
type Measure = { label: L; sql: string; money?: boolean; pct?: boolean };
type Source = {
  label: L; from: string; date: string; owner: string; tenant: string; base?: string;
  /** Row visibility: activities / tasks are limited to your own without the "all" permission. */
  restrictPerm?: string;
  measures: Record<string, Measure>; dims: Record<string, Dim>;
  filters: Record<string, string>;   // filter key → column
};

const month = (col: string): Dim => ({ label: L('Μήνας', 'Month'), sql: `to_char(date_trunc('month', ${col}), 'YYYY-MM')`, time: true });
const week = (col: string): Dim => ({ label: L('Εβδομάδα', 'Week'), sql: `to_char(date_trunc('week', ${col}), 'IYYY-"W"IW')`, time: true });
const day = (col: string): Dim => ({ label: L('Ημέρα', 'Day'), sql: `to_char(date_trunc('day', ${col}), 'YYYY-MM-DD')`, time: true });

export const SOURCES: Record<string, Source> = {
  offers: {
    label: L('Προσφορές', 'Offers'),
    from: `offers o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.owner_id LEFT JOIN companies co ON co.id = o.company_id`,
    tenant: 'o.tenant_id', date: 'o.created_at', owner: 'o.owner_id',
    measures: {
      count: { label: L('Πλήθος', 'Count'), sql: 'count(*)' },
      sum_value: { label: L('Αξία', 'Value'), sql: 'coalesce(sum(o.total_amount), 0)', money: true },
      avg_value: { label: L('Μέση αξία', 'Average value'), sql: 'coalesce(avg(o.total_amount), 0)', money: true },
      won_value: { label: L('Αξία κερδισμένων', 'Won value'), sql: "coalesce(sum(o.total_amount) FILTER (WHERE o.status = 'accepted'), 0)", money: true },
      win_rate: { label: L('Ποσοστό επιτυχίας', 'Win rate'), sql: "coalesce(round(100.0 * count(*) FILTER (WHERE o.status = 'accepted') / nullif(count(*) FILTER (WHERE o.status IN ('accepted', 'rejected')), 0), 1), 0)", pct: true },
    },
    dims: {
      status: { label: L('Κατάσταση', 'Status'), sql: 'o.status' },
      owner: { label: L('Πωλητής', 'Salesperson'), sql: "coalesce(u.full_name, '—')" },
      customer: { label: L('Πελάτης', 'Customer'), sql: 'c.name' },
      category: { label: L('Κατηγορία πελάτη', 'Customer category'), sql: "coalesce(c.category, '—')" },
      region: { label: L('Νομός', 'Prefecture'), sql: "coalesce(c.address_region, '—')" },
      company: { label: L('Εταιρεία έκδοσης', 'Issuing company'), sql: "coalesce(co.name, '—')" },
      month: month('o.created_at'), week: week('o.created_at'), day: day('o.created_at'),
    },
    filters: { status: 'o.status', category: 'c.category', region: 'c.address_region' },
  },
  customers: {
    label: L('Πελάτες', 'Customers'),
    from: `customers c LEFT JOIN users u ON u.id = c.account_manager_id`,
    tenant: 'c.tenant_id', date: 'c.created_at', owner: 'c.account_manager_id', base: 'c.archived_at IS NULL',
    measures: {
      count: { label: L('Πλήθος', 'Count'), sql: 'count(*)' },
      sum_value: { label: L('Ετήσια αξία', 'Annual value'), sql: 'coalesce(sum(c.annual_value), 0)', money: true },
      avg_value: { label: L('Μέση ετήσια αξία', 'Average annual value'), sql: 'coalesce(avg(c.annual_value), 0)', money: true },
      stores: { label: L('Καταστήματα', 'Stores'), sql: 'coalesce(sum(c.branches_count), 0)' },
    },
    dims: {
      status: { label: L('Κατάσταση', 'Status'), sql: 'c.status' },
      category: { label: L('Κατηγορία', 'Category'), sql: "coalesce(c.category, '—')" },
      region: { label: L('Νομός', 'Prefecture'), sql: "coalesce(c.address_region, '—')" },
      city: { label: L('Πόλη', 'City'), sql: "coalesce(c.address_city, '—')" },
      source: { label: L('Πηγή', 'Source'), sql: "coalesce(c.source, '—')" },
      owner: { label: L('Account manager', 'Account manager'), sql: "coalesce(u.full_name, '—')" },
      kind: { label: L('Τύπος', 'Type'), sql: 'c.kind' },
      customer: { label: L('Πελάτης', 'Customer'), sql: 'c.name' },
      month: month('c.created_at'), week: week('c.created_at'),
    },
    filters: { status: 'c.status', category: 'c.category', region: 'c.address_region' },
  },
  activities: {
    label: L('Ενέργειες CRM', 'CRM activities'),
    from: `crm_activities a LEFT JOIN users u ON u.id = a.owner_id LEFT JOIN customers c ON c.id = a.customer_id
           LEFT JOIN crm_activity_types t ON t.tenant_id = a.tenant_id AND t.key = a.type LEFT JOIN crm_outcomes oc ON oc.tenant_id = a.tenant_id AND oc.key = a.outcome`,
    tenant: 'a.tenant_id', date: 'coalesce(a.completed_at, a.due_at, a.created_at)', owner: 'a.owner_id', restrictPerm: 'activities.all',
    measures: {
      count: { label: L('Πλήθος', 'Count'), sql: 'count(*)' },
      done: { label: L('Ολοκληρωμένες', 'Completed'), sql: "count(*) FILTER (WHERE a.status = 'done')" },
      overdue: { label: L('Καθυστερημένες', 'Overdue'), sql: "count(*) FILTER (WHERE a.status IN ('planned','in_progress') AND a.due_at < now())" },
      hours: { label: L('Ώρες', 'Hours'), sql: "round(coalesce(sum(a.duration_min) FILTER (WHERE a.status = 'done'), 0) / 60.0, 1)" },
      positive_rate: { label: L('Θετικά αποτελέσματα', 'Positive outcomes'), sql: "coalesce(round(100.0 * count(*) FILTER (WHERE oc.positive) / nullif(count(*) FILTER (WHERE a.status = 'done'), 0), 1), 0)", pct: true },
    },
    dims: {
      type: { label: L('Είδος', 'Type'), sql: 'coalesce(t.name, a.type)' },
      status: { label: L('Κατάσταση', 'Status'), sql: 'a.status' },
      outcome: { label: L('Αποτέλεσμα', 'Outcome'), sql: "coalesce(oc.name, '—')" },
      owner: { label: L('Υπεύθυνος', 'Owner'), sql: "coalesce(u.full_name, '—')" },
      customer: { label: L('Πελάτης', 'Customer'), sql: "coalesce(c.name, '—')" },
      month: month('coalesce(a.completed_at, a.due_at, a.created_at)'), week: week('coalesce(a.completed_at, a.due_at, a.created_at)'),
      day: day('coalesce(a.completed_at, a.due_at, a.created_at)'),
    },
    filters: { status: 'a.status', category: 'c.category', region: 'c.address_region' },
  },
  tasks: {
    label: L('Εργασίες', 'Tasks'),
    from: `tasks k LEFT JOIN users u ON u.id = k.owner_id LEFT JOIN customers c ON c.id = k.customer_id`,
    tenant: 'k.tenant_id', date: 'coalesce(k.completed_at, k.due_at, k.created_at)', owner: 'k.owner_id', restrictPerm: 'tasks.all',
    measures: {
      count: { label: L('Πλήθος', 'Count'), sql: 'count(*)' },
      done: { label: L('Ολοκληρωμένες', 'Completed'), sql: "count(*) FILTER (WHERE k.status = 'done')" },
      open: { label: L('Ανοιχτές', 'Open'), sql: "count(*) FILTER (WHERE k.status NOT IN ('done','cancelled'))" },
      overdue: { label: L('Καθυστερημένες', 'Overdue'), sql: "count(*) FILTER (WHERE k.status NOT IN ('done','cancelled') AND k.due_at < now())" },
      on_time: { label: L('Εμπρόθεσμες', 'On time'), sql: "coalesce(round(100.0 * count(*) FILTER (WHERE k.status = 'done' AND (k.due_at IS NULL OR k.completed_at <= k.due_at)) / nullif(count(*) FILTER (WHERE k.status = 'done'), 0), 1), 0)", pct: true },
    },
    dims: {
      status: { label: L('Κατάσταση', 'Status'), sql: 'k.status' },
      priority: { label: L('Προτεραιότητα', 'Priority'), sql: "k.priority::text" },
      owner: { label: L('Υπεύθυνος', 'Assignee'), sql: "coalesce(u.full_name, '—')" },
      customer: { label: L('Πελάτης', 'Customer'), sql: "coalesce(c.name, '—')" },
      month: month('coalesce(k.completed_at, k.due_at, k.created_at)'), week: week('coalesce(k.completed_at, k.due_at, k.created_at)'),
    },
    filters: { status: 'k.status', category: 'c.category', region: 'c.address_region' },
  },
  stores: {
    label: L('Καταστήματα & χώροι', 'Stores & spaces'),
    from: `branches b JOIN customers c ON c.id = b.customer_id LEFT JOIN users u ON u.id = c.account_manager_id
           LEFT JOIN lookup_values gz ON gz.id = b.geo_zone_id LEFT JOIN lookup_values os ON os.id = b.ongoing_status_id`,
    tenant: 'b.tenant_id', date: 'b.created_at', owner: 'c.account_manager_id', base: 'c.archived_at IS NULL',
    measures: {
      count: { label: L('Καταστήματα', 'Stores'), sql: 'count(*)' },
      spaces: { label: L('Χώροι', 'Spaces'), sql: 'coalesce(sum(b.spaces_count), 0)' },
      customers: { label: L('Πελάτες', 'Customers'), sql: 'count(DISTINCT b.customer_id)' },
    },
    dims: {
      region: { label: L('Νομός', 'Prefecture'), sql: "coalesce(b.region, '—')" },
      city: { label: L('Πόλη', 'City'), sql: "coalesce(b.city, '—')" },
      geo_zone: { label: L('Γεωγραφική ζώνη', 'Geographic zone'), sql: "coalesce(gz.name, '—')" },
      ongoing_status: { label: L('Status on going', 'Status on going'), sql: "coalesce(os.name, '—')" },
      status: { label: L('Κατάσταση', 'Status'), sql: 'b.status' },
      seasonality: { label: L('Εποχικότητα', 'Seasonality'), sql: 'b.seasonality' },
      customer: { label: L('Πελάτης', 'Customer'), sql: 'c.name' },
      owner: { label: L('Account manager', 'Account manager'), sql: "coalesce(u.full_name, '—')" },
      month: month('b.created_at'),
    },
    filters: { status: 'b.status', category: 'c.category', region: 'b.region' },
  },
};

export const definitionSchema = z.object({
  source: z.enum(Object.keys(SOURCES) as [string, ...string[]]),
  measure: z.string().max(40),
  group: z.string().max(40).default('none'),
  period: z.object({ preset: z.enum(['7d', '30d', '90d', 'month', 'last_month', 'quarter', 'year', 'last_year', 'all', 'custom']).default('30d'),
    from: z.string().optional(), to: z.string().optional() }).default({ preset: '30d' }),
  compare: z.boolean().default(false),
  filters: z.object({ owner: z.string().uuid().optional(), status: z.string().max(40).optional(), category: z.string().max(80).optional(), region: z.string().max(80).optional() }).default({}),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  chart: z.enum(['bar', 'column', 'line', 'table', 'kpi', 'pie']).default('bar'),
}).refine((d) => SOURCES[d.source].measures[d.measure], { message: 'invalid_measure', path: ['measure'] })
  .refine((d) => d.group === 'none' || SOURCES[d.source].dims[d.group], { message: 'invalid_group', path: ['group'] });
export type Definition = z.infer<typeof definitionSchema>;

/** Period → [from, to) and the previous period of the same length. */
export function periodOf(p: Definition['period'], now = new Date()) {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (d: Date, days: number) => new Date(d.getTime() + days * 864e5);
  let from: Date | null, to: Date;
  switch (p.preset) {
    case '7d': to = add(d0, 1); from = add(to, -7); break;
    case '30d': to = add(d0, 1); from = add(to, -30); break;
    case '90d': to = add(d0, 1); from = add(to, -90); break;
    case 'month': from = new Date(now.getFullYear(), now.getMonth(), 1); to = new Date(now.getFullYear(), now.getMonth() + 1, 1); break;
    case 'last_month': from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'quarter': { const q = Math.floor(now.getMonth() / 3) * 3; from = new Date(now.getFullYear(), q, 1); to = new Date(now.getFullYear(), q + 3, 1); break; }
    case 'year': from = new Date(now.getFullYear(), 0, 1); to = new Date(now.getFullYear() + 1, 0, 1); break;
    case 'last_year': from = new Date(now.getFullYear() - 1, 0, 1); to = new Date(now.getFullYear(), 0, 1); break;
    case 'all': from = null; to = add(d0, 1); break;
    default: from = p.from ? new Date(`${p.from}T00:00:00`) : add(d0, -30); to = p.to ? add(new Date(`${p.to}T00:00:00`), 1) : add(d0, 1);
  }
  const len = from ? to.getTime() - from.getTime() : 0;
  const prev = from ? { from: new Date(from.getTime() - len), to: from } : null;
  return { from, to, prev };
}

export type Viewer = { tenantId: string; userId: string; perms: (p: string) => boolean };
export type Result = {
  rows: { label: string; value: number; prev?: number }[]; total: number; prev_total?: number;
  period: { from: string | null; to: string }; prev_period?: { from: string; to: string } | null;
  measure: { money?: boolean; pct?: boolean }; time: boolean; generated_at: string;
};

const cache = new Map<string, { at: number; r: Result }>();

export async function runReport(db: Db, v: Viewer, def: Definition): Promise<Result> {
  const src = SOURCES[def.source];
  const m = src.measures[def.measure];
  const dim = def.group === 'none' ? null : src.dims[def.group];
  const restrict = src.restrictPerm && !v.perms(src.restrictPerm);
  const key = JSON.stringify([v.tenantId, restrict ? v.userId : '', def]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.r;
  const p = periodOf(def.period);
  const u = db.unsafe.bind(db) as unknown as (s: string) => postgres.PendingQuery<postgres.Row[]>;
  const where = (from: Date | null, to: Date) => db`
    ${u(src.tenant)} = ${v.tenantId}
    ${src.base ? db`AND ${u(src.base)}` : db``}
    ${from ? db`AND ${u(src.date)} >= ${from}` : db``} AND ${u(src.date)} < ${to}
    ${restrict ? db`AND ${u(src.owner)} = ${v.userId}` : def.filters.owner ? db`AND ${u(src.owner)} = ${def.filters.owner}` : db``}
    ${def.filters.status && src.filters.status ? db`AND ${u(src.filters.status)} = ${def.filters.status}` : db``}
    ${def.filters.category && src.filters.category ? db`AND ${u(src.filters.category)} = ${def.filters.category}` : db``}
    ${def.filters.region && src.filters.region ? db`AND ${u(src.filters.region)} = ${def.filters.region}` : db``}`;
  const grouped = async (from: Date | null, to: Date) => dim
    ? db`SELECT ${u(dim.sql)} AS label, (${u(m.sql)})::float8 AS value FROM ${u(src.from)} WHERE ${where(from, to)}
         GROUP BY 1 ORDER BY ${dim.time ? db`1` : db`2 DESC, 1`} LIMIT ${dim.time ? 400 : def.limit}`
    : [];
  const total = async (from: Date | null, to: Date) => Number((await db`SELECT (${u(m.sql)})::float8 AS value FROM ${u(src.from)} WHERE ${where(from, to)}`)[0]?.value ?? 0);

  const [rows, tot] = await Promise.all([grouped(p.from, p.to), total(p.from, p.to)]);
  let out = rows.map((r) => ({ label: String(r.label), value: Number(r.value) }));
  let prevTotal: number | undefined;
  if (def.compare && p.prev) {
    prevTotal = await total(p.prev.from, p.prev.to);
    if (dim && !dim.time) {
      const pr = new Map((await grouped(p.prev.from, p.prev.to)).map((r) => [String(r.label), Number(r.value)]));
      out = out.map((r) => ({ ...r, prev: pr.get(r.label) ?? 0 }));
    }
  }
  const r: Result = {
    rows: out, total: tot, prev_total: prevTotal,
    period: { from: p.from?.toISOString() ?? null, to: p.to.toISOString() },
    prev_period: def.compare && p.prev ? { from: p.prev.from.toISOString(), to: p.prev.to.toISOString() } : null,
    measure: { money: m.money, pct: m.pct }, time: !!dim?.time, generated_at: new Date().toISOString(),
  };
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), r });
  return r;
}

/** Ready-made reports. */
const P = (key: string, group: string, name: L, def: Partial<Definition> & Pick<Definition, 'source' | 'measure'>) => ({ key, group, name, definition: { group: 'none', period: { preset: '90d' }, compare: true, filters: {}, limit: 20, chart: 'bar', ...def } });
export const PRESETS = [
  P('sales_by_status', 'sales', L('Προσφορές ανά κατάσταση (αξία)', 'Offers by status (value)'), { source: 'offers', measure: 'sum_value', group: 'status', chart: 'bar' }),
  P('sales_trend', 'sales', L('Αξία προσφορών ανά μήνα', 'Offer value per month'), { source: 'offers', measure: 'sum_value', group: 'month', period: { preset: 'year' }, chart: 'column', compare: false }),
  P('pipeline_by_owner', 'sales', L('Pipeline ανά πωλητή', 'Pipeline by salesperson'), { source: 'offers', measure: 'sum_value', group: 'owner', chart: 'bar' }),
  P('win_rate_by_owner', 'sales', L('Ποσοστό επιτυχίας ανά πωλητή', 'Win rate by salesperson'), { source: 'offers', measure: 'win_rate', group: 'owner', chart: 'bar' }),
  P('win_rate_trend', 'sales', L('Ποσοστό επιτυχίας ανά μήνα', 'Win rate per month'), { source: 'offers', measure: 'win_rate', group: 'month', period: { preset: 'year' }, chart: 'line', compare: false }),
  P('won_value', 'sales', L('Κερδισμένη αξία', 'Won value'), { source: 'offers', measure: 'won_value', chart: 'kpi' }),
  P('offers_by_category', 'sales', L('Προσφορές ανά κατηγορία πελάτη', 'Offers by customer category'), { source: 'offers', measure: 'sum_value', group: 'category', chart: 'bar' }),
  P('new_customers', 'customers', L('Νέοι πελάτες ανά μήνα', 'New customers per month'), { source: 'customers', measure: 'count', group: 'month', period: { preset: 'year' }, chart: 'column', compare: false }),
  P('customers_by_category', 'customers', L('Πελάτες ανά κατηγορία', 'Customers by category'), { source: 'customers', measure: 'count', group: 'category', period: { preset: 'all' }, chart: 'bar', compare: false }),
  P('customers_by_region', 'customers', L('Πελάτες ανά νομό', 'Customers by prefecture'), { source: 'customers', measure: 'count', group: 'region', period: { preset: 'all' }, chart: 'bar', compare: false }),
  P('top_customers', 'customers', L('Κορυφαίοι πελάτες (ετήσια αξία)', 'Top customers (annual value)'), { source: 'customers', measure: 'sum_value', group: 'customer', period: { preset: 'all' }, chart: 'bar', compare: false, limit: 15 }),
  P('customers_by_status', 'customers', L('Πελάτες ανά κατάσταση', 'Customers by status'), { source: 'customers', measure: 'count', group: 'status', period: { preset: 'all' }, chart: 'bar', compare: false }),
  P('activities_by_type', 'activity', L('Ενέργειες ανά είδος', 'Activities by type'), { source: 'activities', measure: 'done', group: 'type', period: { preset: '30d' }, chart: 'bar' }),
  P('activities_by_owner', 'activity', L('Ενέργειες ανά χρήστη', 'Activities by user'), { source: 'activities', measure: 'done', group: 'owner', period: { preset: '30d' }, chart: 'bar' }),
  P('activities_trend', 'activity', L('Ολοκληρωμένες ενέργειες ανά εβδομάδα', 'Completed activities per week'), { source: 'activities', measure: 'done', group: 'week', period: { preset: '90d' }, chart: 'column', compare: false }),
  P('tasks_by_status', 'activity', L('Εργασίες ανά κατάσταση', 'Tasks by status'), { source: 'tasks', measure: 'count', group: 'status', period: { preset: '90d' }, chart: 'bar', compare: false }),
  P('tasks_by_owner', 'activity', L('Ανοιχτές & καθυστερημένες εργασίες ανά χρήστη', 'Open tasks by user'), { source: 'tasks', measure: 'open', group: 'owner', period: { preset: 'all' }, chart: 'bar', compare: false }),
  P('stores_by_region', 'stores', L('Καταστήματα ανά νομό', 'Stores by prefecture'), { source: 'stores', measure: 'count', group: 'region', period: { preset: 'all' }, chart: 'bar', compare: false }),
  P('spaces_by_zone', 'stores', L('Χώροι ανά γεωγραφική ζώνη', 'Spaces by geographic zone'), { source: 'stores', measure: 'spaces', group: 'geo_zone', period: { preset: 'all' }, chart: 'bar', compare: false }),
  P('stores_by_status', 'stores', L('Καταστήματα ανά status on going', 'Stores by ongoing status'), { source: 'stores', measure: 'count', group: 'ongoing_status', period: { preset: 'all' }, chart: 'bar', compare: false }),
];

/** Builder catalogue for the UI. */
export const catalogue = () => Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, {
  label: s.label, filters: Object.keys(s.filters),
  measures: Object.fromEntries(Object.entries(s.measures).map(([mk, m]) => [mk, { label: m.label, money: !!m.money, pct: !!m.pct }])),
  dims: Object.fromEntries(Object.entries(s.dims).map(([dk, d]) => [dk, { label: d.label, time: !!d.time }])),
}]));

/** Next delivery time of a schedule (local server time). */
export function nextRun(s: { freq: 'daily' | 'weekly' | 'monthly'; weekday?: number; day?: number; hour: number }, from = new Date()) {
  const d = new Date(from); d.setMinutes(0, 0, 0); d.setHours(s.hour);
  if (s.freq === 'daily') { if (d <= from) d.setDate(d.getDate() + 1); return d; }
  if (s.freq === 'weekly') {
    const want = ((s.weekday ?? 1) % 7);   // 1 = Monday … 7 = Sunday
    while (d.getDay() !== want || d <= from) d.setDate(d.getDate() + 1);
    return d;
  }
  d.setDate(Math.min(s.day ?? 1, 28));
  if (d <= from) { d.setMonth(d.getMonth() + 1); d.setDate(Math.min(s.day ?? 1, 28)); }
  return d;
}
