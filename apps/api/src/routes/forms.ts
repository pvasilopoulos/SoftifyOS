// Settings → Module Forms: per organisation / role / user configuration of every form, custom fields,
// history with restore, export/import, and the effective configuration each form loads.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { withTenant, type Tx } from '../db.js';
import { can, requireAuth, type Session } from '../auth.js';
import { audit } from './settings.js';
import {
  buildEffective, CATALOG, CUSTOM_FORMS, CUSTOM_TYPES, effectiveForm, FORM_LABELS, FORM_MODULE, FORMS, invalidateForms,
  levelConfigSchema, loadCustom, PERSONAL_PROPS, type FormKey, type Level, type LevelConfig, type Scope,
} from '../forms.js';

const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });
const formParam = z.object({ form: z.enum(FORMS) });
const scopeQuery = z.object({ scope: z.enum(['organization', 'role', 'user']), key: z.string().max(80).default('') });
export const CUSTOM_TABLE: Record<(typeof CUSTOM_FORMS)[number], string> = {
  customer: 'customers', branch: 'branches', space: 'spaces', contact: 'contacts', activity: 'crm_activities', offer: 'offers',
};
const l10n = z.object({ el: z.string().trim().max(120).optional(), en: z.string().trim().max(120).optional() })
  .refine((x) => !!(x.el || x.en), 'label_required');

/** Levels above the given one (what it inherits). */
async function levelsAbove(tx: Tx, T: string, form: FormKey, scope: Scope, key: string) {
  if (scope === 'organization') return [] as Level[];
  const role = scope === 'role' ? key : ((await tx`SELECT role FROM memberships WHERE tenant_id = ${T} AND user_id = ${key}`)[0]?.role ?? null);
  const rows = await tx<{ scope: Scope; config: LevelConfig }[]>`
    SELECT scope, config FROM form_configs WHERE tenant_id = ${T} AND form = ${form}
      AND (scope = 'organization' OR (scope = 'role' AND scope_key = ${role ?? ''})) ORDER BY (scope = 'role')`;
  return scope === 'role' ? rows.filter((r) => r.scope === 'organization') : rows;
}

/** Keep only fields/sections that exist; personal edits keep only personal properties. */
function sanitize(form: FormKey, cfg: LevelConfig, customKeys: string[], personal: boolean): LevelConfig {
  const known = new Set([...CATALOG[form].fields.map((f) => f.key), ...customKeys.map((k) => `cf_${k}`)]);
  const fields: LevelConfig['fields'] = {};
  for (const [k, v] of Object.entries(cfg.fields)) {
    if (!known.has(k)) continue;
    const entry = (personal ? Object.fromEntries(Object.entries(v).filter(([p]) => (PERSONAL_PROPS as string[]).includes(p))) : { ...v }) as LevelConfig['fields'][string];
    // rules may only reference fields of this form
    if (entry.rules) entry.rules = entry.rules.filter((r) => known.has(r.field) && r.field !== k);
    if (Object.keys(entry).length) fields[k] = entry;
  }
  const sections: LevelConfig['sections'] = {};
  for (const [k, v] of Object.entries(cfg.sections)) {
    const entry = personal ? Object.fromEntries(Object.entries(v).filter(([p]) => p === 'order' || p === 'collapsed')) : v;
    if (Object.keys(entry).length) sections[k] = entry;
  }
  return { fields, sections };
}

