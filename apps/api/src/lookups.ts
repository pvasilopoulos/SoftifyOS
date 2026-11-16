// Value lists (Settings → Value lists). Two kinds:
//  - id lists: records keep the lookup_values.id (geo zones, fee schedules, tours, ongoing status)
//  - name lists: records keep the value's name as text (prefecture, category, source, payment terms, space kind),
//    so filters/search stay simple; renaming a value updates those records.
import type { Tx } from './db.js';

export const ID_LISTS = ['geo_zone', 'fee_schedule', 'tour', 'ongoing_status'] as const;
export const NAME_LISTS = ['prefecture', 'customer_category', 'customer_source', 'payment_terms', 'space_kind'] as const;
export const ALL_LISTS = [...ID_LISTS, ...NAME_LISTS] as const;
export type NameList = (typeof NAME_LISTS)[number];

/** Where each name list is stored: [table, column] */
export const NAME_LIST_COLUMNS: Record<NameList, [string, string][]> = {
  prefecture: [['customers', 'address_region'], ['branches', 'region']],
  customer_category: [['customers', 'category']],
  customer_source: [['customers', 'source']],
  payment_terms: [['customers', 'payment_terms']],
  space_kind: [['spaces', 'kind']],
};
export const isNameList = (l: string): l is NameList => (NAME_LISTS as readonly string[]).includes(l);

/**
 * The list's own spelling of `name` (accent/case-insensitive match).
 * Returns undefined when not sent, null when cleared, false when the value is not in the list.
 * With `create`, a missing value is added to the list (used by the integration API).
 */
export async function canonicalName(tx: Tx, tenantId: string, list: NameList, name: string | null | undefined, opts: { create?: boolean; cache?: Map<string, string> } = {}) {
  if (name === undefined) return undefined;
  if (name === null || name.trim() === '') return null;
  const k = `${list}:${name.trim().toLowerCase()}`;
  if (opts.cache?.has(k)) return opts.cache.get(k)!;
  const [found] = await tx`SELECT name FROM lookup_values WHERE tenant_id = ${tenantId} AND list = ${list} AND search_key(name) = search_key(${name.trim()})`;
  let value = found?.name as string | undefined;
  if (!value) {
    if (!opts.create) return false;
    const [{ next }] = await tx`SELECT coalesce(max(sort), 0) + 1 AS next FROM lookup_values WHERE tenant_id = ${tenantId} AND list = ${list}`;
    [{ name: value }] = await tx`INSERT INTO lookup_values (tenant_id, list, name, sort) VALUES (${tenantId}, ${list}, ${name.trim()}, ${next}) RETURNING name`;
  }
  opts.cache?.set(k, value!);
  return value!;
}

/** Validates several name-list fields of a record in place; returns the first field that is not in its list. */
export async function canonicalizeFields<T extends Record<string, unknown>>(tx: Tx, tenantId: string, rec: T, fields: readonly (readonly [keyof T & string, NameList])[]) {
  for (const [field, list] of fields) {
    const v = await canonicalName(tx, tenantId, list, rec[field] as string | null | undefined);
    if (v === false) return field;
    if (v !== undefined) (rec as Record<string, unknown>)[field] = v;
  }
  return null;
}

/** How many records use each value of a name list: Map<search_key-ish lower name, count>. */
export async function nameListUsage(tx: Tx, tenantId: string, list: NameList) {
  const usage = new Map<string, number>();
  for (const [table, column] of NAME_LIST_COLUMNS[list]) {
    const rows = await tx`SELECT ${tx(column)} AS v, count(*)::int AS n FROM ${tx(table)} WHERE tenant_id = ${tenantId} AND ${tx(column)} IS NOT NULL GROUP BY 1`;
    for (const r of rows) usage.set(r.v, (usage.get(r.v) ?? 0) + r.n);
  }
  return usage;
}

/** Rename: records that used the old name get the new one (same transaction). */
export async function renameInRecords(tx: Tx, tenantId: string, list: NameList, from: string, to: string) {
  if (from === to) return;
  for (const [table, column] of NAME_LIST_COLUMNS[list]) {
    await tx`UPDATE ${tx(table)} SET ${tx(column)} = ${to} WHERE tenant_id = ${tenantId} AND ${tx(column)} = ${from}`;
  }
}

export async function nameInUse(tx: Tx, tenantId: string, list: NameList, name: string) {
  for (const [table, column] of NAME_LIST_COLUMNS[list]) {
    const [r] = await tx`SELECT 1 FROM ${tx(table)} WHERE tenant_id = ${tenantId} AND ${tx(column)} = ${name} LIMIT 1`;
    if (r) return true;
  }
  return false;
}
