// AADE / VIES: settings (Settings → Customers), connection test, lookup for the customer form,
// and "update this customer from the registry".
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { withTenant, type Tx } from '../db.js';
import { can, requireAuth } from '../auth.js';
import { audit } from './settings.js';
import { emitEntityEvents } from '../webhooks.js';
import {
  DEFAULT_REGISTRY, encryptSecret, lookupRegistry, plannedChanges, REGISTRY_FIELDS, type RegistrySettings,
} from '../registries.js';

const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });
async function load(tx: Tx, tenantId: string): Promise<RegistrySettings> {
  const [t] = await tx`SELECT registry_settings FROM tenants WHERE id = ${tenantId}`;
  return { ...DEFAULT_REGISTRY, ...(t?.registry_settings ?? {}) };
}
const publicView = (s: RegistrySettings) => {
  const { aade_password_enc, ...rest } = s;
  return { ...rest, aade_has_password: !!aade_password_enc, aade_ready: s.aade_enabled && !!s.aade_username && !!aade_password_enc };
};
const vatQuery = z.object({ vat: z.string().trim().min(2).max(20), country: z.string().trim().length(2).default('GR') });
const errorOf = (e: unknown) => {
  const m = (e as Error).message ?? 'error';
  if (/aade:/.test(m)) return { error: 'aade_error', detail: m.replace(/^aade:/, '') };
  if (/vies_unavailable:MS_UNAVAILABLE/.test(m)) return { error: 'vies_ms_unavailable', detail: m };
  if (/vies_unavailable:(MS_MAX_CONCURRENT_REQ|GLOBAL_MAX_CONCURRENT_REQ)/.test(m)) return { error: 'vies_busy', detail: m };
  if (/vies_unavailable/.test(m)) return { error: 'registry_unreachable', detail: m };
  if (/vies/.test(m)) return { error: 'vies_error', detail: m };
  if (/timeout|aborted|fetch failed/i.test(m)) return { error: 'registry_unreachable', detail: m };
  return { error: m.split(':')[0], detail: m };
};

export default async function registryRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/settings/registries', async (req) => {
      const T = req.session.tenantId;
      const s = await withTenant(T, (tx) => load(tx, T));
      return { ...publicView(s), all_fields: REGISTRY_FIELDS, can_edit: can(req.session, 'settings.manage') };
    });

    r.put('/settings/registries', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const b = z.object({
        aade_enabled: z.boolean(),
        aade_username: z.string().trim().max(100).nullable(),
        aade_password: z.string().max(200).nullable().optional(),   // undefined/'' = keep, null = remove
        aade_caller_afm: z.string().trim().regex(/^\d{9}$/).nullable().or(z.literal('').transform(() => null)),
        vies_enabled: z.boolean(),
        lookup_mode: z.enum(['off', 'button', 'auto']),
        update_policy: z.enum(['empty', 'overwrite']),
        fields: z.array(z.enum(REGISTRY_FIELDS as [string, ...string[]])).max(REGISTRY_FIELDS.length),
      }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        const cur = await load(tx, s.tenantId);
        const next: RegistrySettings = {
          ...cur, aade_enabled: b.aade_enabled, aade_username: b.aade_username || null, aade_caller_afm: b.aade_caller_afm,
          vies_enabled: b.vies_enabled, lookup_mode: b.lookup_mode, update_policy: b.update_policy, fields: b.fields as RegistrySettings['fields'],
          aade_password_enc: b.aade_password === null ? null : b.aade_password ? encryptSecret(b.aade_password) : cur.aade_password_enc,
        };
        await tx`UPDATE tenants SET registry_settings = ${tx.json(next as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        // never log the password itself
        await audit(tx, s, 'registries.update', null, { ...publicView(next), password_changed: b.aade_password !== undefined && b.aade_password !== '' });
      });
      return { ok: true };
    });

    // Try a lookup with the saved settings (admin)
    r.post('/settings/registries/test', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return forbid(reply);
      const q = vatQuery.parse(req.body);
      const T = req.session.tenantId;
      const s = await withTenant(T, (tx) => load(tx, T));
      try { return { ok: true, result: await lookupRegistry(s, q.country, q.vat) }; }
      catch (e) { return reply.code(502).send(errorOf(e)); }
    });

    // Customer form: settings it needs + lookup
    r.get('/registry/config', async (req) => {
      const T = req.session.tenantId;
      const s = await withTenant(T, (tx) => load(tx, T));
      const v = publicView(s);
      return { lookup_mode: s.lookup_mode, update_policy: s.update_policy, fields: s.fields, aade_ready: v.aade_ready, vies_enabled: s.vies_enabled };
    });

    r.get('/registry/lookup', async (req, reply) => {
      if (!can(req.session, 'customers.edit')) return forbid(reply);
      const q = vatQuery.parse(req.query);
      const T = req.session.tenantId;
      const s = await withTenant(T, (tx) => load(tx, T));
      if (s.lookup_mode === 'off') return reply.code(409).send({ error: 'registry_disabled' });
      try { return await lookupRegistry(s, q.country, q.vat); }
      catch (e) { return reply.code(502).send(errorOf(e)); }
    });

    // Existing customer: preview (dry_run) or apply the registry data, following the policy
    r.post('/customers/:id/registry-refresh', async (req, reply) => {
      if (!can(req.session, 'customers.edit')) return forbid(reply);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({ dry_run: z.boolean().default(false), only: z.array(z.enum(REGISTRY_FIELDS as [string, ...string[]])).optional() }).parse(req.body ?? {});
      const sess = req.session;
      const T = sess.tenantId;
      const { s, c } = await withTenant(T, async (tx) => {
        const [c] = await tx`SELECT id, vat, address_country, name, trade_name, tax_office, activity, address_street, address_postal, address_city FROM customers WHERE id = ${id}`;
        return { s: await load(tx, T), c };
      });
      if (!c) return reply.code(404).send({ error: 'not_found' });
      if (!c.vat) return reply.code(400).send({ error: 'no_vat' });
      let result;
      try { result = await lookupRegistry(s, c.address_country || 'GR', c.vat); }
      catch (e) { return reply.code(502).send(errorOf(e)); }
      const plan = plannedChanges(c, result, s);
      const apply = Object.fromEntries(Object.entries(plan).filter(([f]) => !b.only || b.only.includes(f)).map(([f, v]) => [f, v!.to]));
      if (b.dry_run || !Object.keys(apply).length) return { result, changes: plan, applied: [] };
      await withTenant(T, async (tx) => {
        await tx`UPDATE customers SET ${tx(apply)}, updated_at = now() WHERE id = ${id}`;
        await tx`INSERT INTO activities (tenant_id, customer_id, actor_id, kind, title, body)
                 VALUES (${T}, ${id}, ${sess.userId}, 'note', ${`Ενημέρωση από ${result.source === 'aade' ? 'ΑΑΔΕ' : 'VIES'}`},
                         ${Object.entries(plan).filter(([f]) => f in apply).map(([f, v]) => `${f}: ${v!.from ?? '—'} → ${v!.to}`).join(' · ')})`;
        await emitEntityEvents(tx, T, 'customer', 'updated', [id], { type: 'user', user_id: sess.userId });
      });
      return { result, changes: plan, applied: Object.keys(apply) };
    });
  });
}
