// Settings → Email (sender, replies, signature, tracking, templates, own SMTP) and the open-tracking pixel.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, withTenant } from '../db.js';
import { can, requireAuth } from '../auth.js';
import { decryptSecret, encryptSecret } from '../registries.js';
import { audit } from './settings.js';
import { env } from '../env.js';
import { DEFAULT_TEMPLATES, emailSettingsSchema, makeTransport, readSettings, smtpSchema, TEMPLATE_KEYS, transportFor, withName } from '../email.js';

// 1×1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export default async function emailRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- public: open tracking
  app.get('/public/e/:token', async (req, reply) => {
    const token = String((req.params as { token: string }).token).replace(/\.gif$/, '');
    if (/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      // Owner connection (no tenant context): the token alone identifies the message
      await sql`UPDATE email_messages SET open_count = open_count + 1, opened_at = coalesce(opened_at, now()), last_open_at = now()
                WHERE track_token = ${token}`.catch(() => {});
    }
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return reply.type('image/gif').send(PIXEL);
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/settings/email', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      return withTenant(s.tenantId, async (tx) => {
        const [t] = await tx`SELECT email_settings, smtp_meta FROM tenants WHERE id = ${s.tenantId}`;
        const [stats] = await tx`
          SELECT count(*)::int AS sent, count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
                 count(*) FILTER (WHERE status = 'failed')::int AS failed
          FROM email_messages WHERE created_at > now() - interval '30 days'`;
        return {
          settings: readSettings(t.email_settings),
          defaults: DEFAULT_TEMPLATES,
          template_keys: TEMPLATE_KEYS,
          smtp: t.smtp_meta ?? null,
          server_smtp: env.smtpConfigured ? { host: env.smtp.host, from: env.smtp.from } : null,
          stats,
        };
      });
    });

    r.put('/settings/email', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const b = emailSettingsSchema.parse(req.body);
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET email_settings = ${tx.json(b as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'email.settings', null, { track_opens: b.track_opens, templates: Object.keys(b.templates) });
      });
      return { ok: true };
    });

    // ---- own SMTP (password stored encrypted, never returned)
    r.put('/settings/email/smtp', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const b = smtpSchema.extend({ keep_password: z.boolean().default(false) }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        let pass = b.pass ?? null;
        if (b.keep_password && !pass) {
          // Changing host/user without retyping the password: keep the stored one
          const [t] = await tx`SELECT smtp_enc FROM tenants WHERE id = ${s.tenantId}`;
          const old = t?.smtp_enc ? JSON.parse(decryptSecret(t.smtp_enc) ?? '{}') : {};
          pass = old.pass ?? null;
        }
        const conf = { host: b.host, port: b.port, secure: b.secure, user: b.user ?? null, pass, from: b.from };
        const meta = { host: b.host, port: b.port, secure: b.secure, user: b.user ?? null, from: b.from, has_password: !!pass, set_by: s.userId, set_at: new Date().toISOString() };
        await tx`UPDATE tenants SET smtp_enc = ${encryptSecret(JSON.stringify(conf))}, smtp_meta = ${tx.json(meta as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'email.smtp_set', null, { host: b.host, user: b.user ?? null });
        return meta;
      });
      return { ok: true, smtp: res };
    });

    r.delete('/settings/email/smtp', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET smtp_enc = NULL, smtp_meta = NULL, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'email.smtp_removed', null);
      });
      return { ok: true };
    });

    /** Connects and sends a test email to the signed-in user, with the typed settings (or the saved ones). */
    r.post('/settings/email/test', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const [me] = await withTenant(s.tenantId, (tx) => tx`SELECT email, full_name FROM users WHERE id = ${s.userId}`);
      let conf: z.infer<typeof smtpSchema> | null = null;
      if (body.host) {
        const p = smtpSchema.safeParse(body);
        if (!p.success) return { ok: false, error: 'invalid' };
        conf = p.data;
        if (!conf.pass && body.keep_password) {
          const [t] = await sql`SELECT smtp_enc FROM tenants WHERE id = ${s.tenantId}`;
          conf.pass = t?.smtp_enc ? JSON.parse(decryptSecret(t.smtp_enc) ?? '{}').pass ?? null : null;
        }
      }
      const tr = conf ? { transport: makeTransport(conf), from: conf.from } : await transportFor(s.tenantId);
      if (!tr) return { ok: false, error: 'not_configured' };
      try {
        await tr.transport.verify();
        await tr.transport.sendMail({
          from: withName(tr.from, null), to: me.email, subject: 'SoftifyOS: test email ✓',
          text: 'Η αποστολή email από το SoftifyOS λειτουργεί. / Email sending from SoftifyOS works.',
        });
        return { ok: true, to: me.email };
      } catch (e) {
        return { ok: false, error: 'smtp_error', detail: String((e as Error).message).slice(0, 300) };
      } finally {
        if (conf) tr.transport.close();
      }
    });

    // ---- message log (per offer / customer, or the latest)
    r.get('/emails', async (req) => {
      const q = z.object({ offer_id: z.string().uuid().optional(), customer_id: z.string().uuid().optional() }).parse(req.query);
      const s = req.session;
      return withTenant(s.tenantId, (tx) => tx`
        SELECT m.id, m.kind, m.to_addr, m.subject, m.status, m.error, m.open_count, m.opened_at, m.last_open_at, m.created_at, m.sent_at,
               m.offer_id, o.number AS offer_number, u.full_name AS user_name
        FROM email_messages m LEFT JOIN offers o ON o.id = m.offer_id LEFT JOIN users u ON u.id = m.user_id
        WHERE true ${q.offer_id ? tx`AND m.offer_id = ${q.offer_id}` : tx``} ${q.customer_id ? tx`AND m.customer_id = ${q.customer_id}` : tx``}
        ORDER BY m.created_at DESC LIMIT 50`);
    });
  });
}
