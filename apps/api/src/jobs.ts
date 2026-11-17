import { sql, type Tx } from './db.js';

export type NotifyJob = {
  tenantId: string;
  userIds: string[];
  title: string;
  body?: string;
  url?: string;
};

export type EmailJob = {
  to: string; subject: string; text: string; html?: string;
  tenantId?: string;        // send through the organisation's SMTP when it has one
  messageId?: string;       // email_messages row to update with the outcome
  fromName?: string | null; replyTo?: string | null; bcc?: string | null;
};

export type WebhookJob = { deliveryId: string };

export type CalendarPushJob = { tenantId: string; activityId: string };

export type BackupRunJob = { by?: string };

export type JobMap = { notify: NotifyJob; email: EmailJob; webhook: WebhookJob; calendar_push: CalendarPushJob; backup_run: BackupRunJob };

export async function enqueue<K extends keyof JobMap>(kind: K, payload: JobMap[K], db: Tx | typeof sql = sql, runAt?: Date) {
  await db`INSERT INTO jobs (kind, payload, run_at) VALUES (${kind}, ${db.json(payload as never)}, ${runAt ?? new Date()})`;
}
