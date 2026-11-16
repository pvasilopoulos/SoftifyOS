import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { env } from './env.js';
import { sql } from './db.js';
import { liveStats, startRealtime } from './realtime.js';
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
  reply.code(code).send({ error: code === 500 ? 'internal' : (err as Error).message });
});

app.get('/api/health', async () => {
  await sql`SELECT 1`;
  return { ok: true, live: liveStats() };
});

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
