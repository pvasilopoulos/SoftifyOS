import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { requireAuth } from '../auth.js';
import { addClient } from '../realtime.js';
import { enqueue } from '../jobs.js';
import { env } from '../env.js';

export default async function liveRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Server-Sent Events stream (works through nginx/Plesk with buffering disabled)
  app.get('/stream', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\nevent: ready\ndata: {}\n\n');
    const remove = addClient(req.session.tenantId, { userId: req.session.userId, reply });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => { clearInterval(ping); remove(); });
  });

  // ---- Notifications ----
  app.get('/notifications', async (req) => {
    const { tenantId, userId } = req.session;
    return withTenant(tenantId, async (tx) => {
      const items = await tx`
        SELECT id, title, body, url, read_at, created_at FROM notifications
        WHERE tenant_id = ${tenantId} AND user_id = ${userId} ORDER BY created_at DESC LIMIT 50`;
      const [{ unread }] = await tx`SELECT count(*)::int AS unread FROM notifications WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND read_at IS NULL`;
      return { items, unread };
    });
  });

  app.post('/notifications/read', async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200).optional() }).parse(req.body ?? {});
    const { tenantId, userId } = req.session;
    await withTenant(tenantId, (tx) => tx`
      UPDATE notifications SET read_at = now()
      WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND read_at IS NULL ${ids ? tx`AND id = ANY(${ids}::uuid[])` : tx``}`);
    return { ok: true };
  });

  // ---- Web Push ----
  app.get('/push/public-key', async () => ({ key: env.vapidPublic }));

  app.post('/push/subscribe', async (req) => {
    const s = z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
    }).parse(req.body);
    const { tenantId, userId } = req.session;
    await withTenant(tenantId, async (tx) => {
      // A device can only belong to one user: drop any previous owner within this tenant first
      await tx`DELETE FROM push_subscriptions WHERE endpoint = ${s.endpoint}`;
      await tx`
        INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
        VALUES (${tenantId}, ${userId}, ${s.endpoint}, ${s.keys.p256dh}, ${s.keys.auth}, ${req.headers['user-agent'] ?? null})`;
    });
    return { ok: true };
  });

  app.post('/push/unsubscribe', async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
    const { tenantId, userId } = req.session;
    await withTenant(tenantId, (tx) => tx`DELETE FROM push_subscriptions WHERE tenant_id = ${tenantId} AND endpoint = ${endpoint} AND user_id = ${userId}`);
    return { ok: true };
  });

  // Sends a test notification to the current user (in-app + push on all their devices)
  app.post('/push/test', async (req) => {
    const { tenantId, userId } = req.session;
    await enqueue('notify', { tenantId, userIds: [userId], title: 'SoftifyOS', body: 'Οι ειδοποιήσεις λειτουργούν! / Notifications work!', url: '/' });
    return { ok: true };
  });
}
