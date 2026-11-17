import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { env } from './env.js';
import { sql } from './db.js';
import { liveStats, startRealtime } from './realtime.js';
import { captureError, health } from './monitor.js';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';
import liveRoutes from './routes/live.js';
import offerRoutes from './routes/offers.js';
import customerRoutes from './routes/customers.js';
import settingsRoutes from './routes/settings.js';
import integrationRoutes from './routes/integration.js';
import integrationSettingsRoutes from './routes/integration-settings.js';
import brandingRoutes from './routes/branding.js';
import viewRoutes from './routes/views.js';
import tabRoutes from './routes/tabs.js';
import registryRoutes from './routes/registry.js';
import formRoutes from './routes/forms.js';
import crmRoutes from './routes/crm.js';
import documentRoutes from './routes/documents.js';
import taskRoutes from './routes/tasks.js';
import reportRoutes from './routes/reports.js';
import aiRoutes from './routes/ai.js';
import emailRoutes from './routes/email.js';
import calendarRoutes from './routes/calendar.js';
import billingRoutes from './routes/billing.js';

const app = Fastify({
  logger: { level: env.isProd ? 'info' : 'warn' },
  trustProxy: true, // behind nginx (Plesk)
  bodyLimit: 1_000_000,
});

await app.register(cookie);

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
  req.log.error(err);
  const code = (err as { statusCode?: number }).statusCode ?? 500;
  if (code >= 500) {
    captureError('api', err, { method: req.method, route: req.routeOptions?.url ?? req.url.split('?')[0], status: code, tenant: req.session?.tenantId ?? null });
  }
  reply.code(code).send({ error: code === 500 ? 'internal' : (err as Error).message });
});

// For uptime monitors (UptimeRobot, Better Stack…): 200 = healthy, 503 = something needs attention
app.get('/api/health', async (_req, reply) => {
  const h = await health();
  reply.header('Cache-Control', 'no-store');
  return reply.code(h.ok ? 200 : 503).send({ ...h, live: liveStats() });
});

// Browser errors (from the error boundary / window.onerror), limited per IP
const clientErrBuckets = new Map<string, { n: number; at: number }>();
app.post('/api/client-errors', { bodyLimit: 20_000 }, async (req, reply) => {
  const b = clientErrBuckets.get(req.ip) ?? { n: 0, at: Date.now() };
  if (Date.now() - b.at > 60_000) { b.n = 0; b.at = Date.now(); }
  if (++b.n > 20) return reply.code(429).send({ error: 'rate_limited' });
  clientErrBuckets.set(req.ip, b);
  if (clientErrBuckets.size > 10_000) clientErrBuckets.clear();
  const body = (req.body ?? {}) as { message?: unknown; stack?: unknown; url?: unknown; digest?: unknown };
  const e = new Error(String(body.message ?? 'Unknown browser error').slice(0, 500));
  e.stack = typeof body.stack === 'string' ? body.stack.slice(0, 6000) : undefined;
  await captureError('web', e, { url: String(body.url ?? '').slice(0, 300), digest: body.digest ?? null, ua: String(req.headers['user-agent'] ?? '').slice(0, 200) });
  return reply.code(204).send();
});

process.on('unhandledRejection', (e) => { console.error('unhandledRejection', e); captureError('api', e, { kind: 'unhandledRejection' }); });

await app.register(async (api) => {
  await api.register(authRoutes);
  await api.register(dataRoutes);
  await api.register(liveRoutes);
  await api.register(offerRoutes);
  await api.register(customerRoutes);
  await api.register(settingsRoutes);
  await api.register(integrationRoutes);
  await api.register(integrationSettingsRoutes);
  await api.register(brandingRoutes);
  await api.register(viewRoutes);
  await api.register(tabRoutes);
  await api.register(registryRoutes);
  await api.register(formRoutes);
  await api.register(crmRoutes);
  await api.register(documentRoutes);
  await api.register(taskRoutes);
  await api.register(reportRoutes);
  await api.register(aiRoutes);
  await api.register(emailRoutes);
  await api.register(calendarRoutes);
  await api.register(billingRoutes);
}, { prefix: '/api' });

await startRealtime();
await app.listen({ port: env.port, host: env.host });
console.log(`SoftifyOS API listening on http://${env.host}:${env.port}`);

const shutdown = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
