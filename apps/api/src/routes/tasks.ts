// Tasks: list (mine / assigned by me / watching / team), counts, create (recurring, from templates), edit,
// kanban status & order, checklist, comments with @mentions, watchers, bulk actions, templates.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { likeAny, searchPatterns, withTenant, type Tx } from '../db.js';
import { can, requireAuth, type Session } from '../auth.js';
import { audit } from './settings.js';
import { publish } from '../realtime.js';
import { enqueue } from '../jobs.js';
import { occurrences } from '../crm.js';

const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });
const idParam = z.object({ id: z.string().uuid() });
const uuidN = z.string().uuid().nullish().transform((v) => v ?? null);
const STATUSES = ['todo', 'in_progress', 'waiting', 'done', 'cancelled'] as const;
const all = (s: Session) => can(s, 'tasks.all');
type Row = Record<string, unknown>;

const checklistItem = z.object({ id: z.string().max(40).default(() => randomUUID().slice(0, 8)), text: z.string().trim().min(1).max(300), done: z.boolean().default(false) });
const taskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20000).nullish().transform((v) => v || null),
  status: z.enum(STATUSES).default('todo'),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  due_at: z.coerce.date().nullish().transform((v) => v ?? null),
  owner_id: uuidN,
  customer_id: uuidN, branch_id: uuidN, offer_id: uuidN, activity_id: uuidN,
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  checklist: z.array(checklistItem).max(100).default([]),
  watchers: z.array(z.string().uuid()).max(50).default([]),
  remind_before_min: z.coerce.number().int().min(0).max(10080).nullish().transform((v) => (v === undefined ? null : v)),
  recurrence: z.object({ freq: z.enum(['daily', 'weekly', 'monthly']), interval: z.coerce.number().int().min(1).max(30).default(1),
    count: z.coerce.number().int().min(2).max(100).optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).nullish(),
  custom: z.record(z.string().max(40), z.any()).optional(),
});
type TaskInput = z.infer<typeof taskSchema>;

const taskOut = (tx: Tx, T: string) => tx`
  SELECT t.id, t.title, t.description, t.status, t.priority, t.due_at, t.owner_id, ow.full_name AS owner_name, t.created_by, cb.full_name AS created_by_name,
         t.customer_id, c.name AS customer_name, t.branch_id, b.name AS branch_name, t.offer_id, o.number AS offer_number, t.activity_id, a.subject AS activity_subject,
         t.tags, t.checklist, jsonb_array_length(t.checklist) AS checklist_total,
         (SELECT count(*)::int FROM jsonb_array_elements(t.checklist) e WHERE (e->>'done')::boolean) AS checklist_done,
         t.recurrence, t.series_id, t.remind_before_min, t.completed_at, t.position, t.comments_count,
         (SELECT count(*)::int FROM documents d WHERE d.task_id = t.id) AS docs_count, t.custom,
         (t.status NOT IN ('done', 'cancelled') AND t.due_at IS NOT NULL AND t.due_at < now()) AS overdue,
         t.created_at, t.updated_at
  FROM tasks t
  LEFT JOIN users ow ON ow.id = t.owner_id LEFT JOIN users cb ON cb.id = t.created_by
  LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN branches b ON b.id = t.branch_id
  LEFT JOIN offers o ON o.id = t.offer_id LEFT JOIN crm_activities a ON a.id = t.activity_id
  WHERE t.tenant_id = ${T}`;

/** Who may see / change a task: assignee, creator, watchers, or "all tasks". */
const visible = (tx: Tx, s: Session) => (all(s) ? tx`` : tx`AND (t.owner_id = ${s.userId} OR t.created_by = ${s.userId}
  OR EXISTS (SELECT 1 FROM task_watchers w WHERE w.task_id = t.id AND w.user_id = ${s.userId}))`);
const mayEdit = async (tx: Tx, s: Session, row: Row) => all(s) || row.owner_id === s.userId || row.created_by === s.userId
  || !!(await tx`SELECT 1 FROM task_watchers WHERE task_id = ${row.id as string} AND user_id = ${s.userId}`)[0];

