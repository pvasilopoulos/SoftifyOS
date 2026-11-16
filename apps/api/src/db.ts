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

// ---------------------------------------------------------------- greeklish search
// Same algorithm as the SQL phonetic_key() (migration 031) and the web app's phonetic() (lib/search.ts):
// Greek and Latin (greeklish) spellings reduce to one key, e.g. "athina", "a8hna", "Αθήνα" → "a8ina".
const GREEK_PAIRS: [string, string][] = [['ου', 'ou'], ['ευ', 'ev'], ['αυ', 'av'], ['αι', 'e'], ['ει', 'i'], ['οι', 'i'], ['υι', 'i'],
  ['μπ', 'b'], ['ντ', 'd'], ['γκ', 'g'], ['γγ', 'g'], ['τσ', 'ts'], ['τζ', 'tz']];
const GREEK: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: '8', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x',
  ο: 'o', π: 'p', ρ: 'r', σ: 's', τ: 't', υ: 'i', φ: 'f', χ: 'x', ψ: 'ps', ω: 'o',
};
const LATIN_PAIRS: [string, string][] = [['th', '8'], ['ch', 'x'], ['kh', 'x'], ['ks', 'x'], ['ph', 'f'], ['eu', 'ev'], ['ef', 'ev'],
  ['au', 'av'], ['af', 'av'], ['ou', 'u'], ['ai', 'e'], ['ei', 'i'], ['oi', 'i'], ['mp', 'b'], ['nt', 'd'], ['gk', 'g'], ['gg', 'g']];
const LATIN: Record<string, string> = { w: 'o', y: 'i', b: 'v', c: 'k', q: 'k' };

export function phoneticKey(text: string, hAs: 'i' | 'x' = 'i') {
  let s = searchKey(text);
  for (const [g, l] of GREEK_PAIRS) s = s.replaceAll(g, l);
  s = s.replace(/[α-ω]/g, (c) => GREEK[c] ?? c);
  for (const [a, b] of LATIN_PAIRS) s = s.replaceAll(a, b);
  s = s.replace(/[a-z]/g, (c) => (c === 'h' ? hAs : LATIN[c] ?? c));
  return s.replace(/(.)\1+/g, '$1');
}

/** LIKE patterns of a search: plain text, plus its phonetic forms (a Latin "h" may be η or χ). */
export function searchPatterns(q: string) {
  const esc = (s: string) => `%${s.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  return [...new Set([searchKey(q), phoneticKey(q, 'i'), phoneticKey(q, 'x')].filter((x) => x.trim().length >= 2))].map(esc);
}
/** (col LIKE p1 OR col LIKE p2 …) — each branch can use the trigram index. */
export function likeAny(tx: postgres.Sql | Tx, col: string, patterns: string[]) {
  return patterns.slice(1).reduce((acc, p) => tx`${acc} OR ${tx(col)} LIKE ${p}`, tx`${tx(col)} LIKE ${patterns[0]}`) as postgres.PendingQuery<postgres.Row[]>;
}
