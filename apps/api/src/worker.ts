// Background worker: processes the Postgres job queue (push notifications, reminders, maintenance).
// Run one or more instances; FOR UPDATE SKIP LOCKED guarantees each job is taken by exactly one worker.
// Connects as the table owner (no RLS) because it works across tenants.
import webpush from 'web-push';
import { env } from './env.js';
import { transportFor, withName } from './email.js';
import { sql } from './db.js';
import { publish } from './realtime.js';
import type { CalendarPushJob, EmailJob, JobMap, NotifyJob, WebhookJob } from './jobs.js';
import { pullDue, pushActivity } from './calendar.js';
import { captureError, heartbeat } from './monitor.js';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// "Backup now" from Settings → Backups: runs deploy/backup.sh as this (app) user. Never retried automatically.
async function runBackup() {
  const started = new Date().toISOString();
  await heartbeat('backup', { running: true, started_at: started });
  const script = resolve(process.cwd(), '../../deploy/backup.sh');
  const out: string[] = [];
  const code = await new Promise<number>((done) => {
    const p = spawn('bash', [script], { env: { ...process.env, APP_DIR: resolve(process.cwd(), '../..') }, timeout: 2 * 3600e3 });
    // Control characters (e.g. NUL from UTF-16 output) would make Postgres reject the status
    const keep = (d: Buffer) => { out.push(d.toString().replace(/[\u0000-\u0008\u000b-\u001f]/g, '')); if (out.length > 50) out.shift(); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    p.on('error', (e) => { out.push(e.message); done(-1); });
    p.on('close', (c) => done(c ?? -1));
  });
  const tail = out.join('').trim().split('\n').slice(-5).join('\n').slice(0, 1000);
  await heartbeat('backup', { running: false, started_at: started, finished_at: new Date().toISOString(), ok: code === 0, output: tail });
  if (code !== 0) await captureError('worker', new Error(`backup failed (exit ${code}): ${tail.split('\n').pop()}`), { job: 'backup_run' });
}
import { deliver } from './webhooks.js';
import { runNoContactRules } from './crm.js';
import { removeFile } from './storage.js';
import { definitionSchema, nextRun, runReport } from './reports.js';

// Organisation SMTP if set, else the server's SMTP_* (e.g. Plesk mail on localhost), else the email is only logged.
async function handleEmail(p: EmailJob, lastAttempt: boolean) {
  const tr = await transportFor(p.tenantId);
  if (!tr) {
    console.log(`[email not configured] to=${p.to} subject="${p.subject}"\n${p.text}`);
    if (p.messageId) await sql`UPDATE email_messages SET status = 'logged', sent_at = now() WHERE id = ${p.messageId}`;
    return;
  }
  try {
    await tr.transport.sendMail({
      from: withName(tr.from, p.fromName), to: p.to, subject: p.subject, text: p.text, html: p.html,
      replyTo: p.replyTo ?? undefined, bcc: p.bcc ?? undefined,
    });
    if (p.messageId) await sql`UPDATE email_messages SET status = 'sent', error = NULL, sent_at = now() WHERE id = ${p.messageId}`;
  } catch (e) {
    if (p.messageId) {
      await sql`UPDATE email_messages SET error = ${String((e as Error).message).slice(0, 500)}, status = ${lastAttempt ? 'failed' : 'queued'} WHERE id = ${p.messageId}`;
    }
    throw e;
  }
}

const BATCH = 50;
const MAX_ATTEMPTS = 8;
const pushEnabled = Boolean(env.vapidPublic && env.vapidPrivate);
if (pushEnabled) webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate);
else console.warn('VAPID keys missing: web push disabled (in-app live notifications still work). Run: npm run vapid');

type Job = { id: string; kind: keyof JobMap; payload: unknown; attempts: number };