async function checkLinks(tx: Tx, T: string, a: Pick<TaskInput, 'customer_id' | 'branch_id' | 'offer_id' | 'activity_id' | 'owner_id' | 'watchers'>) {
  if (a.branch_id) {
    const [b] = await tx`SELECT customer_id FROM branches WHERE id = ${a.branch_id}`;
    if (!b) return 'branch_not_found';
    a.customer_id ??= b.customer_id;
  }
  if (a.offer_id) {
    const [o] = await tx`SELECT customer_id FROM offers WHERE id = ${a.offer_id}`;
    if (!o) return 'offer_not_found';
    a.customer_id ??= o.customer_id;
  }
  if (a.activity_id && !(await tx`SELECT 1 FROM crm_activities WHERE id = ${a.activity_id}`)[0]) return 'activity_not_found';
  if (a.customer_id && !(await tx`SELECT 1 FROM customers WHERE id = ${a.customer_id}`)[0]) return 'customer_not_found';
  const people = [...new Set([a.owner_id, ...a.watchers].filter(Boolean))] as string[];
  if (people.length) {
    const ok = await tx`SELECT user_id FROM memberships WHERE tenant_id = ${T} AND user_id = ANY(${people}::uuid[])`;
    if (ok.length !== people.length) return 'user_not_member';
  }
  return null;
}

const remindAt = (due: Date | null, before: number | null, status: string) => (due && before !== null && !['done', 'cancelled'].includes(status) ? new Date(due.getTime() - before * 60_000) : null);
async function notify(tx: Tx, T: string, users: (string | null | undefined)[], except: string, title: string, body: string, taskId: string) {
  const ids = [...new Set(users.filter((u): u is string => !!u && u !== except))];
  if (ids.length) await enqueue('notify', { tenantId: T, userIds: ids, title, body, url: `/tasks?open=${taskId}` }, tx);
}
async function setWatchers(tx: Tx, T: string, taskId: string, users: string[]) {
  await tx`DELETE FROM task_watchers WHERE task_id = ${taskId} AND NOT (user_id = ANY(${users}::uuid[]))`;
  if (users.length) await tx`INSERT INTO task_watchers ${tx(users.map((u) => ({ tenant_id: T, task_id: taskId, user_id: u })))} ON CONFLICT DO NOTHING`;
}

export async function createTasks(tx: Tx, s: Session, a: TaskInput & { template_id?: string | null }) {
  const T = s.tenantId;
  const dates = a.recurrence && a.due_at && a.status !== 'done' ? occurrences(a.due_at, a.recurrence) : [a.due_at];
  const [{ pos }] = await tx`SELECT coalesce(max(position), 0) + 1 AS pos FROM tasks WHERE tenant_id = ${T} AND status = ${a.status}`;
  const ids: string[] = [];
  let series: string | null = null;
  for (const d of dates) {
    const [r]: { id: string }[] = await tx`INSERT INTO tasks ${tx({
      tenant_id: T, title: a.title, description: a.description, status: a.status, priority: a.priority, due_at: d, owner_id: a.owner_id ?? s.userId,
      created_by: s.userId, customer_id: a.customer_id, branch_id: a.branch_id, offer_id: a.offer_id, activity_id: a.activity_id,
      tags: a.tags, checklist: tx.json(a.checklist as never), recurrence: dates.length > 1 ? tx.json(a.recurrence as never) : null, series_id: series,
      template_id: a.template_id ?? null, remind_before_min: a.remind_before_min, remind_at: remindAt(d, a.remind_before_min, a.status),
      completed_at: a.status === 'done' ? new Date() : null, completed_by: a.status === 'done' ? s.userId : null,
      position: Number(pos) + ids.length, custom: tx.json((a.custom ?? {}) as never),
    } as never)} RETURNING id`;
    if (!series && dates.length > 1) { series = r.id; await tx`UPDATE tasks SET series_id = ${r.id} WHERE id = ${r.id}`; }
    ids.push(r.id);
    await setWatchers(tx, T, r.id, a.watchers);
  }
  await notify(tx, T, [a.owner_id, ...a.watchers], s.userId, `📋 ${a.title}`, 'Σας ανατέθηκε νέα εργασία', ids[0]);
  return ids;
}

const listQuery = z.object({
  view: z.enum(['mine', 'created', 'watching', 'team']).default('mine'),
  status: z.enum(['open', 'todo', 'in_progress', 'waiting', 'done', 'cancelled', 'any']).default('open'),
  due: z.enum(['overdue', 'today', 'week', 'nodate', 'range']).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  priority: z.coerce.number().int().min(1).max(3).optional(),
  owner: z.string().uuid().optional(), customer_id: z.string().uuid().optional(), offer_id: z.string().uuid().optional(),
  tag: z.string().max(40).optional(), q: z.string().trim().max(100).optional(),
  sort: z.enum(['due', 'priority', 'created', 'updated', 'position']).default('due'),
  offset: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(300).default(60),
});

