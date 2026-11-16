// Offers workflow: create → versions → submit for approval → approve/reject → send → customer accepts/rejects
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { decodeCursor, encodeCursor, searchKey, sql, withTenant, type Tx } from '../db.js';
import { APPROVAL_LEVEL, can, requireAuth, type Session } from '../auth.js';
import { publish } from '../realtime.js';
import { enqueue } from '../jobs.js';
import { env } from '../env.js';
import { audit } from './settings.js';
import { emitEvents, type EventSource, type WebhookEvent } from '../webhooks.js';

/** Webhook event with the offer's current headline data. */
async function offerEvent(tx: Tx, tenantId: string, id: string, event: WebhookEvent, source: EventSource) {
  const [o] = await tx`
    SELECT o.id, o.number, o.status, o.current_version AS version, o.total_amount::float8 AS total, o.valid_until,
           o.customer_id, c.external_id AS customer_external_id, c.name AS customer_name
    FROM offers o JOIN customers c ON c.id = o.customer_id WHERE o.id = ${id}`;
  if (o) await emitEvents(tx, tenantId, [{ event, data: { ...o } }], source);
}
const by = (s: Session): EventSource => ({ type: 'user', user_id: s.userId });

const STATUSES = ['draft', 'in_progress', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected'] as const;
const EDITABLE = new Set(['draft', 'in_progress', 'approved', 'sent', 'rejected']);

const itemSchema = z.object({
  product_id: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(20).default('τεμ.'),
  quantity: z.coerce.number().positive().max(1e7),
  unit_price: z.coerce.number().min(0).max(1e9),
  discount: z.coerce.number().min(0).max(100).default(0),
  vat_rate: z.coerce.number().min(0).max(100).default(24),
});
type Item = z.infer<typeof itemSchema>;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Server-side totals: never trust amounts sent by the client. */
function computeLines(items: Item[]) {
  const lines = items.map((it, i) => {
    const net = r2(it.quantity * it.unit_price * (1 - it.discount / 100));
    return { ...it, position: i + 1, net, vat: r2(net * it.vat_rate / 100) };
  });
  const net = r2(lines.reduce((a, l) => a + l.net, 0));
  const vat = r2(lines.reduce((a, l) => a + l.vat, 0));
  return { lines, net, vat, total: r2(net + vat) };
}

async function insertVersion(tx: Tx, s: Session, offerId: string, version: number, items: Item[], note?: string | null) {
  const c = computeLines(items);
  const [v] = await tx`
    INSERT INTO offer_versions (tenant_id, offer_id, version, net_amount, vat_amount, total_amount, created_by, note)
    VALUES (${s.tenantId}, ${offerId}, ${version}, ${c.net}, ${c.vat}, ${c.total}, ${s.userId}, ${note ?? null})
    RETURNING id`;
  if (c.lines.length) {
    await tx`INSERT INTO offer_items ${tx(c.lines.map((l) => ({
      tenant_id: s.tenantId, version_id: v.id, position: l.position, product_id: l.product_id ?? null,
      description: l.description, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price,
      discount: l.discount, vat_rate: l.vat_rate, net_amount: l.net, vat_amount: l.vat,
    })))}`;
  }
  return c;
}

/** Atomic per-tenant, per-year sequence: OFF-2026-0049 */
async function nextNumber(tx: Tx, tenantId: string) {
  const year = new Date().getFullYear();
  const [t] = await tx`SELECT offer_prefix FROM tenants WHERE id = ${tenantId}`;
  const [r] = await tx`
    INSERT INTO tenant_counters (tenant_id, key, value) VALUES (${tenantId}, ${'offer_seq:' + year}, 1)
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 1
    RETURNING value`;
  return `${t?.offer_prefix ?? 'OFF'}-${year}-${String(r.value).padStart(4, '0')}`;
}

async function usersWithRole(tx: Tx, tenantId: string, minRole: string) {
  // Everyone whose role may sign this step (role approval level ≥ step level)
  const rows = await tx`
    SELECT m.user_id FROM memberships m JOIN roles r ON r.tenant_id = m.tenant_id AND r.key = m.role
    WHERE m.tenant_id = ${tenantId} AND r.approval_level >= ${APPROVAL_LEVEL[minRole] ?? 99}`;
  return rows.map((r) => r.user_id as string);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logActivity(tx: Tx, s: Session, offer: Record<string, any>, kind: string, title: string, body?: string) {
  await tx`INSERT INTO activities (tenant_id, customer_id, offer_id, actor_id, kind, title, body)
           VALUES (${s.tenantId}, ${offer.customer_id}, ${offer.id}, ${s.userId}, ${kind}, ${title}, ${body ?? null})`;
}

const appUrl = (path: string) => `${env.appUrl.replace(/\/$/, '')}${path}`;

export default async function offerRoutes(app: FastifyInstance) {
  // ======================= Authenticated =======================
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/products', async (req) => {
      const q = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
      const key = q.q ? `%${searchKey(q.q)}%` : null;
      const T = req.session.tenantId;
      return withTenant(T, (tx) => tx`
        SELECT id, sku, name, unit, unit_price, vat_rate FROM products
        WHERE tenant_id = ${T} AND active ${key ? tx`AND search LIKE ${key}` : tx``}
        ORDER BY name LIMIT 20`);
    });

    r.get('/companies', async (req) => {
      const T = req.session.tenantId;
      return withTenant(T, (tx) => tx`SELECT id, name, vat FROM companies WHERE tenant_id = ${T} ORDER BY name`);
    });

    r.get('/approval-flow', async (req) => {
      const T = req.session.tenantId;
      return withTenant(T, (tx) => tx`SELECT step, title, required_role, min_amount FROM approval_flow_steps WHERE tenant_id = ${T} ORDER BY step`);
    });

    r.put('/approval-flow', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const steps = z.array(z.object({
        title: z.string().trim().min(1).max(100),
        required_role: z.enum(['sales', 'manager', 'admin', 'owner']),
        min_amount: z.coerce.number().min(0).default(0),
      })).max(10).parse(req.body);
      const T = req.session.tenantId;
      await withTenant(T, async (tx) => {
        await tx`DELETE FROM approval_flow_steps WHERE tenant_id = ${T}`;
        if (steps.length) await tx`INSERT INTO approval_flow_steps ${tx(steps.map((s, i) => ({ tenant_id: T, step: i + 1, ...s })))}`;
        await audit(tx, req.session, 'approvals.update', null, steps);
      });
      return { ok: true };
    });

    // ---- List (keyset) ----
    r.get('/offers', async (req) => {
      const q = z.object({
        status: z.enum(STATUSES).optional(),
        customer: z.string().uuid().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }).parse(req.query);
      const cur = decodeCursor<[string, string]>(q.cursor);
      const T = req.session.tenantId;
      return withTenant(T, async (tx) => {
        const rows = await tx`
          SELECT o.id, o.number, o.status, o.current_version, o.total_amount, o.valid_until, o.created_at,
                 c.name AS customer_name, b.name AS branch_name
          FROM offers o
          JOIN customers c ON c.id = o.customer_id
          LEFT JOIN branches b ON b.id = o.branch_id
          WHERE o.tenant_id = ${T}
            ${q.status ? tx`AND o.status = ${q.status}` : tx``}
            ${q.customer ? tx`AND o.customer_id = ${q.customer}` : tx``}
            ${cur ? tx`AND (o.created_at, o.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT ${q.limit + 1}`;
        const more = rows.length > q.limit;
        const items = more ? rows.slice(0, q.limit) : rows;
        const last = items.at(-1);
        return { items, nextCursor: more && last ? encodeCursor([last.created_at, last.id]) : null };
      });
    });

    // ---- Create ----
    r.post('/offers', async (req, reply) => {
      if (!can(req.session, 'offers.edit')) return reply.code(403).send({ error: 'forbidden' });
      const b = z.object({
        customer_id: z.string().uuid(),
        branch_id: z.string().uuid().nullish(),
        space_id: z.string().uuid().nullish(),
        company_id: z.string().uuid().nullish(),
        valid_until: z.coerce.date().nullish(),
        notes: z.string().max(5000).nullish(),
        items: z.array(itemSchema).min(1).max(500),
      }).parse(req.body);
      const s = req.session;
      const offer = await withTenant(s.tenantId, async (tx) => {
        const number = await nextNumber(tx, s.tenantId);
        const [o] = await tx`
          INSERT INTO offers (tenant_id, number, customer_id, branch_id, space_id, company_id, owner_id, status, current_version, valid_until, notes)
          VALUES (${s.tenantId}, ${number}, ${b.customer_id}, ${b.branch_id ?? null}, ${b.space_id ?? null},
                  ${b.company_id ?? null}, ${s.userId}, 'draft', 1, ${b.valid_until ?? null}, ${b.notes ?? null})
          RETURNING id, number, customer_id`;
        await offerEvent(tx, s.tenantId, o.id, 'offer.created', by(s));
        const c = await insertVersion(tx, s, o.id, 1, b.items);
        await tx`UPDATE offers SET net_amount = ${c.net}, vat_amount = ${c.vat}, total_amount = ${c.total} WHERE id = ${o.id}`;
        await logActivity(tx, s, o, 'offer_updated', 'Νέα προσφορά', `${o.number} · v.01`);
        return o;
      });
      await publish({ tenantId: s.tenantId, type: 'offer.updated', data: { id: offer.id } });
      return reply.code(201).send(offer);
    });

    // ---- Detail (any version) ----
    r.get('/offers/:id', async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { version } = z.object({ version: z.coerce.number().int().positive().optional() }).parse(req.query);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const [offer] = await tx`
          SELECT o.*, c.name AS customer_name, b.name AS branch_name, sp.name AS space_name,
                 co.name AS company_name, co.vat AS company_vat, u.full_name AS owner_name
          FROM offers o JOIN customers c ON c.id = o.customer_id
          LEFT JOIN branches b ON b.id = o.branch_id
          LEFT JOIN spaces sp ON sp.id = o.space_id
          LEFT JOIN companies co ON co.id = o.company_id
          LEFT JOIN users u ON u.id = o.owner_id
          WHERE o.id = ${id}`;
        if (!offer) return reply.code(404).send({ error: 'not_found' });
        const v = version ?? offer.current_version;
        const versions = await tx`
          SELECT v.version, v.net_amount, v.vat_amount, v.total_amount, v.created_at, v.note, u.full_name AS created_by_name
          FROM offer_versions v LEFT JOIN users u ON u.id = v.created_by
          WHERE v.tenant_id = ${s.tenantId} AND v.offer_id = ${id} ORDER BY v.version DESC`;
        const items = await tx`
          SELECT i.id, i.position, i.product_id, i.description, i.unit, i.quantity, i.unit_price, i.discount, i.vat_rate, i.net_amount, i.vat_amount
          FROM offer_items i JOIN offer_versions v ON v.id = i.version_id
          WHERE v.tenant_id = ${s.tenantId} AND v.offer_id = ${id} AND v.version = ${v}
          ORDER BY i.position`;
        const approvals = await tx`
          SELECT a.id, a.step, a.title, a.required_role, a.status, a.decided_at, a.comment, u.full_name AS approver_name
          FROM offer_approvals a LEFT JOIN users u ON u.id = a.approver_id
          WHERE a.offer_id = ${id} AND a.version = ${offer.current_version} ORDER BY a.step`;
        const nextStep = approvals.find((a) => a.status === 'pending');
        const { public_token, ...rest } = offer;
        return {
          offer: rest,
          version: v,
          versions,
          items,
          approvals,
          publicUrl: public_token ? appUrl(`/el/p/${public_token}`) : null,
          can: {
            edit: EDITABLE.has(offer.status) && can(s, 'offers.edit'),
            submit: ['draft', 'in_progress'].includes(offer.status) && can(s, 'offers.edit'),
            approve: offer.status === 'pending_approval' && !!nextStep && (s.level ?? 0) >= (APPROVAL_LEVEL[nextStep.required_role] ?? 99),
            send: ['approved', 'sent'].includes(offer.status) && can(s, 'offers.edit'),
          },
        };
      });
    });

    // ---- New version (edit items) ----
    r.put('/offers/:id/items', async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({
        items: z.array(itemSchema).min(1).max(500),
        note: z.string().max(500).nullish(),
        valid_until: z.coerce.date().nullish(),
        branch_id: z.string().uuid().nullish(),
        space_id: z.string().uuid().nullish(),
        company_id: z.string().uuid().nullish(),
        notes: z.string().max(5000).nullish(),
      }).parse(req.body);
      const s = req.session;
      if (!can(s, 'offers.edit')) return reply.code(403).send({ error: 'forbidden' });
      const res = await withTenant(s.tenantId, async (tx) => {
        const [o] = await tx`SELECT id, number, status, current_version, customer_id FROM offers WHERE id = ${id} FOR UPDATE`;
        if (!o) return { code: 404 as const };
        if (!EDITABLE.has(o.status)) return { code: 409 as const };
        const v = o.current_version + 1;
        const c = await insertVersion(tx, s, id, v, b.items, b.note);
        // A new version invalidates previous approvals and the public link
        await tx`
          UPDATE offers SET current_version = ${v}, status = 'draft', public_token = NULL, sent_at = NULL,
                 net_amount = ${c.net}, vat_amount = ${c.vat}, total_amount = ${c.total}, updated_at = now(),
                 valid_until = coalesce(${b.valid_until ?? null}, valid_until),
                 branch_id = ${b.branch_id === undefined ? tx`branch_id` : b.branch_id},
                 space_id = ${b.space_id === undefined ? tx`space_id` : b.space_id},
                 company_id = ${b.company_id === undefined ? tx`company_id` : b.company_id},
                 notes = ${b.notes === undefined ? tx`notes` : b.notes}
          WHERE id = ${id}`;
        await logActivity(tx, s, o, 'offer_updated', 'Νέα έκδοση προσφοράς', `${o.number} · v.${String(v).padStart(2, '0')}`);
        return { code: 200 as const, version: v };
      });
      if (res.code !== 200) return reply.code(res.code).send({ error: res.code === 404 ? 'not_found' : 'not_editable' });
      await publish({ tenantId: s.tenantId, type: 'offer.updated', data: { id } });
      const { code: _code, ...body } = res;
      return body;
    });

    // ---- Submit for approval (creates steps from the tenant's flow) ----
    r.post('/offers/:id/submit', async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [o] = await tx`SELECT id, number, status, current_version, customer_id, net_amount FROM offers WHERE id = ${id} FOR UPDATE`;
        if (!o) return { code: 404 as const };
        if (!['draft', 'in_progress'].includes(o.status)) return { code: 409 as const };
        const steps = await tx`
          SELECT step, title, required_role FROM approval_flow_steps
          WHERE tenant_id = ${s.tenantId} AND min_amount <= ${o.net_amount} ORDER BY step`;
        await tx`DELETE FROM offer_approvals WHERE offer_id = ${id} AND version = ${o.current_version}`;
        if (!steps.length) {
          await tx`UPDATE offers SET status = 'approved', updated_at = now() WHERE id = ${id}`;
          await offerEvent(tx, s.tenantId, id, 'offer.approved', by(s));
          await logActivity(tx, s, o, 'approval', 'Αυτόματη έγκριση', `${o.number} · κάτω από τα όρια έγκρισης`);
          return { code: 200 as const, status: 'approved' };
        }
        await tx`INSERT INTO offer_approvals ${tx(steps.map((st, i) => ({
          tenant_id: s.tenantId, offer_id: id, version: o.current_version, step: i + 1, title: st.title, required_role: st.required_role,
        })))}`;
        await tx`UPDATE offers SET status = 'pending_approval', updated_at = now() WHERE id = ${id}`;
        await offerEvent(tx, s.tenantId, id, 'offer.submitted', by(s));
        await logActivity(tx, s, o, 'offer_updated', 'Υποβολή για έγκριση', `${o.number} · ${steps[0].title}`);
        const approvers = (await usersWithRole(tx, s.tenantId, steps[0].required_role)).filter((u) => u !== s.userId);
        if (approvers.length) {
          await enqueue('notify', {
            tenantId: s.tenantId, userIds: approvers, title: `Αίτημα έγκρισης: ${o.number}`,
            body: `Βήμα: ${steps[0].title}`, url: `/el/offers/${id}`,
          }, tx);
        }
        return { code: 200 as const, status: 'pending_approval' };
      });
      if (res.code !== 200) return reply.code(res.code).send({ error: res.code === 404 ? 'not_found' : 'invalid_status' });
      await publish({ tenantId: s.tenantId, type: 'offer.updated', data: { id } });
      const { code: _code, ...body } = res;
      return body;
    });

    // ---- Approve / reject the current step ----
    r.post('/offers/:id/decision', async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({ decision: z.enum(['approve', 'reject']), comment: z.string().max(1000).nullish() }).parse(req.body);
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [o] = await tx`SELECT id, number, status, current_version, customer_id, owner_id FROM offers WHERE id = ${id} FOR UPDATE`;
        if (!o) return { code: 404 as const, error: 'not_found' };
        if (o.status !== 'pending_approval') return { code: 409 as const, error: 'invalid_status' };
        const [step] = await tx`
          SELECT id, step, title, required_role FROM offer_approvals
          WHERE offer_id = ${id} AND version = ${o.current_version} AND status = 'pending' ORDER BY step LIMIT 1`;
        if (!step) return { code: 409 as const, error: 'nothing_to_approve' };
        if ((s.level ?? 0) < (APPROVAL_LEVEL[step.required_role] ?? 99)) return { code: 403 as const, error: 'forbidden' };

        await tx`UPDATE offer_approvals SET status = ${b.decision === 'approve' ? 'approved' : 'rejected'},
                   approver_id = ${s.userId}, decided_at = now(), comment = ${b.comment ?? null} WHERE id = ${step.id}`;

        let status = 'pending_approval';
        let notify: { users: string[]; title: string; body: string } | null = null;
        if (b.decision === 'reject') {
          status = 'in_progress';
          await logActivity(tx, s, o, 'approval', 'Απόρριψη έγκρισης', `${step.title}${b.comment ? ' · ' + b.comment : ''}`);
          notify = { users: [o.owner_id], title: `Επιστροφή για αλλαγές: ${o.number}`, body: b.comment || step.title };
        } else {
          const [next] = await tx`
            SELECT step, title, required_role FROM offer_approvals
            WHERE offer_id = ${id} AND version = ${o.current_version} AND status = 'pending' ORDER BY step LIMIT 1`;
          await logActivity(tx, s, o, 'approval', 'Έγκριση προσφοράς', `${step.title} · ${o.number}`);
          if (next) {
            const approvers = (await usersWithRole(tx, s.tenantId, next.required_role)).filter((u) => u !== s.userId);
            if (approvers.length) await enqueue('notify', { tenantId: s.tenantId, userIds: approvers, title: `Αίτημα έγκρισης: ${o.number}`, body: `Βήμα: ${next.title}`, url: `/el/offers/${id}` }, tx);
            notify = { users: [o.owner_id], title: `Έγκριση βήματος: ${o.number}`, body: step.title };
          } else {
            status = 'approved';
            notify = { users: [o.owner_id], title: `Εγκρίθηκε: ${o.number}`, body: 'Η προσφορά είναι έτοιμη για αποστολή' };
          }
        }
        if (status !== 'pending_approval') await tx`UPDATE offers SET status = ${status}, updated_at = now() WHERE id = ${id}`;
        if (status === 'approved') await offerEvent(tx, s.tenantId, id, 'offer.approved', by(s));
        if (notify && notify.users[0] && notify.users[0] !== s.userId) {
          await enqueue('notify', { tenantId: s.tenantId, userIds: notify.users, title: notify.title, body: notify.body, url: `/el/offers/${id}` }, tx);
        }
        return { code: 200 as const, status };
      });
      if (res.code !== 200) return reply.code(res.code).send({ error: res.error });
      await publish({ tenantId: s.tenantId, type: 'offer.updated', data: { id, status: res.status } });
      const { code: _code, ...body } = res;
      return body;
    });

    // ---- Send to customer: public link (+ email if SMTP configured) ----
    r.post('/offers/:id/send', async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({ email: z.string().email().nullish(), message: z.string().max(2000).nullish(), locale: z.enum(['el', 'en']).default('el') }).parse(req.body ?? {});
      const s = req.session;
      const res = await withTenant(s.tenantId, async (tx) => {
        const [o] = await tx`
          SELECT o.id, o.number, o.status, o.customer_id, o.public_token, o.current_version, c.name AS customer_name, t.name AS tenant_name
          FROM offers o JOIN customers c ON c.id = o.customer_id JOIN tenants t ON t.id = o.tenant_id
          WHERE o.id = ${id} FOR UPDATE OF o`;
        if (!o) return { code: 404 as const };
        if (!['approved', 'sent'].includes(o.status)) return { code: 409 as const };
        const token = o.public_token ?? randomBytes(24).toString('base64url');
        await tx`UPDATE offers SET status = 'sent', public_token = ${token}, sent_at = now(), sent_to = ${b.email ?? null}, updated_at = now() WHERE id = ${id}`;
        await offerEvent(tx, s.tenantId, id, 'offer.sent', by(s));
        const url = appUrl(`/${b.locale}/p/${token}`);
        if (b.email) {
          await enqueue('email', {
            to: b.email,
            subject: `${o.tenant_name}: ${b.locale === 'el' ? 'Προσφορά' : 'Offer'} ${o.number}`,
            text: `${b.message ? b.message + '\n\n' : ''}${b.locale === 'el' ? 'Δείτε και αποδεχτείτε την προσφορά' : 'View and accept the offer'}: ${url}`,
          }, tx);
        }
        await logActivity(tx, s, o, 'email_sent', 'Αποστολή προσφοράς', `${o.number} · v.${String(o.current_version).padStart(2, '0')}${b.email ? ' → ' + b.email : ''}`);
        return { code: 200 as const, url, emailed: !!b.email && env.smtpConfigured };
      });
      if (res.code !== 200) return reply.code(res.code).send({ error: res.code === 404 ? 'not_found' : 'not_approved' });
      await publish({ tenantId: s.tenantId, type: 'offer.updated', data: { id } });
      const { code: _code, ...body } = res;
      return body;
    });
  });

  // ======================= Public (customer link, no login) =======================
  const tokenParam = z.object({ token: z.string().min(20).max(64).regex(/^[A-Za-z0-9_-]+$/) });

  // The token is the only key here: unguessable (192 bits), cleared when a new version is created.
  async function loadPublic(token: string) {
    const [o] = await sql`
      SELECT o.id, o.tenant_id, o.number, o.status, o.current_version, o.net_amount, o.vat_amount, o.total_amount,
             o.valid_until, o.sent_at, o.responded_at, o.responder_name, o.notes, o.owner_id, o.customer_id,
             c.name AS customer_name, b.name AS branch_name, sp.name AS space_name,
             co.name AS company_name, co.vat AS company_vat, t.name AS tenant_name, u.full_name AS owner_name, u.email AS owner_email
      FROM offers o JOIN customers c ON c.id = o.customer_id JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN branches b ON b.id = o.branch_id LEFT JOIN spaces sp ON sp.id = o.space_id
      LEFT JOIN companies co ON co.id = o.company_id LEFT JOIN users u ON u.id = o.owner_id
      WHERE o.public_token = ${token}`;
    return o;
  }

  app.get('/public/offers/:token', async (req, reply) => {
    const { token } = tokenParam.parse(req.params);
    const o = await loadPublic(token);
    if (!o) return reply.code(404).send({ error: 'not_found' });
    const items = await sql`
      SELECT i.position, i.description, i.unit, i.quantity, i.unit_price, i.discount, i.vat_rate, i.net_amount, i.vat_amount
      FROM offer_items i JOIN offer_versions v ON v.id = i.version_id
      WHERE v.tenant_id = ${o.tenant_id} AND v.offer_id = ${o.id} AND v.version = ${o.current_version} ORDER BY i.position`;
    const { id: _i, tenant_id: _t, owner_id: _o, customer_id: _c, ...pub } = o;
    const expired = !!o.valid_until && new Date(o.valid_until) < new Date(new Date().toDateString());
    return { offer: pub, items, expired };
  });

  app.post('/public/offers/:token/respond', async (req, reply) => {
    const { token } = tokenParam.parse(req.params);
    const b = z.object({ decision: z.enum(['accept', 'reject']), name: z.string().trim().min(2).max(120), note: z.string().max(2000).nullish() }).parse(req.body);
    const o = await loadPublic(token);
    if (!o) return reply.code(404).send({ error: 'not_found' });
    if (o.status !== 'sent') return reply.code(409).send({ error: 'already_responded' });
    if (o.valid_until && new Date(o.valid_until) < new Date(new Date().toDateString())) return reply.code(410).send({ error: 'expired' });
    const status = b.decision === 'accept' ? 'accepted' : 'rejected';
    await withTenant(o.tenant_id, async (tx) => {
      const [u] = await tx`
        UPDATE offers SET status = ${status}, responded_at = now(), responder_name = ${b.name}, response_note = ${b.note ?? null}, updated_at = now()
        WHERE id = ${o.id} AND status = 'sent' RETURNING id`;
      if (!u) return;
      await offerEvent(tx, o.tenant_id, o.id, status === 'accepted' ? 'offer.accepted' : 'offer.rejected', { type: 'customer' });
      await tx`INSERT INTO activities (tenant_id, customer_id, offer_id, kind, title, body)
               VALUES (${o.tenant_id}, ${o.customer_id}, ${o.id}, 'approval',
                       ${status === 'accepted' ? 'Αποδοχή από τον πελάτη' : 'Απόρριψη από τον πελάτη'},
                       ${`${o.number} · ${b.name}${b.note ? ' · ' + b.note : ''}`})`;
      if (o.owner_id) {
        await enqueue('notify', {
          tenantId: o.tenant_id, userIds: [o.owner_id],
          title: status === 'accepted' ? `🎉 Αποδοχή: ${o.number}` : `Απόρριψη: ${o.number}`,
          body: `${o.customer_name} · ${b.name}`, url: `/el/offers/${o.id}`,
        }, tx);
      }
    });
    await publish({ tenantId: o.tenant_id, type: 'offer.updated', data: { id: o.id, status } });
    return { ok: true, status };
  });
}
