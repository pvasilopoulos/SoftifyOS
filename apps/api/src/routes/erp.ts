// Settings → ERP (SoftOne Soft1): connection, field mapping, value lists, sync now, log; per-activity resync.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, withTenant } from '../db.js';
import { can, requireAuth } from '../auth.js';
import { decryptSecret, encryptSecret } from '../registries.js';
import { audit } from './settings.js';
import { DEFAULT_META, fromErp, loadErp, PRESET_VALUES, pull, withDefaults, type ErpMeta } from '../erp.js';
import { Soft1, Soft1Error, type Soft1Config } from '../softone.js';

const STATUSES = ['planned', 'in_progress', 'done', 'cancelled'] as const;
const name = z.string().trim().max(60).regex(/^[A-Za-z0-9_.]*$/, 'field name');

const connSchema = z.object({
  url: z.string().trim().min(4).max(300),
  username: z.string().trim().min(1).max(100),
  password: z.string().max(200).optional(),
  app_id: z.string().trim().min(1).max(40),
  company: z.string().trim().max(20).default(''), branch: z.string().trim().max(20).default(''),
  module: z.string().trim().max(20).default(''), refid: z.string().trim().max(20).default(''),
});
const listSrc = z.object({ object: name, code: name, name: name, active: name });
const settingsSchema = z.object({
  enabled: z.boolean(), direction: z.enum(['both', 'pull', 'push']), conflict: z.enum(['newest', 'erp', 'softify']),
  interval_min: z.coerce.number().int().min(1).max(1440), window_days: z.coerce.number().int().min(7).max(3650),
  object: name.min(1), table: name.min(1), list: z.string().trim().max(60),
  filter: z.string().trim().max(500), reconcile_filter: z.string().trim().max(500),
  fields: z.object({
    code: name, series: name, date: name, start: name, end: name, customer: name, branch: name, requester: name, owner: name,
    subject: name, remarks: name, characterization: name, status: name, priority: name, updated: name,
  }),
  customer_match: z.enum(['external_id', 'code']),
  series_map: z.record(z.string().trim().min(1).max(40), z.string().max(40)),
  default_series: z.string().trim().max(40), default_type: z.string().trim().min(1).max(40),
  users_map: z.record(z.string().trim().min(1).max(60), z.string().uuid()),
  priority_map: z.record(z.string().trim().min(1).max(20), z.coerce.number().int().min(1).max(3)),
  lists: z.object({ characterization: listSrc, status: listSrc }),
});
const valuesSchema = z.array(z.object({
  code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(100), active: z.boolean().default(true),
  maps_to: z.enum(STATUSES).nullable().default(null), types: z.array(z.string().max(40)).max(50).nullable().default(null),
  sort: z.coerce.number().int().min(0).max(100000).default(100),
})).max(500);

const forbid = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => reply.code(403).send({ error: 'forbidden' });
const soft1Message = (e: unknown) => (e instanceof Soft1Error ? e.message : `Σφάλμα: ${(e as Error).message}`);

