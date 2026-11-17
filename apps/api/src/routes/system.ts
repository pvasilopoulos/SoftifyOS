// Settings → System health and Settings → Backups. Installation-wide (all organisations), so only
// platform administrators see them: PLATFORM_ADMINS=email1,email2 in .env (in development: any owner).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, type Session } from '../auth.js';
import { env } from '../env.js';
import { health } from '../monitor.js';
import { liveStats } from '../realtime.js';

const START = Date.now();
const adminCache = new Map<string, { at: number; ok: boolean }>();

/** Platform administrator = email listed in PLATFORM_ADMINS (development without the list: organisation owners). */
export async function isPlatformAdmin(s: Session) {
  if (s.impersonator) return false;
  const hit = adminCache.get(s.userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  let ok = false;
  if (env.platformAdmins.length) {
    const [u] = await sql`SELECT lower(email) AS email FROM users WHERE id = ${s.userId}`;
    ok = !!u && env.platformAdmins.includes(u.email);
  } else ok = !env.isProd && s.role === 'owner';
  adminCache.set(s.userId, { at: Date.now(), ok });
  return ok;
}

async function guard(req: FastifyRequest, reply: FastifyReply) {
  if (!(await isPlatformAdmin(req.session))) return reply.code(403).send({ error: 'forbidden' });
}

const BACKUP_NAME = /^(weekly-|monthly-)?\d{4}-\d{2}-\d{2}_\d{4}$/;
const BACKUP_FILES = ['db.dump', 'db.dump.gpg', 'files.tar.gz', 'files.tar.gz.gpg', 'SHA256SUMS'];
const readJson = async (p: string) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

async function auditPlatform(s: Session, action: string, details: unknown) {
  await sql`INSERT INTO audit_log (tenant_id, actor_id, action, entity, details) VALUES (${s.tenantId}, ${s.userId}, ${action}, null, ${sql.json(details as never)})`;
}

export default async function systemRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    r.addHook('preHandler', guard);

    // ---------------------------------------------------------------- health + numbers
    r.get('/system/health', async () => {
      const h = await health();
      const [db] = await sql`SELECT pg_database_size(current_database())::bigint AS size, version() AS version,
                                    (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
                                    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections`;
      const tables = await sql`
        SELECT s.relname AS name, greatest(c.reltuples::bigint, s.n_live_tup)::bigint AS rows, pg_total_relation_size(s.relid)::bigint AS bytes
        FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid ORDER BY pg_total_relation_size(s.relid) DESC LIMIT 8`;   // reltuples: survives restarts
      const [counts] = await sql`SELECT (SELECT count(*)::int FROM tenants) AS tenants, (SELECT count(*)::int FROM users) AS users,
                                        (SELECT count(*)::int FROM memberships WHERE last_seen_at > now() - interval '1 day') AS active_today`;
      const jobs = await sql`SELECT kind, count(*)::int AS pending, count(*) FILTER (WHERE attempts > 1)::int AS retrying,
                                    max(last_error) FILTER (WHERE attempts > 1) AS last_error
                             FROM jobs GROUP BY kind ORDER BY count(*) DESC`;
      const mem = process.memoryUsage();
      return {
        ...h,
        app: { version: process.env.npm_package_version ?? '0.1.0', node: process.version, uptime_s: Math.round((Date.now() - START) / 1000), env: env.isProd ? 'production' : 'development',
          memory_mb: Math.round(mem.rss / 1048576), host: os.hostname(), load: os.loadavg().map((x) => Math.round(x * 100) / 100), cpus: os.cpus().length,
          free_mem_mb: Math.round(os.freemem() / 1048576), total_mem_mb: Math.round(os.totalmem() / 1048576) },
        db: { ...db, version: String(db.version).split(' on ')[0], size: Number(db.size) },
        tables: tables.map((t) => ({ ...t, rows: Number(t.rows), bytes: Number(t.bytes) })),
        counts, jobs, live: liveStats(),
        config: {
          smtp: env.smtpConfigured, push: !!(env.vapidPublic && env.vapidPrivate), stripe: !!env.stripe.secretKey,
          google: !!env.google.clientId, microsoft: !!env.microsoft.clientId, alert_email: !!env.alert.email, alert_webhook: !!env.alert.webhook,
          backups: !!env.backupDir, platform_admins: env.platformAdmins.length,
        },
      };
    });

    r.get('/system/errors', async (req) => {
      const q = z.object({ status: z.enum(['open', 'resolved', 'all']).default('open') }).parse(req.query);
      return sql`
        SELECT fingerprint, source, message, stack, context, count, first_seen, last_seen, resolved_at FROM error_events
        WHERE ${q.status === 'open' ? sql`resolved_at IS NULL` : q.status === 'resolved' ? sql`resolved_at IS NOT NULL` : sql`true`}
        ORDER BY last_seen DESC LIMIT 100`;
    });

    r.post('/system/errors/resolve', async (req) => {
      const b = z.object({ fingerprint: z.string().regex(/^[0-9a-f]{40}$/).optional(), all: z.boolean().optional() }).parse(req.body);
      const rows = b.all
        ? await sql`UPDATE error_events SET resolved_at = now() WHERE resolved_at IS NULL RETURNING fingerprint`
        : await sql`UPDATE error_events SET resolved_at = now() WHERE fingerprint = ${b.fingerprint ?? ''} RETURNING fingerprint`;
      return { resolved: rows.length };
    });

    // ---------------------------------------------------------------- backups
    r.get('/system/backups', async () => {
      const dir = env.backupDir;
      const running = (await sql`SELECT info, beat_at FROM system_heartbeat WHERE name = 'backup'`)[0];
      const queued = (await sql`SELECT count(*)::int AS n FROM jobs WHERE kind = 'backup_run'`)[0].n > 0;
      const base = {
        configured: !!dir, dir, encrypted: !!process.env.BACKUP_PASSPHRASE, remote: process.env.BACKUP_REMOTE ? process.env.BACKUP_REMOTE.split(':')[0] : null,
        keep_days: Number(process.env.BACKUP_KEEP_DAYS ?? 14),
        running: queued || (running?.info?.running && Date.now() - new Date(running.beat_at).getTime() < 3 * 3600e3) || false,
        last_run: running?.info ?? null,
      };
      if (!dir) return { ...base, last: null, verify: null, items: [] };
      let names: string[] = [];
      try { names = (await readdir(dir)).filter((n) => BACKUP_NAME.test(n)); } catch { return { ...base, error: 'dir_unreadable', last: null, verify: null, items: [] }; }
      const items = await Promise.all(names.map(async (name) => {
        const p = join(dir, name);
        const files = (await readdir(p).catch(() => [] as string[])).filter((f) => BACKUP_FILES.includes(f));
        let size = 0;
        for (const f of files) size += (await stat(join(p, f)).catch(() => ({ size: 0 }))).size;
        const kind = name.startsWith('weekly-') ? 'weekly' : name.startsWith('monthly-') ? 'monthly' : 'daily';
        const m = name.match(/(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$/)!;
        return { name, kind, created_at: `${m[1]}T${m[2]}:${m[3]}:00`, size, files, encrypted: files.some((f) => f.endsWith('.gpg')) };
      }));
      items.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.kind.localeCompare(b.kind));
      // Encrypted = passphrase configured here, or the newest backup is encrypted (the cron may run with its own .env)
      return { ...base, encrypted: base.encrypted || !!items.find((i) => i.kind === 'daily')?.encrypted, last: await readJson(join(dir, 'last.json')), verify: await readJson(join(dir, 'last-verify.json')), items };
    });

    r.post('/system/backups/run', async (req, reply) => {
      if (!env.backupDir) return reply.code(409).send({ error: 'not_configured' });
      const [busy] = await sql`SELECT 1 FROM jobs WHERE kind = 'backup_run'`;
      if (busy) return reply.code(409).send({ error: 'already_running' });
      await sql`INSERT INTO jobs (kind, payload) VALUES ('backup_run', ${sql.json({ by: req.session.userId } as never)})`;
      await auditPlatform(req.session, 'system.backup_run', {});
      return { ok: true };
    });

    r.get('/system/backups/:name/:file', async (req, reply) => {
      const { name, file } = z.object({ name: z.string().regex(BACKUP_NAME), file: z.enum(BACKUP_FILES as [string, ...string[]]) }).parse(req.params);
      if (!env.backupDir) return reply.code(404).send({ error: 'not_found' });
      const p = join(env.backupDir, name, file);
      const st = await stat(p).catch(() => null);
      if (!st?.isFile()) return reply.code(404).send({ error: 'not_found' });
      await auditPlatform(req.session, 'system.backup_download', { name, file });
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', String(st.size));
      reply.header('Content-Disposition', `attachment; filename="softifyos-${name}-${file}"`);
      reply.header('Cache-Control', 'no-store');
      return reply.send(createReadStream(p));
    });

    r.delete('/system/backups/:name', async (req, reply) => {
      const { name } = z.object({ name: z.string().regex(BACKUP_NAME) }).parse(req.params);
      if (!env.backupDir) return reply.code(404).send({ error: 'not_found' });
      const daily = (await readdir(env.backupDir)).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n));
      if (daily.length <= 1 && daily.includes(name)) return reply.code(409).send({ error: 'last_backup' });   // never delete the only one
      await rm(join(env.backupDir, name), { recursive: true, force: true });
      await auditPlatform(req.session, 'system.backup_delete', { name });
      return { ok: true };
    });
  });
}