async function saveLevel(tx: Tx, s: Session, form: FormKey, scope: Scope, key: string, config: LevelConfig | null, note: string | null) {
  const T = s.tenantId;
  const [cur] = await tx`SELECT config, version FROM form_configs WHERE tenant_id = ${T} AND form = ${form} AND scope = ${scope} AND scope_key = ${key}`;
  if (cur) {
    await tx`INSERT INTO form_config_history (tenant_id, form, scope, scope_key, version, config, note, created_by)
             VALUES (${T}, ${form}, ${scope}, ${key}, ${cur.version}, ${tx.json(cur.config)}, ${note}, ${s.userId})`;
    // keep the last 50 versions per level
    await tx`DELETE FROM form_config_history WHERE id IN (
               SELECT id FROM form_config_history WHERE tenant_id = ${T} AND form = ${form} AND scope = ${scope} AND scope_key = ${key}
               ORDER BY created_at DESC OFFSET 50)`;
  }
  const empty = !config || (!Object.keys(config.fields).length && !Object.keys(config.sections).length);
  if (empty) await tx`DELETE FROM form_configs WHERE tenant_id = ${T} AND form = ${form} AND scope = ${scope} AND scope_key = ${key}`;
  else {
    await tx`
      INSERT INTO form_configs (tenant_id, form, scope, scope_key, config, version, updated_by)
      VALUES (${T}, ${form}, ${scope}, ${key}, ${tx.json(config as never)}, 1, ${s.userId})
      ON CONFLICT (tenant_id, form, scope, scope_key)
      DO UPDATE SET config = EXCLUDED.config, version = form_configs.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  }
  await audit(tx, s, empty ? 'forms.reset' : 'forms.update', `${form}:${scope}:${key || '-'}`, { note });
  invalidateForms(T);
}

export default async function formRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    // ---- What a form looks like for the signed-in user (or "view as" for admins) ----
    r.get('/forms/:form/effective', async (req, reply) => {
      const { form } = formParam.parse(req.params);
      const q = z.object({ as_role: z.string().max(40).optional(), as_user: z.string().uuid().optional() }).parse(req.query);
      const s = req.session;
      if ((q.as_role || q.as_user) && !can(s, 'forms.manage')) return forbid(reply);
      return withTenant(s.tenantId, async (tx) => {
        if (q.as_user) {
          const [m] = await tx`SELECT role FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ${q.as_user}`;
          if (!m) return reply.code(404).send({ error: 'not_found' });
          return effectiveForm(tx, s.tenantId, form, m.role, q.as_user);
        }
        if (q.as_role) return effectiveForm(tx, s.tenantId, form, q.as_role, null);
        return effectiveForm(tx, s.tenantId, form, s.role, s.userId);
      });
    });

    // ---- Overview: forms, roles, users, how many changes each level has ----
    r.get('/settings/forms', async (req) => {
      const s = req.session;
      const manage = can(s, 'forms.manage');
      return withTenant(s.tenantId, async (tx) => {
        const rows = await tx`SELECT form, scope, scope_key, config FROM form_configs WHERE tenant_id = ${s.tenantId}`;
        const customs = await tx`SELECT form, count(*)::int AS n FROM custom_fields WHERE tenant_id = ${s.tenantId} AND active GROUP BY form`;
        const roles = manage ? await tx`SELECT key, name FROM roles WHERE tenant_id = ${s.tenantId} ORDER BY sort, name` : [];
        const users = manage ? await tx`SELECT u.id, u.full_name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${s.tenantId} ORDER BY u.full_name` : [];
        const count = (c: LevelConfig) => Object.keys(c.fields ?? {}).length + Object.keys(c.sections ?? {}).length;
        return {
          can_manage: manage, me: { id: s.userId, role: s.role },
          roles, users,
          forms: FORMS.map((form) => {
            const mine = rows.filter((x) => x.form === form);
            return {
              key: form, label: FORM_LABELS[form], module: FORM_MODULE[form], custom_allowed: (CUSTOM_FORMS as readonly string[]).includes(form),
              fields: CATALOG[form].fields.length, custom: customs.find((c) => c.form === form)?.n ?? 0,
              changes: {
                organization: count(mine.find((x) => x.scope === 'organization')?.config ?? {}),
                roles: Object.fromEntries(mine.filter((x) => x.scope === 'role').map((x) => [x.scope_key, count(x.config)])),
                users: Object.fromEntries(mine.filter((x) => x.scope === 'user' && (manage || x.scope_key === s.userId)).map((x) => [x.scope_key, count(x.config)])),
              },
            };
          }),
        };
      });
    });

    // ---- One level of one form: its own changes + what it inherits ----
    r.get('/settings/forms/:form', async (req, reply) => {
      const { form } = formParam.parse(req.params);
      const q = scopeQuery.parse(req.query);
      const s = req.session;
      const own = q.scope === 'user' && q.key === s.userId;
      if (!can(s, 'forms.manage') && !own) return forbid(reply);
      if (q.scope !== 'organization' && !q.key) return reply.code(400).send({ error: 'key_required' });
      return withTenant(s.tenantId, async (tx) => {
        const key = q.scope === 'organization' ? '' : q.key;
        const [row] = await tx`
          SELECT f.config, f.version, f.updated_at, u.full_name AS updated_by_name FROM form_configs f LEFT JOIN users u ON u.id = f.updated_by
          WHERE f.tenant_id = ${s.tenantId} AND f.form = ${form} AND f.scope = ${q.scope} AND f.scope_key = ${key}`;
        const above = await levelsAbove(tx, s.tenantId, form, q.scope, key);
        const customsAll = await loadCustom(tx, s.tenantId, form, true);
        const customs = customsAll.filter((c) => c.active);
        const level: LevelConfig = row?.config ?? { fields: {}, sections: {} };
        return {
          form, scope: q.scope, key, personal: !can(s, 'forms.manage'), personal_props: PERSONAL_PROPS,
          level: { fields: level.fields ?? {}, sections: level.sections ?? {} },
          version: row?.version ?? 0, updated_at: row?.updated_at ?? null, updated_by_name: row?.updated_by_name ?? null,
          base: buildEffective(form, customs, above),
          effective: buildEffective(form, customs, [...above, { scope: q.scope, config: level }]),
          custom_fields: customsAll,
        };
      });
    });

    r.put('/settings/forms/:form', async (req, reply) => {
      const { form } = formParam.parse(req.params);
      const q = scopeQuery.parse(req.query);
      const b = z.object({ config: levelConfigSchema, note: z.string().trim().max(200).nullish(), version: z.number().int().min(0).optional() }).parse(req.body);
      const s = req.session;
      const manage = can(s, 'forms.manage');
      const own = q.scope === 'user' && q.key === s.userId;
      if (!manage && !own) return forbid(reply);
      if (q.scope !== 'organization' && !q.key) return reply.code(400).send({ error: 'key_required' });
      const key = q.scope === 'organization' ? '' : q.key;
      const res = await withTenant(s.tenantId, async (tx) => {
        if (q.scope === 'role' && !(await tx`SELECT 1 FROM roles WHERE tenant_id = ${s.tenantId} AND key = ${key}`)[0]) return 404;
        if (q.scope === 'user' && !(await tx`SELECT 1 FROM memberships WHERE tenant_id = ${s.tenantId} AND user_id = ${key}`)[0]) return 404;
        const [cur] = await tx`SELECT version FROM form_configs WHERE tenant_id = ${s.tenantId} AND form = ${form} AND scope = ${q.scope} AND scope_key = ${key} FOR UPDATE`;
        if (b.version !== undefined && (cur?.version ?? 0) !== b.version) return 409;
        const customs = await loadCustom(tx, s.tenantId, form, true);
        await saveLevel(tx, s, form, q.scope, key, sanitize(form, b.config, customs.map((c) => c.key), !manage), b.note ?? null);
        return 200;
      });
      if (res === 409) return reply.code(409).send({ error: 'conflict' });
      if (res === 404) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    });

    r.delete('/settings/forms/:form', async (req, reply) => {
      const { form } = formParam.parse(req.params);
      const q = scopeQuery.parse(req.query);
      const s = req.session;
      if (!can(s, 'forms.manage') && !(q.scope === 'user' && q.key === s.userId)) return forbid(reply);
      await withTenant(s.tenantId, (tx) => saveLevel(tx, s, form, q.scope, q.scope === 'organization' ? '' : q.key, null, 'reset'));
      return { ok: true };
    });

    // ---- History ----
    r.get('/settings/forms/:form/history', async (req, reply) => {
      const { form } = formParam.parse(req.params);
      const q = scopeQuery.parse(req.query);
      const s = req.session;
      if (!can(s, 'forms.manage') && !(q.scope === 'user' && q.key === s.userId)) return forbid(reply);
      return withTenant(s.tenantId, (tx) => tx`
        SELECT h.id, h.version, h.note, h.created_at, u.full_name AS created_by_name,
               (SELECT count(*) FROM jsonb_object_keys(coalesce(h.config->'fields', '{}'))) +
               (SELECT count(*) FROM jsonb_object_keys(coalesce(h.config->'sections', '{}'))) AS changes
        FROM form_config_history h LEFT JOIN users u ON u.id = h.created_by
        WHERE h.tenant_id = ${s.tenantId} AND h.form = ${form} AND h.scope = ${q.scope} AND h.scope_key = ${q.scope === 'organization' ? '' : q.key}
        ORDER BY h.created_at DESC LIMIT 50`);
    });

    r.post('/settings/forms/history/:id/restore', async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [h] = await tx`SELECT form, scope, scope_key, config, version FROM form_config_history WHERE id = ${id}`;
        if (!h) return 404;
        if (!can(s, 'forms.manage') && !(h.scope === 'user' && h.scope_key === s.userId)) return 403;
        await saveLevel(tx, s, h.form, h.scope, h.scope_key, levelConfigSchema.parse(h.config), `restore v${h.version}`);
        return 200;
      });
      if (res === 403) return forbid(reply);
      return res === 404 ? reply.code(404).send({ error: 'not_found' }) : { ok: true };
    });

    // ---- Custom fields ----
    const cfForm = z.enum(CUSTOM_FORMS);
    r.get('/settings/custom-fields', async (req) => {
      const { form } = z.object({ form: cfForm }).parse(req.query);
      const s = req.session;
      return withTenant(s.tenantId, (tx) => loadCustom(tx, s.tenantId, form, true));
    });

    r.post('/settings/custom-fields', async (req, reply) => {
      if (!can(req.session, 'forms.manage')) return forbid(reply);
      const b = z.object({
        form: cfForm, key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/), type: z.enum(CUSTOM_TYPES), label: l10n,
        options: z.array(z.string().trim().min(1).max(100)).max(200).default([]), filterable: z.boolean().default(true),
      }).parse(req.body);
      if (['select', 'multiselect'].includes(b.type) && !b.options.length) return reply.code(400).send({ error: 'options_required' });
      const s = req.session;
      const row = await withTenant(s.tenantId, async (tx) => {
        const [dup] = await tx`SELECT 1 FROM custom_fields WHERE tenant_id = ${s.tenantId} AND form = ${b.form} AND key = ${b.key}`;
        if (dup) return null;
        const [{ next }] = await tx`SELECT coalesce(max(sort), 0) + 10 AS next FROM custom_fields WHERE tenant_id = ${s.tenantId} AND form = ${b.form}`;
        const [r2] = await tx`
          INSERT INTO custom_fields (tenant_id, form, key, type, label, options, sort, filterable)
          VALUES (${s.tenantId}, ${b.form}, ${b.key}, ${b.type}, ${tx.json(b.label)}, ${[...new Set(b.options)]}, ${next}, ${b.filterable}) RETURNING id`;
        await audit(tx, s, 'custom_field.create', `${b.form}:${b.key}`, { type: b.type, label: b.label });
        return r2;
      });
      invalidateForms(s.tenantId);
      return row ? reply.code(201).send(row) : reply.code(409).send({ error: 'duplicate' });
    });

    r.put('/settings/custom-fields/:id', async (req, reply) => {
      if (!can(req.session, 'forms.manage')) return forbid(reply);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({
        label: l10n, options: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
        active: z.boolean().default(true), filterable: z.boolean().default(true),
      }).parse(req.body);
      const s = req.session;
      const ok = await withTenant(s.tenantId, async (tx) => {
        const [r2] = await tx`
          UPDATE custom_fields SET label = ${tx.json(b.label)}, options = ${[...new Set(b.options)]}, active = ${b.active}, filterable = ${b.filterable}, updated_at = now()
          WHERE id = ${id} RETURNING form, key`;
        if (r2) await audit(tx, s, 'custom_field.update', `${r2.form}:${r2.key}`, b);
        return !!r2;
      });
      invalidateForms(s.tenantId);
      return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
    });

    r.put('/settings/custom-fields-order', async (req, reply) => {
      if (!can(req.session, 'forms.manage')) return forbid(reply);
      const b = z.object({ ids: z.array(z.string().uuid()).max(500) }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        for (const [i, id] of b.ids.entries()) await tx`UPDATE custom_fields SET sort = ${(i + 1) * 10} WHERE id = ${id}`;
      });
      invalidateForms(s.tenantId);
      return { ok: true };
    });

    // Delete the definition; with purge=1 the stored values are removed from every record too
    r.delete('/settings/custom-fields/:id', async (req, reply) => {
      if (!can(req.session, 'forms.manage')) return forbid(reply);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { purge } = z.object({ purge: z.enum(['0', '1']).default('0') }).parse(req.query);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [r2] = await tx`DELETE FROM custom_fields WHERE id = ${id} RETURNING form, key`;
        if (!r2) return null;
        let purged = 0;
        if (purge === '1') {
          const table = CUSTOM_TABLE[r2.form as keyof typeof CUSTOM_TABLE];
          const u = await tx`UPDATE ${tx(table)} SET custom = custom - ${r2.key} WHERE tenant_id = ${s.tenantId} AND custom ? ${r2.key}`;
          purged = u.count;
        }
        await audit(tx, s, 'custom_field.delete', `${r2.form}:${r2.key}`, { purged });
        return { purged };
      });
      invalidateForms(s.tenantId);
      return res ? { ok: true, ...res } : reply.code(404).send({ error: 'not_found' });
    });

    // ---- Export / import (move a setup between organisations, keep a backup) ----
    r.get('/settings/forms-export', async (req, reply) => {
      if (!can(req.session, 'forms.manage')) return forbid(reply);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => ({
        format: 'softifyos.forms', version: 1, exported_at: new Date().toISOString(),
        configs: await tx`SELECT form, scope, scope_key, config FROM form_configs WHERE tenant_id = ${s.tenantId} AND scope <> 'user' ORDER BY form, scope, scope_key`,
        custom_fields: await tx`SELECT form, key, type, label, options, sort, active, filterable FROM custom_fields WHERE tenant_id = ${s.tenantId} ORDER BY form, sort`,
      }));
    });

    r.post('/settings/forms-import', async (req, reply) => {
      if (!can(req.session, 'forms.manage')) return forbid(reply);
      const b = z.object({
        mode: z.enum(['merge', 'replace']).default('merge'),
        data: z.object({
          format: z.literal('softifyos.forms'),
          configs: z.array(z.object({ form: z.enum(FORMS), scope: z.enum(['organization', 'role']), scope_key: z.string().max(80), config: levelConfigSchema })).max(500),
          custom_fields: z.array(z.object({
            form: cfForm, key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), type: z.enum(CUSTOM_TYPES), label: l10n,
            options: z.array(z.string().max(100)).max(200).default([]), sort: z.number().int().default(100), active: z.boolean().default(true), filterable: z.boolean().default(true),
          })).max(500),
        }),
      }).parse(req.body);
      const s = req.session;
      const out = await withTenant(s.tenantId, async (tx) => {
        let fields = 0, configs = 0, skipped = 0;
        for (const cf of b.data.custom_fields) {
          await tx`
            INSERT INTO custom_fields (tenant_id, form, key, type, label, options, sort, active, filterable)
            VALUES (${s.tenantId}, ${cf.form}, ${cf.key}, ${cf.type}, ${tx.json(cf.label)}, ${cf.options}, ${cf.sort}, ${cf.active}, ${cf.filterable})
            ON CONFLICT (tenant_id, form, key) DO UPDATE SET label = EXCLUDED.label, options = EXCLUDED.options, sort = EXCLUDED.sort,
              active = EXCLUDED.active, filterable = EXCLUDED.filterable, updated_at = now()`;
          fields++;
        }
        const roles = new Set((await tx`SELECT key FROM roles WHERE tenant_id = ${s.tenantId}`).map((x) => x.key as string));
        if (b.mode === 'replace') {
          for (const form of FORMS) {
            for (const row of await tx`SELECT scope, scope_key FROM form_configs WHERE tenant_id = ${s.tenantId} AND form = ${form} AND scope <> 'user'`) {
              await saveLevel(tx, s, form, row.scope, row.scope_key, null, 'import (replace)');
            }
          }
        }
        for (const c of b.data.configs) {
          if (c.scope === 'role' && !roles.has(c.scope_key)) { skipped++; continue; }
          const key = c.scope === 'organization' ? '' : c.scope_key;
          const customs = await loadCustom(tx, s.tenantId, c.form, true);
          let config = c.config;
          if (b.mode === 'merge') {
            const [cur] = await tx`SELECT config FROM form_configs WHERE tenant_id = ${s.tenantId} AND form = ${c.form} AND scope = ${c.scope} AND scope_key = ${key}`;
            if (cur) config = { fields: { ...cur.config.fields, ...c.config.fields }, sections: { ...cur.config.sections, ...c.config.sections } };
          }
          await saveLevel(tx, s, c.form, c.scope, key, sanitize(c.form, config, customs.map((x) => x.key), false), 'import');
          configs++;
        }
        await audit(tx, s, 'forms.import', null, { mode: b.mode, fields, configs, skipped });
        return { fields, configs, skipped };
      });
      invalidateForms(s.tenantId);
      return { ok: true, ...out };
    });
  });
}
