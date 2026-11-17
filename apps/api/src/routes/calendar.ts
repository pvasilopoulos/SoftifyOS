// Calendar sync: connect Google / Microsoft 365 (OAuth), settings per connection, "busy" blocks from the external calendar.
import type { FastifyInstance } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { COOKIE, requireAuth } from '../auth.js';
import { env } from '../env.js';
import { audit } from './settings.js';
import { authUrl, CalendarError, disconnect, exchangeCode, oauthApp, PROVIDERS, pullBusy, queueFullPush, type Provider } from '../calendar.js';
import { decryptSecret, encryptSecret } from '../registries.js';

const key = new TextEncoder().encode(env.jwtSecret);
const providerParam = z.object({ provider: z.enum(['google', 'microsoft']) });
const idParam = z.object({ id: z.string().uuid() });

export default async function calendarRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- OAuth callback (browser redirect from Google / Microsoft)
  app.get('/calendar/oauth/:provider/callback', async (req, reply) => {
    const { provider } = providerParam.parse(req.params);
    const q = req.query as { code?: string; state?: string; error?: string };
    let locale = 'el';
    let purpose: 'calendar' | 'mail' = 'calendar';
    const back = (result: string) => reply.redirect(purpose === 'mail'
      ? `/${locale}/settings?s=email&mail=${encodeURIComponent(result)}`
      : `/${locale}/calendar?sync=${encodeURIComponent(result)}`);
    let st: { u: string; t: string; p: Provider; l: string; k?: 'calendar' | 'mail' };
    try {
      const { payload } = await jwtVerify(q.state ?? '', key, { audience: 'calendar-oauth' });
      st = payload as typeof st;
      locale = st.l === 'en' ? 'en' : 'el';
      purpose = st.k === 'mail' ? 'mail' : 'calendar';
    } catch { return back('invalid_state'); }
    if (st.p !== provider) return back('invalid_state');
    // The browser that comes back must be the same signed-in user who started (protects against a swapped link)
    const cookie = req.cookies[COOKIE];
    if (cookie) {
      try {
        const { payload } = await jwtVerify(cookie, key);
        if (payload.sub !== st.u || payload.tid !== st.t) return back('wrong_user');
      } catch { /* expired session: the signed state is enough */ }
    }
    if (q.error || !q.code) return back(q.error === 'access_denied' ? 'denied' : 'error');
    const app = await oauthApp(provider, st.t);
    if (!app) return back('error');
    if (purpose === 'mail') {
      // Organisation mailbox: emails go out through Gmail API / Microsoft Graph from this address
      try {
        const tok = await exchangeCode(provider, q.code, 'mail', app);
        if (!tok.account_email) return back('error');
        const secret = { provider, email: tok.account_email, refresh: decryptSecret(tok.refresh_enc), access: decryptSecret(tok.access_enc), expires_at: tok.expires_at.toISOString() };
        const meta = { provider, email: tok.account_email, status: 'active', set_by: st.u, set_at: new Date().toISOString() };
        await withTenant(st.t, async (tx) => {
          await tx`UPDATE tenants SET mail_oauth_enc = ${encryptSecret(JSON.stringify(secret))}, mail_oauth_meta = ${tx.json(meta as never)}, updated_at = now() WHERE id = ${st.t}`;
          await tx`INSERT INTO audit_log (tenant_id, actor_id, action, entity, details) VALUES (${st.t}, ${st.u}, 'email.mailbox_connect', null, ${tx.json({ provider, email: tok.account_email } as never)})`;
        });
        return back(`connected_${provider}`);
      } catch (e) {
        req.log.warn({ err: (e as Error).message }, 'mailbox oauth failed');
        return back((e as Error).message === 'no_refresh_token' ? 'no_refresh' : 'error');
      }
    }
    try {
      const tok = await exchangeCode(provider, q.code, 'calendar', app);
      const id = await withTenant(st.t, async (tx) => {
        const [c] = await tx`
          INSERT INTO calendar_connections (tenant_id, user_id, provider, account_email, access_enc, refresh_enc, expires_at)
          VALUES (${st.t}, ${st.u}, ${provider}, ${tok.account_email}, ${tok.access_enc}, ${tok.refresh_enc}, ${tok.expires_at})
          ON CONFLICT (tenant_id, user_id, provider) DO UPDATE SET account_email = EXCLUDED.account_email, access_enc = EXCLUDED.access_enc,
            refresh_enc = EXCLUDED.refresh_enc, expires_at = EXCLUDED.expires_at, status = 'active', last_error = NULL
          RETURNING id`;
        await tx`INSERT INTO audit_log (tenant_id, actor_id, action, entity, details) VALUES (${st.t}, ${st.u}, 'calendar.connect', null, ${tx.json({ provider, account: tok.account_email } as never)})`;
        return c.id as string;
      });
      await queueFullPush(st.t, st.u);
      pullBusy(id).catch(() => {});
      return back(`connected_${provider}`);
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'calendar oauth failed');
      return back(e instanceof CalendarError && (e as Error).message === 'no_refresh_token' ? 'no_refresh' : 'error');
    }
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/calendar/sync', async (req) => {
      const s = req.session;
      const rows = await withTenant(s.tenantId, (tx) => tx`
        SELECT c.id, c.provider, c.account_email, c.push_enabled, c.import_busy, c.status, c.last_error, c.last_sync_at, c.created_at,
               (SELECT count(*)::int FROM calendar_event_links l WHERE l.connection_id = c.id) AS pushed,
               (SELECT count(*)::int FROM calendar_busy b WHERE b.connection_id = c.id) AS busy
        FROM calendar_connections c WHERE c.user_id = ${s.userId} ORDER BY c.created_at`);
      const providers = Object.fromEntries(await Promise.all(PROVIDERS.map(async (p) => [p, !!(await oauthApp(p, s.tenantId))] as const)));
      return { providers, connections: rows, impersonating: !!s.impersonator };
    });

    r.post('/calendar/oauth/:provider/start', async (req, reply) => {
      const { provider } = providerParam.parse(req.params);
      const s = req.session;
      if (s.impersonator) return reply.code(403).send({ error: 'impersonating' });   // never link someone else's calendar
      const app = await oauthApp(provider, s.tenantId);
      if (!app) return reply.code(409).send({ error: 'not_configured' });
      const { locale } = z.object({ locale: z.enum(['el', 'en']).default('el') }).parse(req.body ?? {});
      const state = await new SignJWT({ u: s.userId, t: s.tenantId, p: provider, l: locale })
        .setProtectedHeader({ alg: 'HS256' }).setAudience('calendar-oauth').setIssuedAt().setExpirationTime('15m').sign(key);
      return { url: authUrl(provider, state, 'calendar', app) };
    });

    r.patch('/calendar/connections/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const b = z.object({ push_enabled: z.boolean().optional(), import_busy: z.boolean().optional() }).parse(req.body);
      const s = req.session;
      const [c] = await withTenant(s.tenantId, (tx) => tx`
        UPDATE calendar_connections SET push_enabled = coalesce(${b.push_enabled ?? null}, push_enabled), import_busy = coalesce(${b.import_busy ?? null}, import_busy)
        WHERE id = ${id} AND user_id = ${s.userId} RETURNING id, push_enabled`);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      if (b.push_enabled) await queueFullPush(s.tenantId, s.userId);
      if (b.import_busy !== undefined) pullBusy(id).catch(() => {});
      return { ok: true };
    });

    r.post('/calendar/connections/:id/sync', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const [c] = await withTenant(s.tenantId, (tx) => tx`
        UPDATE calendar_connections SET status = CASE WHEN status = 'error' THEN 'active' ELSE status END, last_error = NULL
        WHERE id = ${id} AND user_id = ${s.userId} RETURNING id, status, push_enabled`);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      if (c.status === 'revoked') return reply.code(409).send({ error: 'revoked' });
      if (c.push_enabled) await queueFullPush(s.tenantId, s.userId);
      await pullBusy(id);
      return { ok: true };
    });

    r.delete('/calendar/connections/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      const [c] = await withTenant(s.tenantId, (tx) => tx`SELECT id, provider FROM calendar_connections WHERE id = ${id} AND user_id = ${s.userId}`);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      await disconnect(id);
      await withTenant(s.tenantId, (tx) => audit(tx, s, 'calendar.disconnect', null, { provider: c.provider }));
      return { ok: true };
    });

    /** My external events ("busy") in a range, for the SoftifyOS calendar. */
    r.get('/calendar/busy', async (req) => {
      const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
      const s = req.session;
      return withTenant(s.tenantId, (tx) => tx`
        SELECT b.external_id AS id, b.title, b.starts_at, b.ends_at, b.all_day, c.provider
        FROM calendar_busy b JOIN calendar_connections c ON c.id = b.connection_id
        WHERE b.user_id = ${s.userId} AND b.starts_at < ${q.to} AND b.ends_at > ${q.from}
        ORDER BY b.starts_at LIMIT 500`);
    });
  });
}
