// Error monitoring without a third-party service: errors are grouped by fingerprint in `error_events`,
// and a new error (or one that comes back after being resolved) is sent once to ALERT_EMAIL and/or
// ALERT_WEBHOOK_URL (Slack / Teams / Discord compatible JSON). Health data for /api/health lives here too.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from './db.js';
import { env } from './env.js';

type Source = 'api' | 'worker' | 'web';
const SECRET_RE = /(password|pass|token|secret|authorization|cookie|api[_-]?key)=?[^&\s"']*/gi;
const scrub = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(SECRET_RE, '$1=[redacted]').replace(/sk-ant-[A-Za-z0-9_-]+|sos_[a-f0-9]{12}_[A-Za-z0-9_-]+/g, '[redacted]');

/** Records an error (never throws). Same message + first stack frame = same group. */
export async function captureError(source: Source, err: unknown, context?: Record<string, unknown>) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const message = scrub(e.message || e.name).slice(0, 1000);
    const stack = e.stack ? scrub(e.stack).slice(0, 8000) : null;
    // Numbers / ids in the message would split one bug into many groups
    const norm = message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>').replace(/\d+/g, '<n>');
    const frame = stack?.split('\n').find((l) => l.trim().startsWith('at ') && !l.includes('node_modules')) ?? '';
    const fingerprint = createHash('sha1').update(`${source}|${norm}|${frame.trim()}`).digest('hex');
    const [row] = await sql<{ count: number; alerted_at: Date | null; resolved_at: Date | null; first: boolean }[]>`
      INSERT INTO error_events (fingerprint, source, message, stack, context)
      VALUES (${fingerprint}, ${source}, ${message}, ${stack}, ${context ? sql.json(context as never) : null})
      ON CONFLICT (fingerprint) DO UPDATE SET count = error_events.count + 1, last_seen = now(), message = EXCLUDED.message,
        stack = EXCLUDED.stack, context = EXCLUDED.context,
        resolved_at = NULL, alerted_at = CASE WHEN error_events.resolved_at IS NOT NULL THEN NULL ELSE error_events.alerted_at END
      RETURNING count, alerted_at, resolved_at, (xmax = 0) AS first`;
    if (!row.alerted_at && (env.alert.email || env.alert.webhook)) {
      // One alert per group (claimed atomically, so several API instances do not all send it)
      const [claim] = await sql`UPDATE error_events SET alerted_at = now() WHERE fingerprint = ${fingerprint} AND alerted_at IS NULL RETURNING fingerprint`;
      if (claim) await alert(source, message, stack, context, row.count);
    }
  } catch { /* monitoring must never break the request */ }
}

async function alert(source: Source, message: string, stack: string | null, context: Record<string, unknown> | undefined, count: number) {
  const host = env.appUrl.replace(/^https?:\/\//, '');
  const title = `[SoftifyOS ${host}] ${source} error: ${message.slice(0, 120)}`;
  const text = `${title}\n\nCount: ${count}\nContext: ${JSON.stringify(context ?? {}, null, 2)}\n\n${stack ?? ''}`.slice(0, 6000);
  if (env.alert.email) {
    await sql`INSERT INTO jobs (kind, payload) VALUES ('email', ${sql.json({ to: env.alert.email, subject: title.slice(0, 200), text } as never)})`;
  }
  if (env.alert.webhook) {
    await fetch(env.alert.webhook, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ text: `🚨 ${title}\n\`\`\`${(stack ?? '').split('\n').slice(0, 6).join('\n')}\`\`\``, content: `🚨 ${title}` }),
    }).catch(() => {});
  }
}

export async function heartbeat(name: string, info?: Record<string, unknown>) {
  await sql`INSERT INTO system_heartbeat (name, beat_at, info) VALUES (${name}, now(), ${info ? sql.json(info as never) : null})
            ON CONFLICT (name) DO UPDATE SET beat_at = now(), info = EXCLUDED.info`.catch(() => {});
}

/** Health for uptime monitors: 200 when everything works, 503 otherwise. No secrets, no tenant data. */
export async function health() {
  const t0 = Date.now();
  const checks: Record<string, { ok: boolean; [k: string]: unknown }> = {};
  try {
    await sql`SELECT 1`;
    checks.database = { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, checks: { database: { ok: false, error: (e as Error).message.slice(0, 200) } } };
  }
  const [w] = await sql`SELECT extract(epoch FROM now() - beat_at)::int AS age FROM system_heartbeat WHERE name = 'worker'`;
  checks.worker = { ok: !!w && w.age < 120, last_beat_s: w?.age ?? null };
  const [q] = await sql`SELECT count(*)::int AS pending, coalesce(extract(epoch FROM now() - min(run_at))::int, 0) AS oldest_s
                        FROM jobs WHERE locked_at IS NULL AND run_at <= now()`;
  checks.queue = { ok: q.oldest_s < 600, pending: q.pending, oldest_s: q.oldest_s };
  const [er] = await sql`SELECT count(*)::int AS n FROM error_events WHERE last_seen > now() - interval '1 hour' AND resolved_at IS NULL`;
  checks.errors = { ok: true, last_hour: er.n };
  if (env.backupDir) {
    try {
      const last = JSON.parse(await readFile(`${env.backupDir}/last.json`, 'utf8')) as { finished_at: string; ok: boolean };
      const age = (Date.now() - new Date(last.finished_at).getTime()) / 3600e3;
      checks.backup = { ok: last.ok && age < 26, last: last.finished_at, age_h: Math.round(age) };
    } catch { checks.backup = { ok: false, error: 'no backup status' }; }
  }
  return { ok: Object.values(checks).every((c) => c.ok), checks };
}