export default async function taskRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/tasks/meta', async (req) => {
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => ({
        users: await tx`SELECT u.id, u.full_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} ORDER BY u.full_name`,
        templates: await tx`SELECT id, name, description, items FROM task_templates WHERE tenant_id = ${s.tenantId} ORDER BY sort, name`,
        tags: (await tx`SELECT DISTINCT unnest(tags) AS tag FROM tasks WHERE tenant_id = ${s.tenantId} LIMIT 200`).map((x) => x.tag as string).sort(),
        can: { all: all(s), edit: can(s, 'customers.edit'), manage: can(s, 'settings.manage') }, me: s.userId,
      }));
    });

    r.get('/tasks', async (req) => {
      const q = listQuery.parse(req.query);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const parts = [] as ReturnType<typeof tx>[];
        if (q.view === 'mine') parts.push(tx`t.owner_id = ${s.userId}`);
        if (q.view === 'created') parts.push(tx`t.created_by = ${s.userId}`);
        if (q.view === 'watching') parts.push(tx`EXISTS (SELECT 1 FROM task_watchers w WHERE w.task_id = t.id AND w.user_id = ${s.userId})`);
        if (q.status === 'open') parts.push(tx`t.status NOT IN ('done', 'cancelled')`);
        else if (q.status !== 'any') parts.push(tx`t.status = ${q.status}`);
        const day0 = tx`date_trunc('day', now())`;
        if (q.due === 'overdue') parts.push(tx`t.due_at < now() AND t.status NOT IN ('done', 'cancelled')`);
        if (q.due === 'today') parts.push(tx`t.due_at >= ${day0} AND t.due_at < ${day0} + interval '1 day'`);
        if (q.due === 'week') parts.push(tx`t.due_at >= ${day0} AND t.due_at < ${day0} + interval '7 days'`);
        if (q.due === 'nodate') parts.push(tx`t.due_at IS NULL`);
        if (q.due === 'range') { if (q.from) parts.push(tx`t.due_at >= ${q.from}`); if (q.to) parts.push(tx`t.due_at < ${q.to}`); }
        if (q.priority) parts.push(tx`t.priority = ${q.priority}`);
        if (q.owner && all(s)) parts.push(tx`t.owner_id = ${q.owner}`);
        if (q.customer_id) parts.push(tx`t.customer_id = ${q.customer_id}`);
        if (q.offer_id) parts.push(tx`t.offer_id = ${q.offer_id}`);
        if (q.tag) parts.push(tx`${q.tag} = ANY(t.tags)`);
        if (q.q && q.q.length >= 2) {
          const k = searchPatterns(q.q);
          parts.push(tx`(${likeAny(tx, 't.search', k)} OR t.customer_id IN (SELECT id FROM customers WHERE tenant_id = ${s.tenantId} AND (${likeAny(tx, 'search', k)})))`);
        }
        const where = parts.reduce((acc, p) => tx`${acc} AND ${p}`, tx``);
        const order = {
          due: tx`coalesce(t.due_at, 'infinity'::timestamptz), t.priority, t.id`, priority: tx`t.priority, coalesce(t.due_at, 'infinity'::timestamptz), t.id`,
          created: tx`t.created_at DESC, t.id DESC`, updated: tx`t.updated_at DESC, t.id DESC`, position: tx`t.position, t.id`,
        }[q.sort];
        const rows = await tx`${taskOut(tx, s.tenantId)} ${visible(tx, s)} ${where} ORDER BY ${order} OFFSET ${q.offset} LIMIT ${q.limit + 1}`;
        const more = rows.length > q.limit;
        return { items: more ? rows.slice(0, q.limit) : rows, next_offset: more ? q.offset + q.limit : null };
      });
    });

    r.get('/tasks/counts', async (req) => {
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const [c] = await tx`
          SELECT count(*) FILTER (WHERE t.owner_id = ${s.userId} AND t.status NOT IN ('done','cancelled'))::int AS mine,
                 count(*) FILTER (WHERE t.owner_id = ${s.userId} AND t.status NOT IN ('done','cancelled') AND t.due_at < now())::int AS overdue,
                 count(*) FILTER (WHERE t.owner_id = ${s.userId} AND t.status NOT IN ('done','cancelled') AND t.due_at >= date_trunc('day', now()) AND t.due_at < date_trunc('day', now()) + interval '1 day')::int AS today,
                 count(*) FILTER (WHERE t.created_by = ${s.userId} AND t.owner_id <> ${s.userId} AND t.status NOT IN ('done','cancelled'))::int AS delegated,
                 count(*) FILTER (WHERE t.status = 'done' AND t.completed_by = ${s.userId} AND t.completed_at > now() - interval '7 days')::int AS done_week
          FROM tasks t WHERE t.tenant_id = ${s.tenantId}`;
        return c;
      });
    });

    r.get('/tasks/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const [t] = await tx`${taskOut(tx, s.tenantId)} ${visible(tx, s)} AND t.id = ${id}`;
        if (!t) return reply.code(404).send({ error: 'not_found' });
        const watchers = await tx`SELECT u.id, u.full_name FROM task_watchers w JOIN users u ON u.id = w.user_id WHERE w.task_id = ${id} ORDER BY u.full_name`;
        const comments = await tx`
          SELECT c.id, c.body, c.mentions, c.created_at, c.edited_at, c.user_id, u.full_name AS user_name
          FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ${id} ORDER BY c.created_at LIMIT 500`;
        return { ...t, watchers, comments, can_edit: can(s, 'customers.edit') && (await mayEdit(tx, s, t)) };
      });
    });

    r.post('/tasks', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const a = taskSchema.parse(req.body);
      if (a.owner_id && a.owner_id !== s.userId && !all(s) && !can(s, 'customers.edit')) return forbid(reply);
      const res = await withTenant(s.tenantId, async (tx) => {
        const err = await checkLinks(tx, s.tenantId, a);
        if (err) return { code: 400, body: { error: err } };
        const ids = await createTasks(tx, s, a);
        return { code: 201, body: { id: ids[0], created: ids.length } };
      });
      if (res.code === 201) await publish({ tenantId: s.tenantId, type: 'tasks.changed', data: {} });
      return reply.code(res.code).send(res.body);
    });

    // From a template: one task per template item, due N days from the start date
    r.post('/tasks/from-template', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const b = z.object({ template_id: z.string().uuid(), customer_id: uuidN, offer_id: uuidN, owner_id: uuidN, start: z.coerce.date().nullish() }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [tp] = await tx`SELECT id, items FROM task_templates WHERE id = ${b.template_id}`;
        if (!tp) return { code: 404, body: { error: 'not_found' } };
        const base = { customer_id: b.customer_id, offer_id: b.offer_id, branch_id: null, activity_id: null, owner_id: b.owner_id ?? s.userId, watchers: [] as string[] };
        const err = await checkLinks(tx, s.tenantId, base);
        if (err) return { code: 400, body: { error: err } };
        const start = b.start ?? new Date();
        let n = 0;
        for (const it of tp.items as { title: string; description?: string; due_in_days?: number; priority?: number; checklist?: string[] }[]) {
          const due = new Date(start.getTime() + (it.due_in_days ?? 0) * 864e5); due.setHours(10, 0, 0, 0);
          await createTasks(tx, s, taskSchema.parse({
            ...base, title: it.title, description: it.description ?? null, priority: it.priority ?? 2, due_at: due,
            checklist: (it.checklist ?? []).map((text) => ({ text })), template_id: tp.id,
          }) as TaskInput & { template_id: string });
          n++;
        }
        await audit(tx, s, 'tasks.template', null, { template: b.template_id, count: n });
        return { code: 201, body: { created: n } };
      });
      if (res.code === 201) await publish({ tenantId: s.tenantId, type: 'tasks.changed', data: {} });
      return reply.code(res.code).send(res.body);
    });

    r.put('/tasks/:id', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const { apply } = z.object({ apply: z.enum(['one', 'following']).default('one') }).parse(req.query);
      const a = taskSchema.parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM tasks WHERE id = ${id} FOR UPDATE`;
        if (!old) return { code: 404, body: { error: 'not_found' } };
        if (!(await mayEdit(tx, s, old))) return { code: 403, body: { error: 'forbidden' } };
        const err = await checkLinks(tx, s.tenantId, a);
        if (err) return { code: 400, body: { error: err } };
        const done = a.status === 'done';
        await tx`UPDATE tasks SET ${tx({
          title: a.title, description: a.description, status: a.status, priority: a.priority, due_at: a.due_at, owner_id: a.owner_id ?? old.owner_id,
          customer_id: a.customer_id, branch_id: a.branch_id, offer_id: a.offer_id, activity_id: a.activity_id, tags: a.tags,
          checklist: tx.json(a.checklist as never), remind_before_min: a.remind_before_min, remind_at: remindAt(a.due_at, a.remind_before_min, a.status),
          reminded: old.reminded && old.due_at?.getTime?.() === a.due_at?.getTime() && old.remind_before_min === a.remind_before_min,
          completed_at: done ? old.completed_at ?? new Date() : null, completed_by: done ? old.completed_by ?? s.userId : null,
          custom: tx.json((a.custom ?? old.custom ?? {}) as never),
        } as never)}, updated_at = now() WHERE id = ${id}`;
        await setWatchers(tx, s.tenantId, id, a.watchers);
        if (apply === 'following' && old.series_id) {
          await tx`UPDATE tasks SET title = ${a.title}, description = ${a.description}, priority = ${a.priority}, owner_id = ${a.owner_id ?? old.owner_id},
                   tags = ${a.tags}, updated_at = now() WHERE series_id = ${old.series_id} AND id <> ${id} AND due_at > ${old.due_at} AND status NOT IN ('done', 'cancelled')`;
        }
        if (a.owner_id && a.owner_id !== old.owner_id) await notify(tx, s.tenantId, [a.owner_id], s.userId, `📋 ${a.title}`, 'Σας ανατέθηκε εργασία', id);
        if (done && old.status !== 'done') {
          const w = (await tx`SELECT user_id FROM task_watchers WHERE task_id = ${id}`).map((x) => x.user_id as string);
          await notify(tx, s.tenantId, [old.created_by, ...w], s.userId, `✓ ${a.title}`, 'Η εργασία ολοκληρώθηκε', id);
        }
        return { code: 200, body: { ok: true } };
      });
      if (res.code === 200) await publish({ tenantId: s.tenantId, type: 'tasks.changed', data: {} });
      return reply.code(res.code).send(res.body);
    });

    // ---- kanban: status (+ position between neighbours)
    r.patch('/tasks/:id/status', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const b = z.object({ status: z.enum(STATUSES), position: z.number().optional() }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM tasks WHERE id = ${id} FOR UPDATE`;
        if (!old) return 404;
        if (!can(s, 'customers.edit') || !(await mayEdit(tx, s, old))) return 403;
        const done = b.status === 'done';
        await tx`UPDATE tasks SET status = ${b.status}, position = ${b.position ?? old.position},
                 completed_at = ${done ? old.completed_at ?? new Date() : null}, completed_by = ${done ? old.completed_by ?? s.userId : null},
                 remind_at = CASE WHEN ${done || b.status === 'cancelled'} THEN NULL ELSE remind_at END, updated_at = now() WHERE id = ${id}`;
        if (done && old.status !== 'done') {
          const w = (await tx`SELECT user_id FROM task_watchers WHERE task_id = ${id}`).map((x) => x.user_id as string);
          await notify(tx, s.tenantId, [old.created_by, ...w], s.userId, `✓ ${old.title}`, 'Η εργασία ολοκληρώθηκε', id);
        }
        return 200;
      });
      if (res !== 200) return reply.code(res).send({ error: res === 404 ? 'not_found' : 'forbidden' });
      await publish({ tenantId: s.tenantId, type: 'tasks.changed', data: {} });
      return { ok: true };
    });

    r.patch('/tasks/:id/checklist', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const { checklist } = z.object({ checklist: z.array(checklistItem).max(100) }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT id, owner_id, created_by FROM tasks WHERE id = ${id}`;
        if (!old) return 404;
        if (!can(s, 'customers.edit') || !(await mayEdit(tx, s, old))) return 403;
        await tx`UPDATE tasks SET checklist = ${tx.json(checklist as never)}, updated_at = now() WHERE id = ${id}`;
        return 200;
      });
      if (res !== 200) return reply.code(res).send({ error: res === 404 ? 'not_found' : 'forbidden' });
      await publish({ tenantId: s.tenantId, type: 'tasks.changed', data: {} });
      return { ok: true };
    });

    // ---- comments with @mentions (mentioned people become watchers and get notified)
    r.post('/tasks/:id/comments', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const b = z.object({ body: z.string().trim().min(1).max(5000), mentions: z.array(z.string().uuid()).max(20).default([]) }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [t] = await tx`SELECT t.id, t.title, t.owner_id, t.created_by FROM tasks t WHERE t.id = ${id} ${visible(tx, s)}`;
        if (!t) return null;
        const mentions = b.mentions.length ? (await tx`SELECT user_id FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ANY(${b.mentions}::uuid[])`).map((x) => x.user_id as string) : [];
        const [c] = await tx`INSERT INTO task_comments (tenant_id, task_id, user_id, body, mentions) VALUES (${s.tenantId}, ${id}, ${s.userId}, ${b.body}, ${mentions}) RETURNING id`;
        await tx`UPDATE tasks SET comments_count = comments_count + 1, updated_at = now() WHERE id = ${id}`;
        if (mentions.length) await tx`INSERT INTO task_watchers ${tx(mentions.map((u) => ({ tenant_id: s.tenantId, task_id: id, user_id: u })))} ON CONFLICT DO NOTHING`;
        const w = (await tx`SELECT user_id FROM task_watchers WHERE task_id = ${id}`).map((x) => x.user_id as string);
        const [me] = await tx`SELECT full_name FROM users WHERE id = ${s.userId}`;
        await notify(tx, s.tenantId, mentions, s.userId, `@ ${me?.full_name ?? ''} σας ανέφερε`, `${t.title}: ${b.body.slice(0, 120)}`, id);
        await notify(tx, s.tenantId, [t.owner_id, t.created_by, ...w].filter((u) => !mentions.includes(u)), s.userId, `💬 ${t.title}`, `${me?.full_name ?? ''}: ${b.body.slice(0, 120)}`, id);
        return c;
      });
      if (!res) return reply.code(404).send({ error: 'not_found' });
      await publish({ tenantId: s.tenantId, type: 'tasks.changed', data: {} });
      return reply.code(201).send(res);
    });
    r.delete('/tasks/:id/comments/:cid', async (req, reply) => {
      const s = req.session;
      const { id, cid } = z.object({ id: z.string().uuid(), cid: z.string().uuid() }).parse(req.params);
      const ok = await withTenant(s.tenantId, async (tx) => {
        const [c] = await tx`DELETE FROM task_comments WHERE id = ${cid} AND task_id = ${id} ${all(s) ? tx`` : tx`AND user_id = ${s.userId}`} RETURNING id`;
        if (c) await tx`UPDATE tasks SET comments_count = greatest(0, comments_count - 1) WHERE id = ${id}`;
        return !!c;
      });
      return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
    });

    r.post('/tasks/:id/watch', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const { on } = z.object({ on: z.boolean() }).parse(req.body);
      await withTenant(s.tenantId, (tx) => (on
        ? tx`INSERT INTO task_watchers (tenant_id, task_id, user_id) SELECT ${s.tenantId}, id, ${s.userId} FROM tasks WHERE id = ${id} ON CONFLICT DO NOTHING`
        : tx`DELETE FROM task_watchers WHERE task_id = ${id} AND user_id = ${s.userId}`));
      return reply.send({ ok: true });
    });

    r.post('/tasks/bulk', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const b = z.object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        action: z.enum(['complete', 'cancel', 'delete', 'assign', 'reschedule', 'priority', 'status']),
        owner_id: z.string().uuid().optional(), days: z.coerce.number().int().min(-365).max(365).optional(),
        priority: z.coerce.number().int().min(1).max(3).optional(), status: z.enum(['todo', 'in_progress', 'waiting']).optional(),
      }).parse(req.body);
      const n = await withTenant(s.tenantId, async (tx) => {
        const ok = (await tx`SELECT t.id FROM tasks t WHERE t.id = ANY(${b.ids}::uuid[]) ${all(s) ? tx`` : tx`AND (t.owner_id = ${s.userId} OR t.created_by = ${s.userId})`}`).map((x) => x.id as string);
        if (!ok.length) return 0;
        switch (b.action) {
          case 'complete': await tx`UPDATE tasks SET status = 'done', completed_at = now(), completed_by = ${s.userId}, remind_at = NULL, updated_at = now() WHERE id = ANY(${ok}::uuid[]) AND status <> 'done'`; break;
          case 'cancel': await tx`UPDATE tasks SET status = 'cancelled', remind_at = NULL, updated_at = now() WHERE id = ANY(${ok}::uuid[])`; break;
          case 'delete': await tx`DELETE FROM tasks WHERE id = ANY(${ok}::uuid[])`; break;
          case 'assign':
            if (!b.owner_id || !(await tx`SELECT 1 FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ${b.owner_id}`)[0]) return -1;
            await tx`UPDATE tasks SET owner_id = ${b.owner_id}, updated_at = now() WHERE id = ANY(${ok}::uuid[])`;
            await notify(tx, s.tenantId, [b.owner_id], s.userId, '📋 Νέες εργασίες', `Σας ανατέθηκαν ${ok.length} εργασίες`, ok[0]);
            break;
          case 'reschedule': await tx`UPDATE tasks SET due_at = due_at + (${b.days ?? 1} * interval '1 day'), remind_at = remind_at + (${b.days ?? 1} * interval '1 day'), reminded = false, updated_at = now() WHERE id = ANY(${ok}::uuid[]) AND due_at IS NOT NULL`; break;
          case 'priority': await tx`UPDATE tasks SET priority = ${b.priority ?? 2}, updated_at = now() WHERE id = ANY(${ok}::uuid[])`; break;
          case 'status': await tx`UPDATE tasks SET status = ${b.status ?? 'todo'}, completed_at = NULL, completed_by = NULL, updated_at = now() WHERE id = ANY(${ok}::uuid[])`; break;
        }
        await audit(tx, s, `tasks.bulk.${b.action}`, null, { count: ok.length });
        return ok.length;
      });
      if (n < 0) return reply.code(400).send({ error: 'user_not_member' });
      await publish({ tenantId: s.tenantId, type: 'tasks.changed', data: {} });
      return { ok: true, count: n };
    });

    r.delete('/tasks/:id', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const { series } = z.object({ series: z.enum(['one', 'following']).default('one') }).parse(req.query);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [old] = await tx`SELECT * FROM tasks WHERE id = ${id}`;
        if (!old) return 404;
        if (!can(s, 'customers.edit') || !(all(s) || old.created_by === s.userId || old.owner_id === s.userId)) return 403;
        if (series === 'following' && old.series_id) await tx`DELETE FROM tasks WHERE series_id = ${old.series_id} AND (id = ${id} OR (due_at >= ${old.due_at} AND status <> 'done'))`;
        else await tx`DELETE FROM tasks WHERE id = ${id}`;
        return 200;
      });
      if (res !== 200) return reply.code(res).send({ error: res === 404 ? 'not_found' : 'forbidden' });
      await publish({ tenantId: s.tenantId, type: 'tasks.changed', data: {} });
      return { ok: true };
    });

    // ---- templates (Settings)
    r.put('/tasks/templates', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      const { items } = z.object({ items: z.array(z.object({
        id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).nullish(),
        items: z.array(z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(2000).optional(), due_in_days: z.coerce.number().int().min(0).max(365).optional(),
          priority: z.coerce.number().int().min(1).max(3).optional(), checklist: z.array(z.string().trim().min(1).max(300)).max(50).optional() })).min(1).max(50),
      })).max(50) }).parse(req.body);
      await withTenant(s.tenantId, async (tx) => {
        const keep = items.map((x) => x.id).filter(Boolean) as string[];
        await tx`DELETE FROM task_templates WHERE tenant_id = ${s.tenantId} AND NOT (id = ANY(${keep}::uuid[]))`;
        for (const [i, tp] of items.entries()) {
          if (tp.id) await tx`UPDATE task_templates SET name = ${tp.name}, description = ${tp.description ?? null}, items = ${tx.json(tp.items as never)}, sort = ${i + 1} WHERE id = ${tp.id}`;
          else await tx`INSERT INTO task_templates (tenant_id, name, description, items, sort) VALUES (${s.tenantId}, ${tp.name}, ${tp.description ?? null}, ${tx.json(tp.items as never)}, ${i + 1})`;
        }
        await audit(tx, s, 'tasks.templates', null, { count: items.length });
      });
      return { ok: true };
    });
  });
}