async function handleNotify(p: NotifyJob) {
  // 1) Persist in-app notifications
  const rows = await sql<{ id: string; user_id: string }[]>`
    INSERT INTO notifications (tenant_id, user_id, title, body, url)
    SELECT ${p.tenantId}, u, ${p.title}, ${p.body ?? null}, ${p.url ?? null} FROM unnest(${p.userIds}::uuid[]) u
    RETURNING id, user_id`;
  // 2) Live update to open browsers (SSE)
  await publish({ tenantId: p.tenantId, userIds: p.userIds, type: 'notification', data: { title: p.title, body: p.body, url: p.url } });
  // 3) Web Push to every registered device of these users
  if (!pushEnabled) return;
  const subs = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
    SELECT id, endpoint, p256dh, auth FROM push_subscriptions
    WHERE tenant_id = ${p.tenantId} AND user_id = ANY(${p.userIds}::uuid[])`;
  const payload = JSON.stringify({ title: p.title, body: p.body, url: p.url, tag: rows[0]?.id });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`; // expired device
      else console.error('push failed', status, (e as Error).message);
    }
  }));
}

// Webhooks keep their own (longer) retry schedule: a failed attempt queues the next one instead of throwing.
async function handleWebhook(p: WebhookJob) {
  const r = await deliver(p.deliveryId);
  if (r?.retryIn) {
    await sql`INSERT INTO jobs (kind, payload, run_at) VALUES ('webhook', ${sql.json(p as never)}, now() + (${r.retryIn} * interval '1 second'))`;
  }
}

async function processBatch(): Promise<number> {
  const jobs = await sql<Job[]>`
    UPDATE jobs SET locked_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs WHERE locked_at IS NULL AND run_at <= now()
      ORDER BY run_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, payload, attempts`;
  await Promise.all(jobs.map(async (j) => {
    try {
      if (j.kind === 'notify') await handleNotify(j.payload as NotifyJob);
      else if (j.kind === 'email') await handleEmail(j.payload as EmailJob, j.attempts >= MAX_ATTEMPTS);
      else if (j.kind === 'webhook') await handleWebhook(j.payload as WebhookJob);
      else if (j.kind === 'calendar_push') { const c = j.payload as CalendarPushJob; await pushActivity(c.tenantId, c.activityId); }
      else if (j.kind === 'backup_run') await runBackup();
      await sql`DELETE FROM jobs WHERE id = ${j.id}`;
    } catch (e) {
      const msg = (e as Error).message;
      if (j.attempts >= MAX_ATTEMPTS) {
        console.error(`job ${j.id} dropped after ${j.attempts} attempts: ${msg}`);
        await captureError('worker', e, { job: j.kind, attempts: j.attempts });
        await sql`DELETE FROM jobs WHERE id = ${j.id}`;
      } else {
        await sql`UPDATE jobs SET locked_at = NULL, last_error = ${msg},
                  run_at = now() + (${2 ** j.attempts} * interval '1 second') WHERE id = ${j.id}`;
      }
    }
  }));
  return jobs.length;
}

// CRM activity reminders -> notify jobs
async function scheduleReminders() {
  await sql`
    WITH due AS (
      UPDATE crm_activities a SET reminded = true
      WHERE id IN (SELECT id FROM crm_activities WHERE reminded = false AND remind_at <= now() AND owner_id IS NOT NULL
                   AND status IN ('planned', 'in_progress') LIMIT 500 FOR UPDATE SKIP LOCKED)
      RETURNING a.id, a.tenant_id, a.owner_id, a.subject, a.due_at, a.customer_id)
    INSERT INTO jobs (kind, payload)
    SELECT 'notify', jsonb_build_object(
      'tenantId', d.tenant_id, 'userIds', jsonb_build_array(d.owner_id),
      'title', '⏰ ' || d.subject,
      'body', to_char(d.due_at AT TIME ZONE t.timezone, 'DD/MM HH24:MI') || coalesce(' · ' || c.name, ''),
      'url', '/crm?open=' || d.id)
    FROM due d JOIN tenants t ON t.id = d.tenant_id LEFT JOIN customers c ON c.id = d.customer_id`;
  // Task reminders
  await sql`
    WITH due AS (
      UPDATE tasks SET reminded = true
      WHERE id IN (SELECT id FROM tasks WHERE reminded = false AND remind_at <= now() AND owner_id IS NOT NULL
                   AND status NOT IN ('done', 'cancelled') LIMIT 500 FOR UPDATE SKIP LOCKED)
      RETURNING id, tenant_id, owner_id, title, due_at)
    INSERT INTO jobs (kind, payload)
    SELECT 'notify', jsonb_build_object('tenantId', d.tenant_id, 'userIds', jsonb_build_array(d.owner_id),
      'title', '⏰ ' || d.title, 'body', 'Προθεσμία ' || to_char(d.due_at AT TIME ZONE t.timezone, 'DD/MM HH24:MI'), 'url', '/tasks?open=' || d.id)
    FROM due d JOIN tenants t ON t.id = d.tenant_id`;
}

