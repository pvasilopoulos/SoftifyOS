import postgres from 'postgres';
import { env } from './env.js';

export const sql = postgres(env.databaseUrl, {
  max: env.dbPoolMax,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: env.dbPrepare,
  onnotice: () => {},
});

export type Tx = postgres.TransactionSql;

/**
 * Runs fn inside a transaction scoped to one tenant.
 * RLS policies (tenant_id = app_tenant()) apply because we switch to the softify_app role,
 * so even a query that forgets "WHERE tenant_id = ..." can never see another tenant's rows.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`SET LOCAL ROLE softify_app`;
    return fn(tx as unknown as Tx);
  }) as Promise<T>;
}

// Opaque keyset cursors
export const encodeCursor = (v: unknown[]) => Buffer.from(JSON.stringify(v)).toString('base64url');
export function decodeCursor<T extends unknown[]>(c?: string): T | null {
  if (!c) return null;
  try { return JSON.parse(Buffer.from(c, 'base64url').toString()) as T; } catch { return null; }
}

// Same normalisation as the SQL search_key() function
export function searchKey(s: string): string {
  const from = 'άέήίόύώϊϋΐΰςáàâäéèêëíìîïóòôöúùûüç';
  const to = 'αεηιουωιυιυσaaaaeeeeiiiioooouuuuc';
  return [...s.toLowerCase()].map((ch) => { const i = from.indexOf(ch); return i >= 0 ? to[i] : ch; }).join('');
}
