// CRM activities module: list (list / kanban / agenda), counts, create (recurring), edit, complete with follow-up,
// bulk actions, export, reports, settings (types, outcomes, templates, automation rules) and the iCal feed.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { decodeCursor, encodeCursor, likeAny, searchPatterns, sql, withTenant, type Tx } from '../db.js';
import { can, requireAuth, type Session } from '../auth.js';
import { audit } from './settings.js';
import { publish } from '../realtime.js';
import { applyForm } from '../forms.js';
import {
  activityOut, emitActivityEvents, insertActivity, OPEN, remindAt, runRules, STATUSES, type NewActivity, type Row,
} from '../crm.js';

const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });
const idParam = z.object({ id: z.string().uuid() });
const uuidN = z.string().uuid().nullish().transform((v) => v ?? null);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const by = (s: Session) => ({ type: 'user' as const, user_id: s.userId });
const all = (s: Session) => can(s, 'activities.all');

const recurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']), interval: z.coerce.number().int().min(1).max(30).default(1),
  count: z.coerce.number().int().min(2).max(100).optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).nullish();
const activitySchema = z.object({
  type: z.string().trim().min(1).max(40),
  subject: z.string().trim().min(1).max(200),
  body: optText(20000),
  status: z.enum(STATUSES).default('planned'),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  due_at: z.coerce.date().nullish().transform((v) => v ?? null),
  duration_min: z.coerce.number().int().min(0).max(10080).default(0),
  all_day: z.boolean().default(false),
  location: optText(300),
  owner_id: uuidN,
  customer_id: uuidN, branch_id: uuidN, contact_id: uuidN, offer_id: uuidN,
  outcome: optText(40), outcome_note: optText(5000),
  remind_before_min: z.coerce.number().int().min(0).max(10080).nullish().transform((v) => (v === undefined ? null : v)),
  recurrence: recurrenceSchema,
  parent_id: uuidN,
  custom: z.record(z.string().max(40), z.any()).optional(),
  // As in the ERP (Soft1): end, requester, characterisation and ERP status
  ends_at: z.coerce.date().nullish().transform((v) => v ?? null),
  requested_by: uuidN,
  characterization: optText(40),
  erp_status: optText(40),
});
type ActivityInput = z.infer<typeof activitySchema>;

/** Links must agree (store/contact/offer of the same customer); fills the customer from them. */
async function checkLinks(tx: Tx, T: string, a: ActivityInput) {
  if (a.branch_id) {
    const [b] = await tx`SELECT customer_id FROM branches WHERE id = ${a.branch_id}`;
    if (!b) return 'branch_not_found';
    if (a.customer_id && a.customer_id !== b.customer_id) return 'branch_other_customer';
    a.customer_id = b.customer_id;
  }
  if (a.contact_id) {
    const [c] = await tx`SELECT customer_id FROM contacts WHERE id = ${a.contact_id}`;
    if (!c) return 'contact_not_found';
    if (a.customer_id && a.customer_id !== c.customer_id) return 'contact_other_customer';
    a.customer_id = c.customer_id;
  }
  if (a.offer_id) {
    const [o] = await tx`SELECT customer_id FROM offers WHERE id = ${a.offer_id}`;
    if (!o) return 'offer_not_found';
    if (a.customer_id && a.customer_id !== o.customer_id) return 'offer_other_customer';
    a.customer_id = o.customer_id;
  }
  if (a.customer_id && !(await tx`SELECT 1 FROM customers WHERE id = ${a.customer_id}`)[0]) return 'customer_not_found';
  if (!(await tx`SELECT 1 FROM crm_activity_types WHERE tenant_id = ${T} AND key = ${a.type}`)[0]) return 'invalid_type';
  if (a.outcome && !(await tx`SELECT 1 FROM crm_outcomes WHERE tenant_id = ${T} AND key = ${a.outcome}`)[0]) return 'invalid_outcome';
  if (a.owner_id && !(await tx`SELECT 1 FROM memberships WHERE tenant_id = ${T} AND user_id = ${a.owner_id}`)[0]) return 'owner_not_member';
  if (a.requested_by && !(await tx`SELECT 1 FROM memberships WHERE tenant_id = ${T} AND user_id = ${a.requested_by}`)[0]) return 'requester_not_member';
  if (a.characterization && !(await tx`SELECT 1 FROM crm_erp_values WHERE tenant_id = ${T} AND kind = 'characterization' AND code = ${a.characterization}`)[0]) return 'invalid_characterization';
  if (a.erp_status && !(await tx`SELECT 1 FROM crm_erp_values WHERE tenant_id = ${T} AND kind = 'status' AND code = ${a.erp_status}`)[0]) return 'invalid_erp_status';
  if (a.ends_at && a.due_at && a.ends_at < a.due_at) return 'ends_before_start';
  return null;
}

/** Can this user change this activity? (own or assigned, or "all activities" permission) */
const mayEdit = (s: Session, row: Row) => all(s) || row.owner_id === s.userId || row.created_by === s.userId;

