// Saved views (Customers module): personal / role / organisation views with favourites, personal order,
// default view (user → role → organisation), live counts and audit of shared changes.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { likeAny, searchKey, searchPatterns, withTenant, type Tx } from '../db.js';
import { can, requireAuth, type Session } from '../auth.js';
import { asQuery, filterSql, FILTER_KEYS, parseFilters } from '../filters.js';
import { audit } from './settings.js';

const VIEW_KINDS = ['list', 'tree', 'stores'] as const;
const filterKey = new RegExp(`^(${FILTER_KEYS.join('|')})(_min|_max)?$`);
const config = z.object({
  view: z.enum(VIEW_KINDS),
  filters: z.record(z.string().regex(filterKey), z.string().max(200)).default({}),
  sort: z.string().regex(/^[a-z_]{2,20}$/).default('name'),
  q: z.string().trim().max(100).default(''),
  expand: z.enum(['none', 'all']).default('none'),
});
type ViewConfig = z.infer<typeof config>;
const body = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().regex(/^[a-z0-9-]{2,30}$/).default('list'),
  color: z.enum(['primary', 'info', 'success', 'warning', 'danger', 'muted']).default('primary'),
  scope: z.enum(['personal', 'role', 'organization']),
  roles: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/)).max(30).default([]),
  config,
});
const idParam = z.object({ id: z.string().uuid() });
const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });

/** Views this user can see (people who manage shared views also see other roles' views, to edit them). */
const visible = (tx: Tx, s: Session) => tx`
  (v.scope = 'organization' OR (v.scope = 'personal' AND v.owner_id = ${s.userId})
   OR (v.scope = 'role' AND (${s.role} = ANY (v.roles) OR ${can(s, 'views.share')})))`;

/** May this user change/delete the view? Personal: its owner. Shared: views.share. */
const canEdit = (s: Session, v: { scope: string; owner_id: string | null }) =>
  v.scope === 'personal' ? v.owner_id === s.userId : can(s, 'views.share');

/** Number of records a view shows (capped at 10.001 so huge lists stay fast). */
async function countView(tx: Tx, s: Session, c: ViewConfig) {
  const T = s.tenantId;
  const key = c.q && c.q.length >= 2 ? searchPatterns(c.q) : null;
  if (c.view === 'stores') {
    const f = parseFilters(asQuery(c.filters), 'stores');
    const [{ n }] = await tx`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM branches b JOIN customers c ON c.id = b.customer_id
        WHERE b.tenant_id = ${T} AND c.archived_at IS NULL ${filterSql(tx, f, s, 'stores', { c: 'c', b: 'b' })}
          ${key ? tx`AND ((${likeAny(tx, 'b.search', key)}) OR b.customer_id IN (SELECT id FROM customers WHERE tenant_id = ${T} AND (${likeAny(tx, 'search', key)})))` : tx``}
        LIMIT 10001) x`;
    return n as number;
  }
  const f = parseFilters(asQuery(c.filters), c.view === 'tree' ? 'tree' : 'customers');
  const [{ n }] = await tx`
    SELECT count(*)::int AS n FROM (
      SELECT 1 FROM customers WHERE tenant_id = ${T}
        ${f.c_archived ? tx`AND archived_at IS NOT NULL` : tx`AND archived_at IS NULL`}
        ${filterSql(tx, f, s, 'customers', { c: 'customers' })}
        ${key ? (c.view === 'tree'
          ? tx`AND ((${likeAny(tx, 'search', key)}) OR id IN (SELECT customer_id FROM branches WHERE tenant_id = ${T} AND (${likeAny(tx, 'search', key)})))`
          : tx`AND (${likeAny(tx, 'search', key)})`) : tx``}
      LIMIT 10001) x`;
  return n as number;
}

