// Live updates: Postgres LISTEN/NOTIFY fans events out to every API instance,
// each instance pushes them to its connected browsers over Server-Sent Events.
import type { FastifyReply } from 'fastify';
import { sql } from './db.js';

export const CHANNEL = 'softify_events';
export type LiveEvent = { tenantId: string; userIds?: string[]; type: string; data?: unknown };

type Client = { userId: string; reply: FastifyReply };
const clients = new Map<string, Set<Client>>(); // tenantId -> clients

export function addClient(tenantId: string, c: Client) {
  if (!clients.has(tenantId)) clients.set(tenantId, new Set());
  clients.get(tenantId)!.add(c);
  return () => {
    const set = clients.get(tenantId);
    set?.delete(c);
    if (set && set.size === 0) clients.delete(tenantId);
  };
}

function dispatch(e: LiveEvent) {
  const set = clients.get(e.tenantId);
  if (!set) return;
  const msg = `event: ${e.type}\ndata: ${JSON.stringify(e.data ?? {})}\n\n`;
  for (const c of set) {
    if (e.userIds && !e.userIds.includes(c.userId)) continue;
    c.reply.raw.write(msg);
  }
}

export async function startRealtime() {
  await sql.listen(CHANNEL, (payload) => {
    try { dispatch(JSON.parse(payload) as LiveEvent); } catch { /* ignore malformed */ }
  });
}

// Payload must stay small (NOTIFY limit is 8KB): send ids/summary, clients refetch details.
export async function publish(e: LiveEvent) {
  await sql.notify(CHANNEL, JSON.stringify(e));
}

export const liveStats = () => ({ tenants: clients.size, connections: [...clients.values()].reduce((n, s) => n + s.size, 0) });