// Morning digest (from 07:00 local time, once a day): what is due today and what is overdue
async function morningDigest() {
  await sql`
    WITH todo AS (
      SELECT a.tenant_id, a.owner_id AS user_id, t.timezone,
             count(*) FILTER (WHERE a.due_at < now())::int AS overdue,
             count(*) FILTER (WHERE a.due_at >= now()
               AND a.due_at < (date_trunc('day', now() AT TIME ZONE t.timezone) + interval '1 day') AT TIME ZONE t.timezone)::int AS today
      FROM (SELECT tenant_id, owner_id, due_at FROM crm_activities WHERE status IN ('planned', 'in_progress')
            UNION ALL SELECT tenant_id, owner_id, due_at FROM tasks WHERE status NOT IN ('done', 'cancelled')) a
      JOIN tenants t ON t.id = a.tenant_id
      WHERE a.owner_id IS NOT NULL
        AND a.due_at < (date_trunc('day', now() AT TIME ZONE t.timezone) + interval '1 day') AT TIME ZONE t.timezone
        AND extract(hour FROM now() AT TIME ZONE t.timezone) >= 7
      GROUP BY a.tenant_id, a.owner_id, t.timezone),
    fresh AS (
      INSERT INTO crm_digests (tenant_id, user_id, day)
      SELECT tenant_id, user_id, (now() AT TIME ZONE timezone)::date FROM todo
      ON CONFLICT DO NOTHING RETURNING tenant_id, user_id)
    INSERT INTO jobs (kind, payload)
    SELECT 'notify', jsonb_build_object('tenantId', f.tenant_id, 'userIds', jsonb_build_array(f.user_id),
      'title', 'Το πρόγραμμά σου σήμερα',
      'body', td.today || ' για σήμερα' || CASE WHEN td.overdue > 0 THEN ' · ' || td.overdue || ' καθυστερημένες' ELSE '' END,
      'url', '/crm?view=agenda')
    FROM fresh f JOIN todo td ON td.tenant_id = f.tenant_id AND td.user_id = f.user_id`;
  await sql`DELETE FROM crm_digests WHERE day < current_date - 7`;
}

// Documents that expire within 30 days (contracts, certificates…): notify whoever uploaded them, once
async function documentExpiry() {
  await sql`
    WITH due AS (
      UPDATE documents SET expiry_notified = true
      WHERE id IN (SELECT id FROM documents WHERE expiry_notified = false AND expires_at IS NOT NULL AND expires_at <= current_date + 30
                   AND created_by IS NOT NULL LIMIT 500 FOR UPDATE SKIP LOCKED)
      RETURNING id, tenant_id, created_by, name, expires_at)
    INSERT INTO jobs (kind, payload)
    SELECT 'notify', jsonb_build_object('tenantId', tenant_id, 'userIds', jsonb_build_array(created_by),
      'title', 'Λήγει: ' || name, 'body', 'Ημερομηνία λήξης ' || to_char(expires_at, 'DD/MM/YYYY'), 'url', '/documents?open=' || id)
    FROM due`;
  // Files whose removal failed earlier
  for (const t of await sql`SELECT storage_key FROM storage_trash LIMIT 200`) {
    try { await removeFile(t.storage_key); await sql`DELETE FROM storage_trash WHERE storage_key = ${t.storage_key}`; } catch { /* retry later */ }
  }
}

