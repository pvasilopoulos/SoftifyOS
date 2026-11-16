import { sql, type Tx } from './db.js';

export type NotifyJob = {
  tenantId: string;
  userIds: string[];
  title: string;
  body?: string;
  url?: string;
};

export type JobMap = { notify: NotifyJob };

export async function enqueue<K extends keyof JobMap>(kind: K, payload: JobMap[K], db: Tx | typeof sql = sql, runAt?: Date) {
  await db`INSERT INTO jobs (kind, payload, run_at) VALUES (${kind}, ${db.json(payload as never)}, ${runAt ?? new Date()})`;
}
