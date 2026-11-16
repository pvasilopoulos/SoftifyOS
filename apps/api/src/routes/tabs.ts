// In-app tabs sync: each device publishes its open tabs; the others list them ("Tabs from other devices").
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { requireAuth } from '../auth.js';

const deviceId = z.string().regex(/^[A-Za-z0-9_-]{4,40}$/);
// Only links inside the app (/el/… or /en/…), never external URLs
const tab = z.object({
  url: z.string().max(500).regex(/^\/(el|en)(\/|\?|$)/).refine((u) => !u.includes('embed=1')),
  title: z.string().trim().max(120),
  icon: z.string().regex(/^[a-z-]{2,20}$/),
});

export default async function tabRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.put('/me/tabs', { bodyLimit: 100_000 }, async (req) => {
      const b = z.object({ device_id: deviceId, device_label: z.string().trim().min(1).max(80), tabs: z.array(tab).max(60) }).parse(req.body);
      const { tenantId, userId } = req.session;
      await withTenant(tenantId, (tx) => tx`
        INSERT INTO user_tabs (tenant_id, user_id, device_id, device_label, tabs) VALUES (${tenantId}, ${userId}, ${b.device_id}, ${b.device_label}, ${tx.json(b.tabs)})
        ON CONFLICT (tenant_id, user_id, device_id) DO UPDATE SET device_label = excluded.device_label, tabs = excluded.tabs, updated_at = now()`);
      return { ok: true };
    });

    // The user's other devices active in the last 30 days (newest first)
    r.get('/me/tabs/devices', async (req) => {
      const { device } = z.object({ device: deviceId.optional() }).parse(req.query);
      const { tenantId, userId } = req.session;
      return withTenant(tenantId, (tx) => tx`
        SELECT device_id, device_label, tabs, updated_at FROM user_tabs
        WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND device_id IS DISTINCT FROM ${device ?? null}
          AND updated_at > now() - interval '30 days' AND jsonb_array_length(tabs) > 0
        ORDER BY updated_at DESC LIMIT 10`);
    });
  });
}