// ---------------------------------------------------------------- list filters
const listQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  owner: z.string().uuid().optional(),
  status: z.enum(['open', 'planned', 'in_progress', 'done', 'cancelled', 'any']).default('open'),
  due: z.enum(['overdue', 'today', 'tomorrow', 'week', 'upcoming', 'nodate', 'range']).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  type: z.string().max(400).optional(),
  outcome: z.string().max(400).optional(),
  characterization: z.string().max(400).optional(),
  erp_status: z.string().max(400).optional(),
  priority: z.coerce.number().int().min(1).max(3).optional(),
  customer_id: z.string().uuid().optional(),
  offer_id: z.string().uuid().optional(),
  auto: z.enum(['0', '1']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['due', 'due_desc', 'created', 'updated', 'completed']).default('due'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type ListQ = z.infer<typeof listQuery>;

async function tenantTz(tx: Tx, T: string) {
  const [t] = await tx`SELECT timezone FROM tenants WHERE id = ${T}`;
  return (t?.timezone as string) || 'Europe/Athens';
}

function whereSql(tx: Tx, s: Session, q: ListQ, tz: string) {
  const parts = [] as ReturnType<typeof tx>[];
  const mine = q.scope === 'mine' || !all(s);
  if (q.owner && all(s)) parts.push(tx`a.owner_id = ${q.owner}`);
  else if (mine) parts.push(tx`(a.owner_id = ${s.userId} OR (a.owner_id IS NULL AND a.created_by = ${s.userId}))`);
  if (q.status === 'open') parts.push(tx`a.status IN ('planned', 'in_progress')`);
  else if (q.status !== 'any') parts.push(tx`a.status = ${q.status}`);
  const day0 = tx`(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  switch (q.due) {
    case 'overdue': parts.push(tx`a.due_at < now() AND a.status IN ('planned', 'in_progress')`); break;
    case 'today': parts.push(tx`a.due_at >= ${day0} AND a.due_at < ${day0} + interval '1 day'`); break;
    case 'tomorrow': parts.push(tx`a.due_at >= ${day0} + interval '1 day' AND a.due_at < ${day0} + interval '2 days'`); break;
    case 'week': parts.push(tx`a.due_at >= ${day0} AND a.due_at < ${day0} + interval '7 days'`); break;
    case 'upcoming': parts.push(tx`a.due_at >= now()`); break;
    case 'nodate': parts.push(tx`a.due_at IS NULL`); break;
    case 'range':
      if (q.from) parts.push(tx`a.due_at >= ${q.from}`);
      if (q.to) parts.push(tx`a.due_at < ${q.to}`);
      break;
  }
  const list = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30) : []);
  if (list(q.type).length) parts.push(tx`a.type = ANY(${list(q.type)})`);
  if (list(q.outcome).length) parts.push(tx`a.outcome = ANY(${list(q.outcome)})`);
  if (list(q.characterization).length) parts.push(tx`a.characterization = ANY(${list(q.characterization)})`);
  if (list(q.erp_status).length) parts.push(tx`a.erp_status = ANY(${list(q.erp_status)})`);
  if (q.priority) parts.push(tx`a.priority = ${q.priority}`);
  if (q.customer_id) parts.push(tx`a.customer_id = ${q.customer_id}`);
  if (q.offer_id) parts.push(tx`a.offer_id = ${q.offer_id}`);
  if (q.auto === '1') parts.push(tx`a.rule_id IS NOT NULL`);
  if (q.q && q.q.length >= 2) {
    const k = searchPatterns(q.q);
    parts.push(tx`(${likeAny(tx, 'a.search', k)} OR a.customer_id IN (SELECT id FROM customers WHERE tenant_id = ${s.tenantId} AND (${likeAny(tx, 'search', k)})))`);
  }
  return parts.reduce((acc, p) => tx`${acc} AND ${p}`, tx``);
}

const SORTS = {
  due: { expr: "coalesce(a.due_at, 'infinity'::timestamptz)", dir: 'ASC' },
  due_desc: { expr: "coalesce(a.due_at, '-infinity'::timestamptz)", dir: 'DESC' },
  created: { expr: 'a.created_at', dir: 'DESC' },
  updated: { expr: 'a.updated_at', dir: 'DESC' },
  completed: { expr: "coalesce(a.completed_at, '-infinity'::timestamptz)", dir: 'DESC' },
} as const;

export default async function crmRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- public iCal feed (token = the key)
  app.get('/crm/ical/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,80}(\.ics)?$/) }).parse(req.params);
    const [t] = await sql`SELECT tenant_id, user_id FROM crm_ical_tokens WHERE token = ${token.replace(/\.ics$/, '')}`;
    if (!t) return reply.code(404).send('not found');
    const rows = await sql`
      SELECT a.id, a.subject, a.body, a.location, a.due_at, a.duration_min, a.all_day, a.status, a.updated_at, ty.name AS type_name, c.name AS customer_name
      FROM crm_activities a LEFT JOIN crm_activity_types ty ON ty.tenant_id = a.tenant_id AND ty.key = a.type LEFT JOIN customers c ON c.id = a.customer_id
      WHERE a.tenant_id = ${t.tenant_id} AND a.owner_id = ${t.user_id} AND a.due_at IS NOT NULL
        AND a.due_at > now() - interval '90 days' AND a.due_at < now() + interval '365 days' AND a.status <> 'cancelled'
      ORDER BY a.due_at LIMIT 2000`;
    const esc = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const ts = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const fold = (line: string) => line.match(/.{1,73}/gu)?.join('\r\n ') ?? line;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SoftifyOS//CRM//EL', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:SoftifyOS', 'REFRESH-INTERVAL;VALUE=DURATION:PT30M'];
    for (const r of rows) {
      const start = new Date(r.due_at), end = new Date(start.getTime() + Math.max(15, r.duration_min || 30) * 60_000);
      lines.push('BEGIN:VEVENT', `UID:${r.id}@softifyos`, `DTSTAMP:${ts(new Date(r.updated_at))}`,
        r.all_day ? `DTSTART;VALUE=DATE:${day(start)}` : `DTSTART:${ts(start)}`,
        r.all_day ? `DTEND;VALUE=DATE:${day(new Date(start.getTime() + 864e5))}` : `DTEND:${ts(end)}`,
        fold(`SUMMARY:${esc(`${r.status === 'done' ? '✓ ' : ''}${r.type_name ? `${r.type_name}: ` : ''}${r.subject}${r.customer_name ? ` · ${r.customer_name}` : ''}`)}`),
        ...(r.location ? [fold(`LOCATION:${esc(r.location)}`)] : []),
        ...(r.body ? [fold(`DESCRIPTION:${esc(r.body)}`)] : []),
        `STATUS:${r.status === 'done' ? 'CONFIRMED' : 'TENTATIVE'}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.type('text/calendar; charset=utf-8').send(lines.join('\r\n'));
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    // ---- what the screens need: types, outcomes, templates, people, permissions
    r.get('/crm/meta', async (req) => {
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => ({
        types: await tx`SELECT key, name, icon, color, default_duration, sort, active FROM crm_activity_types WHERE tenant_id = ${s.tenantId} ORDER BY sort, name`,
        outcomes: await tx`SELECT key, name, color, positive, sort, active FROM crm_outcomes WHERE tenant_id = ${s.tenantId} ORDER BY sort, name`,
        templates: await tx`SELECT id, name, type, subject, body, priority, duration_min, due_in_days, remind_before_min FROM crm_templates WHERE tenant_id = ${s.tenantId} ORDER BY sort, name`,
        users: await tx`SELECT u.id, u.full_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} ORDER BY u.full_name`,
        erp_values: await tx`SELECT kind, code, name, active, maps_to, types, sort FROM crm_erp_values WHERE tenant_id = ${s.tenantId} ORDER BY kind, sort, code`,
        erp: await tx`SELECT coalesce((erp_meta->>'enabled')::boolean, false) AS enabled, erp_meta->>'provider' AS provider FROM tenants WHERE id = ${s.tenantId}`.then((r) => r[0]),
        timezone: await tenantTz(tx, s.tenantId),
        can: { all: all(s), edit: can(s, 'customers.edit'), manage: can(s, 'settings.manage') },
        me: s.userId,
      }));
    });

    // ---- list
    r.get('/crm/activities', async (req) => {
      const q = listQuery.parse(req.query);
      const s = req.session;
      const sort = SORTS[q.sort];
      const cur = decodeCursor<[string, string]>(q.cursor);
      return withTenant(s.tenantId, async (tx) => {
        const tz = await tenantTz(tx, s.tenantId);
        const key = tx.unsafe(sort.expr);
        const rows = await tx`
          ${activityOut(tx, s.tenantId)} ${whereSql(tx, s, q, tz)}
          ${cur ? (sort.dir === 'ASC'
            ? tx`AND (${key}, a.id) > (${cur[0]}::timestamptz, ${cur[1]}::uuid)`
            : tx`AND (${key}, a.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)`) : tx``}
          ORDER BY ${key} ${tx.unsafe(sort.dir)}, a.id ${tx.unsafe(sort.dir)}
          LIMIT ${q.limit + 1}`;
        const more = rows.length > q.limit;
        const items = more ? rows.slice(0, q.limit) : rows;
        const l = items.at(-1);
        const kv = (x: Row) => {
          const v = q.sort === 'due' ? x.due_at ?? 'infinity' : q.sort === 'due_desc' ? x.due_at ?? '-infinity' : q.sort === 'completed' ? x.completed_at ?? '-infinity' : q.sort === 'created' ? x.created_at : x.updated_at;
          return v instanceof Date ? v.toISOString() : String(v);
        };
        return { items, next_cursor: more && l ? encodeCursor([kv(l), l.id]) : null };
      });
    });

    // ---- counters for the chips (same scope rules)
    r.get('/crm/activities/counts', async (req) => {
      const q = listQuery.pick({ scope: true, owner: true }).parse(req.query);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const tz = await tenantTz(tx, s.tenantId);
        const day0 = tx`(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
        const scope = q.owner && all(s) ? tx`AND owner_id = ${q.owner}`
          : q.scope === 'mine' || !all(s) ? tx`AND (owner_id = ${s.userId} OR (owner_id IS NULL AND created_by = ${s.userId}))` : tx``;
        const [c] = await tx`
          SELECT count(*) FILTER (WHERE status IN ('planned','in_progress'))::int AS open,
                 count(*) FILTER (WHERE status IN ('planned','in_progress') AND due_at < now())::int AS overdue,
                 count(*) FILTER (WHERE status IN ('planned','in_progress') AND due_at >= ${day0} AND due_at < ${day0} + interval '1 day')::int AS today,
                 count(*) FILTER (WHERE status IN ('planned','in_progress') AND due_at >= ${day0} AND due_at < ${day0} + interval '7 days')::int AS week,
                 count(*) FILTER (WHERE status IN ('planned','in_progress') AND due_at IS NULL)::int AS nodate,
                 count(*) FILTER (WHERE status = 'done' AND completed_at >= ${day0})::int AS done_today,
                 count(*) FILTER (WHERE status = 'done' AND completed_at >= ${day0} - interval '6 days')::int AS done_week
          FROM crm_activities WHERE tenant_id = ${s.tenantId} ${scope}`;
        return c;
      });
    });

    r.get('/crm/activities/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const [a] = await tx`${activityOut(tx, s.tenantId)} AND a.id = ${id}`;
        if (!a) return reply.code(404).send({ error: 'not_found' });
        const followUps = await tx`SELECT id, subject, status, due_at FROM crm_activities WHERE parent_id = ${id} ORDER BY due_at NULLS LAST LIMIT 20`;
        const series = a.series_id ? await tx`SELECT id, due_at, status FROM crm_activities WHERE series_id = ${a.series_id} ORDER BY due_at LIMIT 100` : [];
        return { ...a, follow_ups: followUps, series, can_edit: mayEdit(s, a) && can(s, 'customers.edit') };
      });
    });

    // ---- create
    r.post('/crm/activities', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const a = activitySchema.parse(req.body);
      if (a.owner_id && a.owner_id !== s.userId && !all(s)) return forbid(reply);
      const res = await withTenant(s.tenantId, async (tx) => {
        const err = await checkLinks(tx, s.tenantId, a);
        if (err) return { code: 400, body: { error: err } };
        const [parent] = a.customer_id ? await tx`SELECT * FROM customers WHERE id = ${a.customer_id}` : [null];
        const fields = await applyForm(tx, s, 'activity', a as unknown as Row, null, parent);
        if (Object.keys(fields).length) return { code: 400, body: { error: 'validation', fields } };
        const ids = await insertActivity(tx, s.tenantId, s.userId, { ...(a as NewActivity), owner_id: a.owner_id ?? s.userId });
        await emitActivityEvents(tx, s.tenantId, a.status === 'done' ? 'completed' : 'created', ids, by(s));
        if (a.status === 'done') {
          const [row] = await tx`SELECT * FROM crm_activities WHERE id = ${ids[0]}`;
          await runRules(tx, s.tenantId, 'activity_done', { customer_id: a.customer_id, actor_id: s.userId, activity: row });
        }
        return { code: 201, body: { id: ids[0], created: ids.length } };
      });
      if (res.code === 201) await publish({ tenantId: s.tenantId, type: 'crm.changed', data: {} });
      return reply.code(res.code).send(res.body);
    });

    // ---- update (one, or this and the following occurrences of a series)
    r.put('/crm/activities/:id', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const { apply } = z.object({ apply: z.enum(['one', 'following']).default('one') }).parse(req.query);
      const a = activitySchema.parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM crm_activities WHERE id = ${id} FOR UPDATE`;
        if (!old) return { code: 404, body: { error: 'not_found' } };
        if (!mayEdit(s, old)) return { code: 403, body: { error: 'forbidden' } };
        if (a.owner_id && a.owner_id !== old.owner_id && a.owner_id !== s.userId && !all(s)) return { code: 403, body: { error: 'forbidden' } };
        const err = await checkLinks(tx, s.tenantId, a);
        if (err) return { code: 400, body: { error: err } };
        const fields = await applyForm(tx, s, 'activity', a as unknown as Row, old);
        if (Object.keys(fields).length) return { code: 400, body: { error: 'validation', fields } };
        const becameDone = a.status === 'done' && old.status !== 'done';
        const cols = {
          type: a.type, subject: a.subject, body: a.body, status: a.status, priority: a.priority, due_at: a.due_at, duration_min: a.duration_min,
          all_day: a.all_day, location: a.location, owner_id: a.owner_id ?? old.owner_id, customer_id: a.customer_id, branch_id: a.branch_id,
          contact_id: a.contact_id, offer_id: a.offer_id, outcome: a.outcome, outcome_note: a.outcome_note, remind_before_min: a.remind_before_min,
          remind_at: remindAt(a.due_at, a.remind_before_min, a.status),
          reminded: old.reminded && (old.due_at?.getTime?.() === a.due_at?.getTime()) && old.remind_before_min === a.remind_before_min,
          completed_at: a.status === 'done' ? old.completed_at ?? new Date() : null,
          completed_by: a.status === 'done' ? old.completed_by ?? s.userId : null,
          custom: tx.json(((a.custom ?? old.custom) ?? {}) as never),
          ends_at: a.ends_at, requested_by: a.requested_by, characterization: a.characterization, erp_status: a.erp_status,
        };
        await tx`UPDATE crm_activities SET ${tx(cols as never)}, updated_at = now() WHERE id = ${id}`;
        const ids = [id];
        if (apply === 'following' && old.series_id) {
          // Same changes (not the date) for the later occurrences that are still open
          const later = await tx`
            UPDATE crm_activities SET type = ${a.type}, subject = ${a.subject}, body = ${a.body}, priority = ${a.priority}, duration_min = ${a.duration_min},
                   location = ${a.location}, owner_id = ${cols.owner_id}, remind_before_min = ${a.remind_before_min},
                   remind_at = CASE WHEN ${a.remind_before_min}::int IS NULL OR due_at IS NULL THEN NULL ELSE due_at - (${a.remind_before_min ?? 0} * interval '1 minute') END,
                   reminded = false, updated_at = now()
            WHERE series_id = ${old.series_id} AND id <> ${id} AND due_at > ${old.due_at} AND status IN ('planned', 'in_progress') RETURNING id`;
          ids.push(...later.map((x) => x.id as string));
        }
        await emitActivityEvents(tx, s.tenantId, becameDone ? 'completed' : 'updated', ids, by(s));
        if (becameDone) {
          const [row] = await tx`SELECT * FROM crm_activities WHERE id = ${id}`;
          await runRules(tx, s.tenantId, 'activity_done', { customer_id: row.customer_id, actor_id: s.userId, activity: row });
        }
        return { code: 200, body: { ok: true, updated: ids.length } };
      });
      if (res.code === 200) await publish({ tenantId: s.tenantId, type: 'crm.changed', data: {} });
      return reply.code(res.code).send(res.body);
    });

    // ---- complete (outcome, note, actual duration) + optional follow-up
    r.post('/crm/activities/:id/complete', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = z.object({
        outcome: optText(40), outcome_note: optText(5000),
        duration_min: z.coerce.number().int().min(0).max(10080).optional(),
        follow_up: z.object({
          type: z.string().trim().min(1).max(40), subject: z.string().trim().min(1).max(200), body: optText(20000),
          due_at: z.coerce.date().nullish().transform((v) => v ?? null), owner_id: uuidN,
          priority: z.coerce.number().int().min(1).max(3).default(2),
          remind_before_min: z.coerce.number().int().min(0).max(10080).nullish().transform((v) => (v === undefined ? null : v)),
        }).nullish(),
      }).parse(req.body ?? {});
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM crm_activities WHERE id = ${id} FOR UPDATE`;
        if (!old) return { code: 404, body: { error: 'not_found' } };
        if (!mayEdit(s, old)) return { code: 403, body: { error: 'forbidden' } };
        if (b.outcome && !(await tx`SELECT 1 FROM crm_outcomes WHERE tenant_id = ${s.tenantId} AND key = ${b.outcome}`)[0]) return { code: 400, body: { error: 'invalid_outcome' } };
        await tx`
          UPDATE crm_activities SET status = 'done', outcome = ${b.outcome}, outcome_note = ${b.outcome_note},
                 duration_min = ${b.duration_min ?? old.duration_min}, completed_at = now(), completed_by = ${s.userId},
                 due_at = coalesce(due_at, now()), remind_at = NULL, updated_at = now()
          WHERE id = ${id}`;
        await emitActivityEvents(tx, s.tenantId, 'completed', [id], by(s));
        let followUp: string | null = null;
        if (b.follow_up) {
          if (b.follow_up.owner_id && b.follow_up.owner_id !== s.userId && !all(s)) return { code: 403, body: { error: 'forbidden' } };
          if (!(await tx`SELECT 1 FROM crm_activity_types WHERE tenant_id = ${s.tenantId} AND key = ${b.follow_up.type}`)[0]) return { code: 400, body: { error: 'invalid_type' } };
          [followUp] = await insertActivity(tx, s.tenantId, s.userId, {
            ...b.follow_up, owner_id: b.follow_up.owner_id ?? old.owner_id ?? s.userId,
            customer_id: old.customer_id, branch_id: old.branch_id, contact_id: old.contact_id, offer_id: old.offer_id, parent_id: id,
          });
          await emitActivityEvents(tx, s.tenantId, 'created', [followUp], by(s));
        }
        const [row] = await tx`SELECT * FROM crm_activities WHERE id = ${id}`;
        await runRules(tx, s.tenantId, 'activity_done', { customer_id: row.customer_id, actor_id: s.userId, activity: row });
        return { code: 200, body: { ok: true, follow_up_id: followUp } };
      });
      if (res.code === 200) await publish({ tenantId: s.tenantId, type: 'crm.changed', data: {} });
      return reply.code(res.code).send(res.body);
    });

    r.post('/crm/activities/:id/reopen', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM crm_activities WHERE id = ${id} FOR UPDATE`;
        if (!old) return 404;
        if (!mayEdit(s, old) || !can(s, 'customers.edit')) return 403;
        await tx`UPDATE crm_activities SET status = 'planned', completed_at = NULL, completed_by = NULL, updated_at = now(),
                 remind_at = CASE WHEN remind_before_min IS NULL OR due_at IS NULL OR due_at < now() THEN NULL ELSE due_at - (remind_before_min * interval '1 minute') END,
                 reminded = false WHERE id = ${id}`;
        await emitActivityEvents(tx, s.tenantId, 'updated', [id], by(s));
        return 200;
      });
      if (res !== 200) return reply.code(res).send({ error: res === 404 ? 'not_found' : 'forbidden' });
      await publish({ tenantId: s.tenantId, type: 'crm.changed', data: {} });
      return { ok: true };
    });

    // ---- kanban: status of one activity (done goes through /complete)
    r.patch('/crm/activities/:id/status', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const { status } = z.object({ status: z.enum(['planned', 'in_progress', 'cancelled']) }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM crm_activities WHERE id = ${id} FOR UPDATE`;
        if (!old) return 404;
        if (!mayEdit(s, old) || !can(s, 'customers.edit')) return 403;
        await tx`UPDATE crm_activities SET status = ${status}, completed_at = NULL, completed_by = NULL, updated_at = now() WHERE id = ${id}`;
        await emitActivityEvents(tx, s.tenantId, 'updated', [id], by(s));
        return 200;
      });
      if (res !== 200) return reply.code(res).send({ error: res === 404 ? 'not_found' : 'forbidden' });
      await publish({ tenantId: s.tenantId, type: 'crm.changed', data: {} });
      return { ok: true };
    });

    // ---- bulk
    r.post('/crm/activities/bulk', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const b = z.object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        action: z.enum(['complete', 'cancel', 'delete', 'assign', 'reschedule', 'status', 'priority']),
        owner_id: z.string().uuid().optional(), days: z.coerce.number().int().min(-365).max(365).optional(),
        status: z.enum(['planned', 'in_progress']).optional(), priority: z.coerce.number().int().min(1).max(3).optional(),
      }).parse(req.body);
      if (b.action === 'assign' && (!b.owner_id || (b.owner_id !== s.userId && !all(s)))) return forbid(reply);
      const n = await withTenant(s.tenantId, async (tx) => {
        const ok = (await tx`SELECT id FROM crm_activities WHERE id = ANY(${b.ids}::uuid[])
          ${all(s) ? tx`` : tx`AND (owner_id = ${s.userId} OR created_by = ${s.userId})`}`).map((x) => x.id as string);
        if (!ok.length) return 0;
        switch (b.action) {
          case 'complete': await tx`UPDATE crm_activities SET status = 'done', completed_at = now(), completed_by = ${s.userId}, remind_at = NULL, updated_at = now() WHERE id = ANY(${ok}::uuid[]) AND status <> 'done'`; break;
          case 'cancel': await tx`UPDATE crm_activities SET status = 'cancelled', remind_at = NULL, updated_at = now() WHERE id = ANY(${ok}::uuid[])`; break;
          case 'delete': await tx`DELETE FROM crm_activities WHERE id = ANY(${ok}::uuid[])`; break;
          case 'assign':
            if (!(await tx`SELECT 1 FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ${b.owner_id!}`)[0]) return -1;
            await tx`UPDATE crm_activities SET owner_id = ${b.owner_id!}, reminded = false, updated_at = now() WHERE id = ANY(${ok}::uuid[])`; break;
          case 'reschedule':
            await tx`UPDATE crm_activities SET due_at = due_at + (${b.days ?? 1} * interval '1 day'),
                     remind_at = remind_at + (${b.days ?? 1} * interval '1 day'), reminded = false, updated_at = now()
                     WHERE id = ANY(${ok}::uuid[]) AND due_at IS NOT NULL`; break;
          case 'status': await tx`UPDATE crm_activities SET status = ${b.status ?? 'planned'}, completed_at = NULL, completed_by = NULL, updated_at = now() WHERE id = ANY(${ok}::uuid[])`; break;
          case 'priority': await tx`UPDATE crm_activities SET priority = ${b.priority ?? 2}, updated_at = now() WHERE id = ANY(${ok}::uuid[])`; break;
        }
        await emitActivityEvents(tx, s.tenantId, b.action === 'delete' ? 'deleted' : b.action === 'complete' ? 'completed' : 'updated', ok, by(s));
        await audit(tx, s, `crm.bulk.${b.action}`, null, { count: ok.length });
        return ok.length;
      });
      if (n < 0) return reply.code(400).send({ error: 'owner_not_member' });
      await publish({ tenantId: s.tenantId, type: 'crm.changed', data: {} });
      return { ok: true, count: n };
    });

    r.delete('/crm/activities/:id', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const { series } = z.object({ series: z.enum(['one', 'following']).default('one') }).parse(req.query);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM crm_activities WHERE id = ${id}`;
        if (!old) return { code: 404 };
        if (!mayEdit(s, old) || !can(s, 'customers.edit')) return { code: 403 };
        const gone = series === 'following' && old.series_id
          ? await tx`DELETE FROM crm_activities WHERE series_id = ${old.series_id} AND (id = ${id} OR (due_at >= ${old.due_at} AND status <> 'done')) RETURNING id`
          : await tx`DELETE FROM crm_activities WHERE id = ${id} RETURNING id`;
        await emitActivityEvents(tx, s.tenantId, 'deleted', gone.map((x) => x.id as string), by(s));
        return { code: 200, n: gone.length };
      });
      if (res.code !== 200) return reply.code(res.code).send({ error: res.code === 404 ? 'not_found' : 'forbidden' });
      await publish({ tenantId: s.tenantId, type: 'crm.changed', data: {} });
      return { ok: true, deleted: res.n };
    });

    // ---- export (same filters as the list)
    r.get('/crm/activities/export.csv', async (req, reply) => {
      const q = listQuery.parse({ ...(req.query as object), limit: 200 });
      const s = req.session;
      const rows = await withTenant(s.tenantId, async (tx) => {
        const tz = await tenantTz(tx, s.tenantId);
        const out = await tx`${activityOut(tx, s.tenantId)} ${whereSql(tx, s, q, tz)} ORDER BY coalesce(a.due_at, a.created_at) DESC LIMIT 50000`;
        await audit(tx, s, 'crm.export', null, { rows: out.length });
        return out;
      });
      const cell = (v: unknown) => {
        if (v === null || v === undefined) return '';
        const t = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const head = ['type', 'subject', 'status', 'priority', 'due_at', 'duration_min', 'owner', 'customer_code', 'customer', 'store', 'contact', 'offer', 'outcome', 'outcome_note', 'completed_at', 'location', 'body', 'created_at'];
      const lines = rows.map((x) => [x.type_name ?? x.type, x.subject, x.status, x.priority, x.due_at, x.duration_min, x.owner_name, x.customer_code, x.customer_name,
        x.branch_name, x.contact_name, x.offer_number, x.outcome_name ?? x.outcome, x.outcome_note, x.completed_at, x.location, x.body, x.created_at].map(cell).join(';'));
      reply.header('Content-Disposition', `attachment; filename="activities-${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.type('text/csv; charset=utf-8').send('\uFEFF' + [head.join(';'), ...lines].join('\r\n'));
    });

    // ---- links of a customer for the editor (stores, contacts, offers)
    r.get('/crm/links/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => ({
        branches: await tx`SELECT id, name, city, address FROM branches WHERE customer_id = ${id} ORDER BY name LIMIT 300`,
        contacts: await tx`SELECT id, full_name, role_title, phone, mobile, email, is_primary FROM contacts WHERE customer_id = ${id} ORDER BY is_primary DESC, full_name LIMIT 300`,
        offers: await tx`SELECT id, number, status, total_amount FROM offers WHERE customer_id = ${id} ORDER BY created_at DESC LIMIT 50`,
      }));
    });

    // ---- reports
    r.get('/crm/reports', async (req, reply) => {
      const q = z.object({ from: z.coerce.date(), to: z.coerce.date(), owner: z.string().uuid().optional(), days: z.coerce.number().int().min(7).max(365).default(60) }).parse(req.query);
      const s = req.session;
      if (q.owner && q.owner !== s.userId && !all(s)) return forbid(reply);
      const owner = q.owner ?? (all(s) ? null : s.userId);
      return withTenant(s.tenantId, async (tx) => {
        const T = s.tenantId;
        const scope = owner ? tx`AND a.owner_id = ${owner}` : tx``;
        const inRange = tx`a.completed_at >= ${q.from} AND a.completed_at < ${q.to}`;
        const [kpi] = await tx`
          SELECT count(*) FILTER (WHERE a.status = 'done' AND ${inRange})::int AS done,
                 count(*) FILTER (WHERE a.due_at >= ${q.from} AND a.due_at < ${q.to} AND a.status <> 'cancelled')::int AS due_in_range,
                 count(*) FILTER (WHERE a.due_at >= ${q.from} AND a.due_at < ${q.to} AND a.status = 'done')::int AS due_done,
                 count(*) FILTER (WHERE a.status IN ('planned','in_progress') AND a.due_at < now())::int AS overdue,
                 count(*) FILTER (WHERE a.status IN ('planned','in_progress'))::int AS open,
                 count(*) FILTER (WHERE a.status = 'done' AND ${inRange} AND a.due_at IS NOT NULL AND a.completed_at <= a.due_at + interval '1 day')::int AS on_time,
                 coalesce(sum(a.duration_min) FILTER (WHERE a.status = 'done' AND ${inRange}), 0)::int AS minutes,
                 count(DISTINCT a.customer_id) FILTER (WHERE a.status = 'done' AND ${inRange})::int AS customers_reached
          FROM crm_activities a WHERE a.tenant_id = ${T} ${scope}`;
        const byUser = await tx`
          SELECT u.id, u.full_name,
                 count(*) FILTER (WHERE a.status = 'done' AND ${inRange})::int AS done,
                 count(*) FILTER (WHERE a.status IN ('planned','in_progress'))::int AS open,
                 count(*) FILTER (WHERE a.status IN ('planned','in_progress') AND a.due_at < now())::int AS overdue,
                 count(*) FILTER (WHERE a.status = 'done' AND ${inRange} AND oc.positive)::int AS positive
          FROM crm_activities a JOIN users u ON u.id = a.owner_id
          LEFT JOIN crm_outcomes oc ON oc.tenant_id = a.tenant_id AND oc.key = a.outcome
          WHERE a.tenant_id = ${T} ${scope} GROUP BY u.id, u.full_name ORDER BY done DESC, open DESC LIMIT 50`;
        const byType = await tx`
          SELECT a.type AS key, coalesce(t.name, a.type) AS name, t.color, count(*)::int AS done
          FROM crm_activities a LEFT JOIN crm_activity_types t ON t.tenant_id = a.tenant_id AND t.key = a.type
          WHERE a.tenant_id = ${T} ${scope} AND a.status = 'done' AND ${inRange} GROUP BY a.type, t.name, t.color, t.sort ORDER BY done DESC`;
        const byOutcome = await tx`
          SELECT coalesce(a.outcome, '') AS key, coalesce(o.name, '') AS name, o.color, coalesce(o.positive, false) AS positive, count(*)::int AS n
          FROM crm_activities a LEFT JOIN crm_outcomes o ON o.tenant_id = a.tenant_id AND o.key = a.outcome
          WHERE a.tenant_id = ${T} ${scope} AND a.status = 'done' AND ${inRange} GROUP BY a.outcome, o.name, o.color, o.positive ORDER BY n DESC`;
        const tz = await tenantTz(tx, T);
        const trend = await tx`
          SELECT to_char(date_trunc('day', a.completed_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, count(*)::int AS done
          FROM crm_activities a WHERE a.tenant_id = ${T} ${scope} AND a.status = 'done' AND ${inRange}
          GROUP BY 1 ORDER BY 1`;
        // Customers whose last completed activity is older than N days (or never), biggest annual value first
        const noContact = await tx`
          SELECT c.id, c.name, c.code, c.annual_value::float8 AS annual_value, u.full_name AS manager_name, last.at AS last_contact
          FROM customers c LEFT JOIN users u ON u.id = c.account_manager_id
          LEFT JOIN LATERAL (SELECT max(completed_at) AS at FROM crm_activities a WHERE a.tenant_id = ${T} AND a.customer_id = c.id AND a.status = 'done') last ON true
          WHERE c.tenant_id = ${T} AND c.archived_at IS NULL ${owner ? tx`AND c.account_manager_id = ${owner}` : tx``}
            AND (last.at IS NULL OR last.at < now() - (${q.days} * interval '1 day'))
          ORDER BY c.annual_value DESC NULLS LAST, c.name LIMIT 20`;
        // Activities → offers: customers reached in the period that got an offer within 30 days after
        const [conv] = await tx`
          WITH reached AS (
            SELECT a.customer_id, min(a.completed_at) AS first_at FROM crm_activities a
            WHERE a.tenant_id = ${T} ${scope} AND a.status = 'done' AND ${inRange} AND a.customer_id IS NOT NULL GROUP BY a.customer_id)
          SELECT count(*)::int AS reached,
                 count(*) FILTER (WHERE EXISTS (SELECT 1 FROM offers o WHERE o.tenant_id = ${T} AND o.customer_id = r.customer_id
                   AND o.created_at >= r.first_at AND o.created_at < r.first_at + interval '30 days'))::int AS with_offer
          FROM reached r`;
        return { kpi, by_user: byUser, by_type: byType, by_outcome: byOutcome, trend, no_contact: noContact, conversion: conv, scope: owner ? 'user' : 'all' };
      });
    });

    // ---- settings: types & outcomes (whole list), templates (whole list), rules (CRUD)
    const listItem = z.object({
      key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/), name: z.string().trim().min(1).max(60),
      color: z.enum(['primary', 'info', 'success', 'warning', 'danger', 'muted']).default('primary'), active: z.boolean().default(true),
    });
    const guardManage = (req: FastifyRequest, reply: FastifyReply) => { if (!can(req.session, 'settings.manage')) { forbid(reply); return false; } return true; };

    r.put('/crm/settings/types', async (req, reply) => {
      if (!guardManage(req, reply)) return;
      const { items } = z.object({ items: z.array(listItem.extend({ icon: z.string().trim().max(40).default('circle'), default_duration: z.coerce.number().int().min(0).max(1440).default(0) })).min(1).max(50) }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        for (const [i, t] of items.entries()) {
          await tx`INSERT INTO crm_activity_types (tenant_id, key, name, icon, color, default_duration, sort, active)
                   VALUES (${s.tenantId}, ${t.key}, ${t.name}, ${t.icon}, ${t.color}, ${t.default_duration}, ${i + 1}, ${t.active})
                   ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, color = EXCLUDED.color,
                     default_duration = EXCLUDED.default_duration, sort = EXCLUDED.sort, active = EXCLUDED.active`;
        }
        // Types that are used are kept (deactivated) instead of deleted
        const keep = items.map((t) => t.key);
        await tx`UPDATE crm_activity_types SET active = false WHERE tenant_id = ${s.tenantId} AND NOT (key = ANY(${keep}))
                 AND EXISTS (SELECT 1 FROM crm_activities a WHERE a.tenant_id = ${s.tenantId} AND a.type = crm_activity_types.key)`;
        await tx`DELETE FROM crm_activity_types WHERE tenant_id = ${s.tenantId} AND NOT (key = ANY(${keep}))
                 AND NOT EXISTS (SELECT 1 FROM crm_activities a WHERE a.tenant_id = ${s.tenantId} AND a.type = crm_activity_types.key)`;
        await audit(tx, s, 'crm.types', null, { count: items.length });
      });
      return { ok: true };
    });

    r.put('/crm/settings/outcomes', async (req, reply) => {
      if (!guardManage(req, reply)) return;
      const { items } = z.object({ items: z.array(listItem.extend({ positive: z.boolean().default(false) })).max(50) }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        for (const [i, o] of items.entries()) {
          await tx`INSERT INTO crm_outcomes (tenant_id, key, name, color, positive, sort, active)
                   VALUES (${s.tenantId}, ${o.key}, ${o.name}, ${o.color}, ${o.positive}, ${i + 1}, ${o.active})
                   ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, positive = EXCLUDED.positive,
                     sort = EXCLUDED.sort, active = EXCLUDED.active`;
        }
        const keep = items.map((o) => o.key);
        await tx`UPDATE crm_outcomes SET active = false WHERE tenant_id = ${s.tenantId} AND NOT (key = ANY(${keep}))
                 AND EXISTS (SELECT 1 FROM crm_activities a WHERE a.tenant_id = ${s.tenantId} AND a.outcome = crm_outcomes.key)`;
        await tx`DELETE FROM crm_outcomes WHERE tenant_id = ${s.tenantId} AND NOT (key = ANY(${keep}))
                 AND NOT EXISTS (SELECT 1 FROM crm_activities a WHERE a.tenant_id = ${s.tenantId} AND a.outcome = crm_outcomes.key)`;
        await audit(tx, s, 'crm.outcomes', null, { count: items.length });
      });
      return { ok: true };
    });

    r.put('/crm/settings/templates', async (req, reply) => {
      if (!guardManage(req, reply)) return;
      const { items } = z.object({ items: z.array(z.object({
        name: z.string().trim().min(1).max(80), type: z.string().trim().min(1).max(40), subject: z.string().trim().min(1).max(200), body: optText(5000),
        priority: z.coerce.number().int().min(1).max(3).default(2), duration_min: z.coerce.number().int().min(0).max(1440).default(0),
        due_in_days: z.coerce.number().int().min(0).max(365).nullish().transform((v) => v ?? null),
        remind_before_min: z.coerce.number().int().min(0).max(10080).nullish().transform((v) => v ?? null),
      })).max(100) }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        await tx`DELETE FROM crm_templates WHERE tenant_id = ${s.tenantId}`;
        if (items.length) await tx`INSERT INTO crm_templates ${tx(items.map((x, i) => ({ ...x, tenant_id: s.tenantId, sort: i + 1 })))}`;
        await audit(tx, s, 'crm.templates', null, { count: items.length });
      });
      return { ok: true };
    });

    const ruleSchema = z.object({
      name: z.string().trim().min(1).max(100), active: z.boolean().default(true),
      trigger: z.enum(['offer_created', 'offer_sent', 'offer_accepted', 'offer_rejected', 'customer_created', 'activity_done', 'no_contact']),
      config: z.object({
        days: z.coerce.number().int().min(1).max(3650).optional(), type: z.string().max(40).optional(), outcome: z.string().max(40).optional(),
        customer_status: z.enum(['active', 'prospect', 'negotiation', 'inactive']).optional(),
      }).default({}),
      action: z.object({
        type: z.string().trim().min(1).max(40), subject: z.string().trim().min(1).max(200), body: optText(5000),
        due_in_days: z.coerce.number().int().min(0).max(365).default(1), priority: z.coerce.number().int().min(1).max(3).default(2),
        assign: z.union([z.enum(['actor', 'owner', 'account_manager']), z.string().uuid()]).default('actor'),
        remind_before_min: z.coerce.number().int().min(0).max(10080).nullish().transform((v) => v ?? null),
      }),
    });
    r.get('/crm/rules', async (req) => {
      const s = req.session;
      return withTenant(s.tenantId, (tx) => tx`
        SELECT r.*, (SELECT count(*)::int FROM crm_activities a WHERE a.rule_id = r.id AND a.status IN ('planned','in_progress')) AS open
        FROM crm_rules r WHERE r.tenant_id = ${s.tenantId} ORDER BY r.created_at`);
    });
    r.post('/crm/rules', async (req, reply) => {
      if (!guardManage(req, reply)) return;
      const b = ruleSchema.parse(req.body);
      const s = req.session;
      const row = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`INSERT INTO crm_rules (tenant_id, name, active, trigger, config, action)
          VALUES (${s.tenantId}, ${b.name}, ${b.active}, ${b.trigger}, ${tx.json(b.config as never)}, ${tx.json(b.action as never)}) RETURNING id`;
        await audit(tx, s, 'crm.rule.create', b.name, b);
        return x;
      });
      return reply.code(201).send(row);
    });
    r.put('/crm/rules/:id', async (req, reply) => {
      if (!guardManage(req, reply)) return;
      const { id } = idParam.parse(req.params);
      const b = ruleSchema.parse(req.body);
      const s = req.session;
      const ok = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`UPDATE crm_rules SET name = ${b.name}, active = ${b.active}, trigger = ${b.trigger}, config = ${tx.json(b.config as never)},
          action = ${tx.json(b.action as never)}, updated_at = now() WHERE id = ${id} RETURNING id`;
        if (x) await audit(tx, s, 'crm.rule.update', b.name, b);
        return !!x;
      });
      return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
    });
    r.delete('/crm/rules/:id', async (req, reply) => {
      if (!guardManage(req, reply)) return;
      const { id } = idParam.parse(req.params);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`DELETE FROM crm_rules WHERE id = ${id} RETURNING name`;
        if (x) await audit(tx, s, 'crm.rule.delete', x.name, null);
      });
      return { ok: true };
    });

    // ---- iCal: my feed URL (created on first request), rotate
    const icalUrl = (req: FastifyRequest, token: string) => `${req.headers['x-forwarded-proto'] ?? req.protocol}://${req.headers['x-forwarded-host'] ?? req.headers.host}/api/crm/ical/${token}.ics`;
    r.get('/crm/ical', async (req) => {
      const s = req.session;
      const token = await withTenant(s.tenantId, async (tx) => {
        const [t] = await tx`SELECT token FROM crm_ical_tokens WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId}`;
        if (t) return t.token as string;
        const tok = randomBytes(24).toString('base64url');
        await tx`INSERT INTO crm_ical_tokens (tenant_id, user_id, token) VALUES (${s.tenantId}, ${s.userId}, ${tok})`;
        return tok;
      });
      return { url: icalUrl(req, token) };
    });
    r.post('/crm/ical/rotate', async (req) => {
      const s = req.session;
      const tok = randomBytes(24).toString('base64url');
      await withTenant(s.tenantId, (tx) => tx`
        INSERT INTO crm_ical_tokens (tenant_id, user_id, token) VALUES (${s.tenantId}, ${s.userId}, ${tok})
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET token = EXCLUDED.token, created_at = now()`);
      return { url: icalUrl(req, tok) };
    });
  });
}

export { OPEN };