// Scheduled reports: run as their owner and e-mail a table to the recipients
async function scheduledReports() {
  const due = await sql`
    UPDATE saved_reports SET next_run_at = NULL WHERE id IN (
      SELECT id FROM saved_reports WHERE next_run_at <= now() AND schedule IS NOT NULL LIMIT 20 FOR UPDATE SKIP LOCKED)
    RETURNING id, tenant_id, owner_id, name, definition, schedule`;
  for (const r of due) {
    try {
      const [m] = await sql`SELECT m.role, ro.permissions FROM memberships m JOIN roles ro ON ro.tenant_id = m.tenant_id AND ro.key = m.role
                             WHERE m.tenant_id = ${r.tenant_id} AND m.user_id = ${r.owner_id}`;
      if (!m) continue;   // owner left: the schedule stops
      const perms = (x: string) => m.role === 'owner' || (m.permissions as string[]).includes(x);
      const def = definitionSchema.parse(r.definition);
      const res = await runReport(sql, { tenantId: r.tenant_id, userId: r.owner_id, perms }, def);
      const fmt = (n: number) => res.measure.pct ? `${n.toLocaleString('el-GR')}%` : res.measure.money ? n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR' }) : n.toLocaleString('el-GR');
      const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      const rows = res.rows.map((x) => `<tr><td style="padding:4px 12px 4px 0">${esc(x.label)}</td><td style="padding:4px 0;text-align:right"><b>${fmt(x.value)}</b></td></tr>`).join('');
      const html = `<h2 style="font-family:sans-serif">${esc(r.name)}</h2><p style="font-family:sans-serif;color:#666">Σύνολο: <b>${fmt(res.total)}</b>${res.prev_total !== undefined ? ` (προηγούμενη περίοδος: ${fmt(res.prev_total)})` : ''}</p>` +
        (rows ? `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">${rows}</table>` : '') +
        `<p style="font-family:sans-serif"><a href="${env.appUrl}/el/reports?saved=${r.id}">Άνοιγμα στο SoftifyOS</a></p>`;
      const text = `${r.name}\nΣύνολο: ${fmt(res.total)}\n\n` + res.rows.map((x) => `${x.label}: ${fmt(x.value)}`).join('\n');
      const emails = await sql`SELECT u.email FROM users u JOIN memberships mm ON mm.user_id = u.id AND mm.tenant_id = ${r.tenant_id}
                               WHERE u.id = ANY(${(r.schedule as { recipients: string[] }).recipients}::uuid[])`;
      for (const e of emails) await sql`INSERT INTO jobs (kind, payload) VALUES ('email', ${sql.json({ to: e.email, subject: `Αναφορά: ${r.name}`, text, html } as never)})`;
      await sql`UPDATE saved_reports SET last_sent_at = now(), next_run_at = ${nextRun(r.schedule as never)} WHERE id = ${r.id}`;
    } catch (e) {
      console.error('scheduled report failed', r.id, e);
      await sql`UPDATE saved_reports SET next_run_at = now() + interval '1 hour' WHERE id = ${r.id}`;
    }
  }
}

async function maintenance() {
  await sql`UPDATE jobs SET locked_at = NULL WHERE locked_at < now() - interval '5 minutes'`; // crashed workers
  await sql`SELECT ensure_activity_partitions(1, 3)`;
  // Integration logs are kept 30 days
  await sql`DELETE FROM api_requests WHERE created_at < now() - interval '30 days'`;
  await sql`DELETE FROM webhook_deliveries WHERE created_at < now() - interval '30 days' AND status <> 'pending'`;
}

let running = true;
let lastReminder = 0, lastMaintenance = 0, lastDigest = 0, lastRules = 0, lastCalendar = 0, lastBeat = 0;
process.on('unhandledRejection', (e) => { console.error('unhandledRejection', e); captureError('worker', e, { kind: 'unhandledRejection' }); });
console.log(`SoftifyOS worker started (push ${pushEnabled ? 'on' : 'off'})`);
while (running) {
  try {
    const now = Date.now();
    if (now - lastReminder > 15_000) { await scheduleReminders(); lastReminder = now; }
    if (now - lastMaintenance > 3_600_000) { await maintenance(); await documentExpiry(); lastMaintenance = now; }
    if (now - lastDigest > 300_000) { await morningDigest(); await scheduledReports(); lastDigest = now; }
    if (now - lastRules > 1_800_000) { await runNoContactRules(sql); lastRules = now; }
    if (now - lastCalendar > 60_000) { await pullDue(); lastCalendar = now; }
    if (now - lastBeat > 30_000) { await heartbeat('worker', { pid: process.pid }); lastBeat = now; }
    const n = await processBatch();
    if (n < BATCH) await new Promise((r) => setTimeout(r, 500));
  } catch (e) {
    console.error('worker loop error', e);
    await captureError('worker', e, { kind: 'loop' });
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const stop = async () => { running = false; await sql.end({ timeout: 5 }); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
