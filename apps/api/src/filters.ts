// Filters of the index pages (Customers, Customers & stores, Stores).
// One catalogue for customer, store and space fields; Settings → Indexes chooses which ones each
// organisation / role / user sees. Store and space filters on the customer lists mean
// "customers that have a store (with a space) matching", and space filters on the store list mean
// "stores that have a space matching" — evaluated with EXISTS on indexed foreign keys.
import type postgres from 'postgres';
import { searchKey, type Tx } from './db.js';
import type { Session } from './auth.js';

type Frag = postgres.PendingQuery<postgres.Row[]>;
type Entity = 'c' | 'b' | 's';
type Def =
  | { entity: Entity; type: 'enum'; col: string; values: readonly string[] }
  | { entity: Entity; type: 'text' | 'uuid'; col: string }
  | { entity: Entity; type: 'range'; col: string }
  | { entity: Entity; type: 'bool' }
  | { entity: Entity; type: 'days'; col: string }   // relative date: within the last N days (stays correct over time)
  | { entity: 'b'; type: 'city' }
  | { entity: 'c'; type: 'manager' };

export const FILTERS = {
  c_status: { entity: 'c', type: 'enum', col: 'status', values: ['active', 'prospect', 'negotiation', 'inactive'] },
  c_kind: { entity: 'c', type: 'enum', col: 'kind', values: ['group', 'company'] },
  c_category: { entity: 'c', type: 'text', col: 'category' },
  c_source: { entity: 'c', type: 'text', col: 'source' },
  c_payment_terms: { entity: 'c', type: 'text', col: 'payment_terms' },
  c_prefecture: { entity: 'c', type: 'text', col: 'address_region' },
  c_city: { entity: 'c', type: 'text', col: 'address_city' },
  c_geo_zone: { entity: 'c', type: 'uuid', col: 'geo_zone_id' },
  c_manager: { entity: 'c', type: 'manager' },
  c_value: { entity: 'c', type: 'range', col: 'annual_value' },
  c_created: { entity: 'c', type: 'days', col: 'created_at' },
  c_updated: { entity: 'c', type: 'days', col: 'updated_at' },
  c_mine: { entity: 'c', type: 'bool' },
  c_archived: { entity: 'c', type: 'bool' },
  b_status: { entity: 'b', type: 'enum', col: 'status', values: ['active', 'inactive'] },
  b_city: { entity: 'b', type: 'city' },
  b_prefecture: { entity: 'b', type: 'text', col: 'region' },
  b_geo_zone: { entity: 'b', type: 'uuid', col: 'geo_zone_id' },
  b_fee_schedule: { entity: 'b', type: 'uuid', col: 'fee_schedule_id' },
  b_tour: { entity: 'b', type: 'uuid', col: 'tour_id' },
  b_ongoing_status: { entity: 'b', type: 'uuid', col: 'ongoing_status_id' },
  b_seasonality: { entity: 'b', type: 'enum', col: 'seasonality', values: ['all_year', 'summer', 'winter', 'custom'] },
  s_kind: { entity: 's', type: 'text', col: 'kind' },
  s_area: { entity: 's', type: 'range', col: 'area_sqm' },
} as const satisfies Record<string, Def>;
export type FilterKey = keyof typeof FILTERS;
export const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];

export const INDEXES = ['customers', 'tree', 'stores'] as const; // tree = "Customers & stores"
export type IndexKey = (typeof INDEXES)[number];
/** Filters available on each index (archived customers never appear on the store list). */
export const INDEX_FILTERS: Record<IndexKey, FilterKey[]> = {
  customers: FILTER_KEYS,
  tree: FILTER_KEYS,
  stores: FILTER_KEYS.filter((k) => k !== 'c_archived'),
};
/** What a user sees when nobody configured anything (the filters the app had before). */
export const DEFAULT_VISIBLE: Record<IndexKey, FilterKey[]> = {
  customers: ['c_status', 'c_mine', 'c_archived'],
  tree: ['c_status', 'c_mine', 'c_archived'],
  stores: ['b_city', 'b_geo_zone', 'b_tour', 'b_ongoing_status', 'b_status', 'c_mine'],
};

