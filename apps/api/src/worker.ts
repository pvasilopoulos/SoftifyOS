// Background worker: processes the Postgres job queue (push notifications, reminders, maintenance).
// Run one or more instances; FOR UPDATE SKIP LOCKED guarantees each job is taken by exactly one worker.
// Connects as the table owner (no RLS) because it works across tenants.
import webpush from 'web-push';
import nodemailer from 'nodemailer';
import { env } from './env.js';
import { sql } from './db.js';
import { publish } from './realtime.js';
import type { EmailJob, JobMap, NotifyJob, WebhookJob } from './jobs.js';
import { deliver } from './webhooks.js';
import { runNoContactRules } from './crm.js';

// SMTP (e.g. the Plesk mail server on localhost). Without SMTP_HOST, emails are logged instead of sent.
const mailer = env.smtpConfigured
  ? nodemailer.createTransport({
      host: env.smtp.host, port: env.smtp.port, secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

async function handleEmail(p: EmailJob) {
  if (!mailer) {
    console.log(`[email not configured] to=${p.to} subject="${p.subject}"\n${p.text}`);
    return;
  }
  await mailer.sendMail({ from: env.smtp.from, to: p.to, subject: p.subject, text: p.text, html: p.html });
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
      else if (j.kind === 'email') await handleEmail(j.payload as EmailJob);
      else if (j.kind === 'webhook') await handleWebhook(j.payload as WebhookJob);
      await sql`DELETE FROM jobs WHERE id = ${j.id}`;
    } catch (e) {
      const msg = (e as Error).message;
      if (j.attempts >= MAX_ATTEMPTS) {
        console.error(`job ${j.id} dropped after ${j.attempts} attempts: ${msg}`);
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
}

// Morning digest (from 07:00 local time, once a day): what is due today and what is overdue
async function morningDigest() {
  await sql`
    WITH todo AS (
      SELECT a.tenant_id, a.owner_id AS user_id, t.timezone,
             count(*) FILTER (WHERE a.due_at < now())::int AS overdue,
             count(*) FILTER (WHERE a.due_at >= now()
               AND a.due_at < (date_trunc('day', now() AT TIME ZONE t.timezone) + interval '1 day') AT TIME ZONE t.timezone)::int AS today
      FROM crm_activities a JOIN tenants t ON t.id = a.tenant_id
      WHERE a.status IN ('planned', 'in_progress') AND a.owner_id IS NOT NULL
        AND a.due_at < (date_trunc('day', now() AT TIME ZONE t.timezone) + interval '1 day') AT TIME ZONE t.timezone
        AND extract(hour FROM now() AT TIME ZONE t.timezone) >= 7
      GROUP BY a.tenant_id, a.owner_id, t.timezone),
    fresh AS (
      INSERT INTO crm_digests (tenant_id, user_id, day)
      SELECT tenant_id, user_id, (now() AT TIME ZONE timezone)::date FROM todo
      ON CONFLICT DO NOTHING RETURNING tenant_id, user_id)
    INSERT INTO jobs (kind, payload)
    SELECT 'notify', jsonb_build_object('tenantId', f.tenant_id, 'userIds', jsonb_build_array(f.user_id),
      'title', 'Οι ενέργειές σου σήμερα',
      'body', td.today || ' για σήμερα' || CASE WHEN td.overdue > 0 THEN ' · ' || td.overdue || ' καθυστερημένες' ELSE '' END,
      'url', '/crm?view=agenda')
    FROM fresh f JOIN todo td ON td.tenant_id = f.tenant_id AND td.user_id = f.user_id`;
  await sql`DELETE FROM crm_digests WHERE day < current_date - 7`;
}

async function maintenance() {
  await sql`UPDATE jobs SET locked_at = NULL WHERE locked_at < now() - interval '5 minutes'`; // crashed workers
  await sql`SELECT ensure_activity_partitions(1, 3)`;
  // Integration logs are kept 30 days
  await sql`DELETE FROM api_requests WHERE created_at < now() - interval '30 days'`;
  await sql`DELETE FROM webhook_deliveries WHERE created_at < now() - interval '30 days' AND status <> 'pending'`;
}

let running = true;
let lastReminder = 0, lastMaintenance = 0, lastDigest = 0, lastRules = 0;
console.log(`SoftifyOS worker started (push ${pushEnabled ? 'on' : 'off'})`);
while (running) {
  try {
    const now = Date.now();
    if (now - lastReminder > 15_000) { await scheduleReminders(); lastReminder = now; }
    if (now - lastMaintenance > 3_600_000) { await maintenance(); lastMaintenance = now; }
    if (now - lastDigest > 300_000) { await morningDigest(); lastDigest = now; }
    if (now - lastRules > 1_800_000) { await runNoContactRules(sql); lastRules = now; }
    const n = await processBatch();
    if (n < BATCH) await new Promise((r) => setTimeout(r, 500));
  } catch (e) {
    console.error('worker loop error', e);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const stop = async () => { running = false; await sql.end({ timeout: 5 }); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