export default async function viewRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/views', async (req) => {
      const s = req.session;
      const T = s.tenantId;
      return withTenant(T, async (tx) => {
        const views = await tx`
          SELECT v.id, v.name, v.icon, v.color, v.scope, v.roles, v.owner_id, v.config, v.is_system, v.updated_at,
                 coalesce(p.favorite, v.is_system AND v.sort <= 3) AS favorite, p.position, u.full_name AS owner_name
          FROM saved_views v
          LEFT JOIN saved_view_prefs p ON p.view_id = v.id AND p.user_id = ${s.userId}
          LEFT JOIN users u ON u.id = v.owner_id
          WHERE v.tenant_id = ${T} AND v.module = 'customers' AND ${visible(tx, s)}
          ORDER BY p.position NULLS LAST, v.is_system DESC, v.sort, v.name`;
        const [t] = await tx`SELECT index_defaults->'customers_default_view' AS d FROM tenants WHERE id = ${T}`;
        const [m] = await tx`SELECT prefs->>'customers_default_view' AS d FROM memberships WHERE tenant_id = ${T} AND user_id = ${s.userId}`;
        const ids = new Set(views.map((v) => v.id as string));
        const d = (t?.d ?? {}) as { org?: string; roles?: Record<string, string> };
        const pick = [m?.d, d.roles?.[s.role], d.org].find((x) => x && ids.has(x)) ?? null; // ignore defaults that no longer exist / not visible
        return {
          // applies = meant for me (role views of other roles are only listed for management)
          views: views.map((v) => ({ ...v, can_edit: canEdit(s, v as never), applies: v.scope !== 'role' || (v.roles as string[]).includes(s.role) })),
          default_view: pick,
          defaults: { mine: m?.d ?? null, organization: d.org ?? null, roles: d.roles ?? {} },
          can_share: can(s, 'views.share'),
        };
      });
    });

    // Live counts for the given views (one cheap capped count each)
    r.get('/views/counts', async (req) => {
      const { ids } = z.object({ ids: z.string().max(4000) }).parse(req.query);
      const list = ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 30);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const views = await tx`SELECT v.id, v.config FROM saved_views v WHERE v.id = ANY(${list}::uuid[]) AND ${visible(tx, s)}`;
        const out: Record<string, number> = {};
        for (const v of views) {
          const c = config.safeParse(v.config);
          if (c.success) out[v.id] = await countView(tx, s, c.data);
        }
        return out;
      });
    });

    r.post('/views', async (req, reply) => {
      const b = body.parse(req.body);
      const s = req.session;
      if (b.scope !== 'personal' && !can(s, 'views.share')) return forbid(reply);
      if (b.scope === 'role' && !b.roles.length) return reply.code(400).send({ error: 'roles_required' });
      const row = await withTenant(s.tenantId, async (tx) => {
        const [{ next }] = await tx`SELECT coalesce(max(sort), 0) + 1 AS next FROM saved_views WHERE module = 'customers'`;
        const [v] = await tx`
          INSERT INTO saved_views (tenant_id, module, name, icon, color, scope, roles, owner_id, config, sort)
          VALUES (${s.tenantId}, 'customers', ${b.name}, ${b.icon}, ${b.color}, ${b.scope}, ${b.scope === 'role' ? b.roles : []},
                  ${s.userId}, ${tx.json(b.config as never)}, ${next}) RETURNING id`;
        // A new view goes straight into the bar
        await tx`INSERT INTO saved_view_prefs (tenant_id, user_id, view_id, favorite) VALUES (${s.tenantId}, ${s.userId}, ${v.id}, true)`;
        if (b.scope !== 'personal') await audit(tx, s, 'view.create', b.name, { scope: b.scope, roles: b.roles });
        return v;
      });
      return reply.code(201).send(row);
    });

    // Full update (save changes / rename / change scope). Partial: send only { config } to "Save".
    r.put('/views/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const b = body.partial().parse(req.body);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [v] = await tx`SELECT * FROM saved_views WHERE id = ${id} FOR UPDATE`;
        if (!v) return 404;
        if (!canEdit(s, v as never)) return 403;
        const scope = b.scope ?? v.scope;
        if (scope !== 'personal' && !can(s, 'views.share')) return 403;
        const roles = scope === 'role' ? (b.roles ?? v.roles) : [];
        if (scope === 'role' && !roles.length) return 400;
        await tx`
          UPDATE saved_views SET name = ${b.name ?? v.name}, icon = ${b.icon ?? v.icon}, color = ${b.color ?? v.color},
                 scope = ${scope}, roles = ${roles}, config = ${tx.json((b.config ?? v.config) as never)},
                 owner_id = ${scope === 'personal' ? (v.owner_id ?? s.userId) : v.owner_id}, updated_at = now()
          WHERE id = ${id}`;
        if (scope !== 'personal' || v.scope !== 'personal') await audit(tx, s, 'view.update', b.name ?? v.name, { scope, changed: Object.keys(b) });
        return 200;
      });
      return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 404 ? 'not_found' : res === 400 ? 'roles_required' : 'forbidden' });
    });

    r.post('/views/:id/duplicate', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const row = await withTenant(s.tenantId, async (tx) => {
        const [v] = await tx`SELECT v.* FROM saved_views v WHERE v.id = ${id} AND ${visible(tx, s)}`;
        if (!v) return null;
        const [{ next }] = await tx`SELECT coalesce(max(sort), 0) + 1 AS next FROM saved_views WHERE module = 'customers'`;
        const [c] = await tx`
          INSERT INTO saved_views (tenant_id, module, name, icon, color, scope, owner_id, config, sort)
          VALUES (${s.tenantId}, 'customers', ${`${v.name} (2)`.slice(0, 60)}, ${v.icon}, ${v.color}, 'personal', ${s.userId}, ${tx.json(v.config)}, ${next})
          RETURNING id`;
        await tx`INSERT INTO saved_view_prefs (tenant_id, user_id, view_id, favorite) VALUES (${s.tenantId}, ${s.userId}, ${c.id}, true)`;
        return c;
      });
      return row ? reply.code(201).send(row) : reply.code(404).send({ error: 'not_found' });
    });

    r.delete('/views/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [v] = await tx`SELECT name, scope, owner_id, is_system FROM saved_views WHERE id = ${id}`;
        if (!v) return 404;
        if (!canEdit(s, v as never)) return 403;
        await tx`DELETE FROM saved_views WHERE id = ${id}`;
        if (v.scope !== 'personal') await audit(tx, s, 'view.delete', v.name, { scope: v.scope, system: v.is_system });
        return 200;
      });
      return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 404 ? 'not_found' : 'forbidden' });
    });

    // My favourite flag
    r.put('/views/:id/favorite', async (req) => {
      const { id } = idParam.parse(req.params);
      const { favorite } = z.object({ favorite: z.boolean() }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, (tx) => tx`
        INSERT INTO saved_view_prefs (tenant_id, user_id, view_id, favorite) VALUES (${s.tenantId}, ${s.userId}, ${id}, ${favorite})
        ON CONFLICT (user_id, view_id) DO UPDATE SET favorite = excluded.favorite`);
      return { ok: true };
    });

    // My order (drag & drop): ids in the new order
    r.put('/views/order', async (req) => {
      const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        // keep the current favourite flag (or its default) when the row is created
        await tx`
          INSERT INTO saved_view_prefs (tenant_id, user_id, view_id, favorite, position)
          SELECT ${s.tenantId}, ${s.userId}, v.id, v.is_system AND v.sort <= 3, x.ord
          FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS x(id, ord) JOIN saved_views v ON v.id = x.id
          ON CONFLICT (user_id, view_id) DO UPDATE SET position = excluded.position`;
      });
      return { ok: true };
    });

    // Default view: for me, for a role, or for the organisation (null = none)
    r.put('/views/default', async (req, reply) => {
      const b = z.object({
        target: z.enum(['me', 'role', 'organization']),
        role: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
        view_id: z.string().uuid().nullable(),
      }).parse(req.body);
      const s = req.session;
      if (b.target !== 'me' && !can(s, 'views.share')) return forbid(reply);
      if (b.target === 'role' && !b.role) return reply.code(400).send({ error: 'role_required' });
      await withTenant(s.tenantId, async (tx) => {
        if (b.target === 'me') {
          await tx`UPDATE memberships SET prefs = ${b.view_id ? tx`prefs || ${tx.json({ customers_default_view: b.view_id })}` : tx`prefs - 'customers_default_view'`}
                   WHERE tenant_id = ${s.tenantId} AND user_id = ${s.userId}`;
          return;
        }
        const [t] = await tx`SELECT coalesce(index_defaults->'customers_default_view', '{}') AS d FROM tenants WHERE id = ${s.tenantId}`;
        const d = t.d as { org?: string; roles?: Record<string, string> };
        if (b.target === 'organization') { if (b.view_id) d.org = b.view_id; else delete d.org; }
        else { d.roles = { ...(d.roles ?? {}) }; if (b.view_id) d.roles[b.role!] = b.view_id; else delete d.roles[b.role!]; }
        await tx`UPDATE tenants SET index_defaults = index_defaults || ${tx.json({ customers_default_view: d } as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'view.default', b.target === 'role' ? b.role! : 'organization', { view_id: b.view_id });
      });
      return { ok: true };
    });
  });
}