type Cfg = { org?: string[]; roles?: Record<string, string[]> };
/** Visible filters: user choice → role default → organisation default → built-in default. */
export function effectiveFilters(index: IndexKey, indexDefaults: Record<string, unknown> | null, prefs: Record<string, unknown> | null, role: string) {
  const cfg = (indexDefaults?.[`${index}_filters`] ?? {}) as Cfg;
  const mine = prefs?.[`${index}_filters`] as string[] | undefined;
  const pick = mine ?? cfg.roles?.[role] ?? cfg.org ?? DEFAULT_VISIBLE[index];
  const source = mine ? 'user' : cfg.roles?.[role] ? 'role' : cfg.org ? 'organization' : 'default';
  const allowed = new Set<string>(INDEX_FILTERS[index]);
  return { keys: pick.filter((k) => allowed.has(k)) as FilterKey[], source };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type FilterValues = Partial<Record<FilterKey, string | boolean | { min?: number; max?: number }>>;

/** Reads f_<key> (and f_<key>_min / f_<key>_max for ranges) from the query string; invalid values are ignored. */
export function parseFilters(query: Record<string, unknown>, index: IndexKey): FilterValues {
  const out: FilterValues = {};
  const str = (k: string) => (typeof query[k] === 'string' ? (query[k] as string).trim().slice(0, 200) : '');
  for (const key of INDEX_FILTERS[index]) {
    const def = FILTERS[key] as Def;
    if (def.type === 'range') {
      const min = Number(str(`f_${key}_min`)), max = Number(str(`f_${key}_max`));
      const r: { min?: number; max?: number } = {};
      if (str(`f_${key}_min`) && Number.isFinite(min)) r.min = min;
      if (str(`f_${key}_max`) && Number.isFinite(max)) r.max = max;
      if (r.min !== undefined || r.max !== undefined) out[key] = r;
      continue;
    }
    const v = str(`f_${key}`);
    if (!v) continue;
    if (def.type === 'bool') { if (v === '1' || v === 'true') out[key] = true; continue; }
    if (def.type === 'days') { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 3650) out[key] = v; continue; }
    if (def.type === 'enum' && !def.values.includes(v)) continue;
    if (def.type === 'uuid' && !UUID.test(v)) continue;
    if (def.type === 'manager' && v !== 'me' && !UUID.test(v)) continue;
    out[key] = v;
  }
  return out;
}

const and = (tx: Tx, parts: Frag[]) => parts.reduce((acc, p, i) => (i === 0 ? p : tx`${acc} AND ${p}`), tx`TRUE`);

/**
 * SQL for the filters. `target` = which rows are listed; aliases are the names used in the caller's query.
 * Customer conditions apply to the customer row, store/space conditions become EXISTS sub-queries.
 */
export function filterSql(tx: Tx, f: FilterValues, s: Session, target: 'customers' | 'stores', alias: { c: string; b?: string }) {
  const parts: Record<Entity, Frag[]> = { c: [], b: [], s: [] };
  const al: Record<Entity, string> = { c: alias.c, b: target === 'stores' ? alias.b! : 'fb', s: 'fs' };
  for (const [key, value] of Object.entries(f) as [FilterKey, FilterValues[FilterKey]][]) {
    const def = FILTERS[key] as Def;
    if (key === 'c_archived') continue; // handled by the caller (separate archive list)
    const a = tx(al[def.entity]);
    if (key === 'c_mine') { parts.c.push(tx`${a}.account_manager_id = ${s.userId}`); continue; }
    switch (def.type) {
      case 'enum': case 'text': case 'uuid':
        parts[def.entity].push(tx`${a}.${tx(def.col)} = ${value as string}`); break;
      case 'manager':
        parts.c.push(tx`${a}.account_manager_id = ${value === 'me' ? s.userId : (value as string)}`); break;
      case 'days':
        parts[def.entity].push(tx`${a}.${tx(def.col)} >= now() - (${Number(value)} * interval '1 day')`); break;
      case 'city':
        parts.b.push(tx`${a}.city_key = ${searchKey(value as string)}`); break;
      case 'range': {
        const r = value as { min?: number; max?: number };
        if (r.min !== undefined) parts[def.entity].push(tx`${a}.${tx(def.col)} >= ${r.min}`);
        if (r.max !== undefined) parts[def.entity].push(tx`${a}.${tx(def.col)} <= ${r.max}`);
        break;
      }
    }
  }
  const out: Frag[] = [...parts.c];
  const spaceExists = (branchAlias: string) => tx`EXISTS (SELECT 1 FROM spaces fs WHERE fs.branch_id = ${tx(branchAlias)}.id AND ${and(tx, parts.s)})`;
  if (target === 'customers') {
    if (parts.b.length || parts.s.length) {
      const inner = [...parts.b, ...(parts.s.length ? [spaceExists('fb')] : [])];
      out.push(tx`EXISTS (SELECT 1 FROM branches fb WHERE fb.customer_id = ${tx(alias.c)}.id AND ${and(tx, inner)})`);
    }
  } else {
    out.push(...parts.b);
    if (parts.s.length) out.push(spaceExists(alias.b!));
  }
  return out.length ? tx`AND ${and(tx, out)}` : tx``;
}

/** Saved-view filters ({ c_status: 'active', s_area_min: '100' }) → the query-string shape parseFilters reads. */
export const asQuery = (filters: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(filters ?? {}).map(([k, v]) => [`f_${k}`, String(v)]));