export default async function erpRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    // ---- everything the settings screen needs (never the password)
    r.get('/settings/erp', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      return withTenant(s.tenantId, async (tx) => {
        const [t] = await tx`SELECT erp_enc, erp_meta FROM tenants WHERE id = ${s.tenantId}`;
        const conn = t?.erp_enc ? (JSON.parse(decryptSecret(t.erp_enc as string) ?? '{}') as Partial<Soft1Config>) : null;
        const [stats] = await tx`SELECT count(*) FILTER (WHERE erp_state = 'pending')::int AS pending, count(*) FILTER (WHERE erp_state = 'error')::int AS errors,
                                        count(*) FILTER (WHERE erp_state = 'skipped')::int AS skipped, count(*) FILTER (WHERE erp_state = 'synced')::int AS synced
                                 FROM crm_activities WHERE tenant_id = ${s.tenantId}`;
        return {
          meta: withDefaults(t?.erp_meta as Partial<ErpMeta>), defaults: DEFAULT_META,
          connection: conn ? { url: conn.url, username: conn.username, app_id: conn.app_id, company: conn.company ?? '', branch: conn.branch ?? '',
            module: conn.module ?? '', refid: conn.refid ?? '', has_password: !!conn.password } : null,
          values: await tx`SELECT kind, code, name, active, maps_to, types, sort FROM crm_erp_values WHERE tenant_id = ${s.tenantId} ORDER BY kind, sort, code`,
          types: await tx`SELECT key, name, active FROM crm_activity_types WHERE tenant_id = ${s.tenantId} ORDER BY sort, name`,
          users: await tx`SELECT u.id, u.full_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} ORDER BY u.full_name`,
          stats,
          // The job queue is not visible to the app role: read it with the owner connection
          queued: (await sql`SELECT kind FROM jobs WHERE kind LIKE 'erp_%' AND payload->>'tenantId' = ${s.tenantId}`).map((j) => j.kind),
          log: await tx`SELECT at, level, action, activity_id, external_id, message FROM erp_sync_log WHERE tenant_id = ${s.tenantId} ORDER BY at DESC LIMIT 100`,
        };
      });
    });

    // ---- connection (password kept when not retyped)
    r.put('/settings/erp/connection', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage') || s.impersonator) return forbid(reply);
      const b = connSchema.parse(req.body);
      await withTenant(s.tenantId, async (tx) => {
        const [t] = await tx`SELECT erp_enc FROM tenants WHERE id = ${s.tenantId}`;
        const old = t?.erp_enc ? JSON.parse(decryptSecret(t.erp_enc as string) ?? '{}') as Partial<Soft1Config> : {};
        const conf: Soft1Config = { ...b, password: b.password || old.password || '' };
        await tx`UPDATE tenants SET erp_enc = ${encryptSecret(JSON.stringify(conf))},
                   erp_meta = coalesce(erp_meta, '{}'::jsonb) || ${tx.json({ provider: 'softone' } as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'erp.connection_set', null, { url: b.url, username: b.username, company: b.company });
      });
      return { ok: true };
    });

    r.delete('/settings/erp', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage') || s.impersonator) return forbid(reply);
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET erp_enc = NULL, erp_meta = coalesce(erp_meta, '{}'::jsonb) || '{"enabled": false, "connected": null}'::jsonb, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'erp.disconnected', null);
      });
      await sql`DELETE FROM jobs WHERE kind LIKE 'erp_%' AND payload->>'tenantId' = ${s.tenantId} AND locked_at IS NULL`;
      return { ok: true };
    });

    // ---- test: login + authenticate with the typed values (or the saved ones)
    r.post('/settings/erp/test', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      const typed = connSchema.partial().parse(req.body ?? {});
      const saved = (await loadErp(s.tenantId)).conn;
      const conf = { ...(saved ?? {}), ...Object.fromEntries(Object.entries(typed).filter(([, v]) => v !== undefined && v !== '')) } as Soft1Config;
      if (!conf.url || !conf.username || !conf.app_id || !conf.password) return { ok: false, error: 'Συμπληρώστε διεύθυνση, χρήστη, κωδικό και AppId' };
      try {
        const res = await new Soft1(conf, 20_000).connect();
        const company = res.chosen ? `${res.chosen.company_name || res.chosen.company}${res.chosen.branch_name ? ` · ${res.chosen.branch_name}` : ''}` : '';
        if (saved) await sql`UPDATE tenants SET erp_meta = coalesce(erp_meta, '{}'::jsonb) || ${sql.json({ connected: { company, at: new Date().toISOString() } } as never)} WHERE id = ${s.tenantId}`;
        return { ok: true, company, companies: res.companies };
      } catch (e) {
        return { ok: false, error: soft1Message(e) };
      }
    });

    // ---- mapping + sync settings (run state is kept)
    r.put('/settings/erp/settings', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      const b = settingsSchema.parse(req.body);
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET erp_meta = coalesce(erp_meta, '{}'::jsonb) || ${tx.json({ ...b, provider: 'softone' } as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'erp.settings_set', null, { enabled: b.enabled, direction: b.direction });
      });
      return { ok: true };
    });

    // ---- field discovery: the fields of a Soft1 table, to pick the right names
    r.get('/settings/erp/fields', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      const q = z.object({ object: name.optional(), table: name.optional() }).parse(req.query);
      const l = await loadErp(s.tenantId);
      if (!l.conn) return { ok: false, error: 'Δεν έχουν οριστεί στοιχεία σύνδεσης' };
      try {
        return { ok: true, fields: await new Soft1(l.conn).tableFields(q.object || l.meta.object, q.table || l.meta.table) };
      } catch (e) { return { ok: false, error: soft1Message(e) }; }
    });

    // ---- one Soft1 record, raw and mapped (to check the mapping on real data)
    r.get('/settings/erp/sample', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      const q = z.object({ key: z.string().trim().max(40).optional() }).parse(req.query);
      const l = await loadErp(s.tenantId);
      if (!l.conn) return { ok: false, error: 'Δεν έχουν οριστεί στοιχεία σύνδεσης' };
      try {
        const s1 = new Soft1(l.conn);
        let key = q.key;
        if (!key) {
          const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
          key = (await s1.browse(l.meta.object, l.meta.list, l.meta.filter.replaceAll('{since}', since).replaceAll('{from}', since).replaceAll('{to}', '2100-01-01'), 1))[0]?.key;
        }
        if (!key) return { ok: false, error: 'Δεν βρέθηκε καμία ενέργεια με το φίλτρο (τελευταίες 30 ημέρες)' };
        const raw = await s1.get(l.meta.object, l.meta.table, key);
        if (!raw) return { ok: false, error: `Δεν βρέθηκε η ενέργεια ${key}` };
        return { ok: true, key, raw, mapped: await fromErp(sql, s.tenantId, l, raw) };
      } catch (e) { return { ok: false, error: soft1Message(e) }; }
    });

    // ---- dry run: what the next import would do (nothing is saved)
    r.post('/settings/erp/preview', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      try { return { ok: true, ...(await pull(s.tenantId, { dryRun: true, limit: 200 })) }; }
      catch (e) { return { ok: false, error: soft1Message(e) }; }
    });

    // ---- sync now (queued: the worker runs it)
    r.post('/settings/erp/sync', async (req, reply) => {
      const s = req.session;
      const { what } = z.object({ what: z.enum(['pull', 'push', 'lists', 'full']).default('pull') }).parse(req.body ?? {});
      // Pull / push: anyone who edits customers ("Sync now" in the customer tab); lists / full: administrators
      if (!(what === 'pull' || what === 'push' ? can(s, 'customers.edit') : can(s, 'settings.manage'))) return forbid(reply);
      const l = await loadErp(s.tenantId);
      if (!l.conn) return reply.code(409).send({ error: 'not_configured' });
      const kinds = what === 'pull' && l.meta.direction !== 'pull' ? ['erp_push', 'erp_pull'] : [`erp_${what}`];
      for (const k of kinds) {
        await sql`INSERT INTO jobs (kind, payload) SELECT ${k}, ${sql.json({ tenantId: s.tenantId } as never)}
                  WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind = ${k} AND payload->>'tenantId' = ${s.tenantId} AND locked_at IS NULL)`;
      }
      return { ok: true, queued: kinds };
    });

    // ---- value lists (characterisation / status)
    r.put('/settings/erp/values/:kind', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      const { kind } = z.object({ kind: z.enum(['characterization', 'status']) }).parse(req.params);
      const rows = valuesSchema.parse(req.body);
      if (new Set(rows.map((x) => x.code)).size !== rows.length) return reply.code(400).send({ error: 'duplicate_code' });
      await withTenant(s.tenantId, async (tx) => {
        await tx`DELETE FROM crm_erp_values WHERE tenant_id = ${s.tenantId} AND kind = ${kind} AND NOT (code = ANY(${rows.map((x) => x.code)}))`;
        for (const v of rows) {
          await tx`INSERT INTO crm_erp_values (tenant_id, kind, code, name, active, maps_to, types, sort)
                   VALUES (${s.tenantId}, ${kind}, ${v.code}, ${v.name}, ${v.active}, ${v.maps_to}, ${v.types}, ${v.sort})
                   ON CONFLICT (tenant_id, kind, code) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active, maps_to = EXCLUDED.maps_to,
                     types = EXCLUDED.types, sort = EXCLUDED.sort`;
        }
        await audit(tx, s, 'erp.values_set', null, { kind, count: rows.length });
      });
      return { ok: true };
    });

    r.post('/settings/erp/values/preset', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      await withTenant(s.tenantId, async (tx) => {
        for (const kind of ['characterization', 'status'] as const) {
          for (const [i, [code, nm, active, maps]] of PRESET_VALUES[kind].entries()) {
            await tx`INSERT INTO crm_erp_values (tenant_id, kind, code, name, active, maps_to, sort)
                     VALUES (${s.tenantId}, ${kind}, ${code}, ${nm}, ${active}, ${maps}, ${kind === 'status' ? i + 1 : Number(code)}) ON CONFLICT DO NOTHING`;
          }
        }
        await audit(tx, s, 'erp.values_preset', null);
      });
      return { ok: true };
    });

    // ---- one activity: send again / now
    r.post('/crm/activities/:id/erp-sync', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'customers.edit')) return forbid(reply);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const done = await withTenant(s.tenantId, async (tx) => {
        const [a] = await tx`UPDATE crm_activities SET erp_state = 'pending', erp_error = NULL WHERE id = ${id} RETURNING id`;
        return !!a;
      });
      if (done) {
        await sql`INSERT INTO jobs (kind, payload) SELECT 'erp_push', ${sql.json({ tenantId: s.tenantId } as never)}
                  WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'erp_push' AND payload->>'tenantId' = ${s.tenantId} AND locked_at IS NULL)`;
      }
      return done ? { ok: true } : reply.code(404).send({ error: 'not_found' });
    });
  });
}
