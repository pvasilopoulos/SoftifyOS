// Read models of customers, stores and spaces: one shape for the Integration API v1 responses and the
// webhook payloads (ids, your external ids, value names instead of value ids, custom fields).
import type postgres from 'postgres';
import type { Tx } from './db.js';

type Frag = postgres.PendingQuery<postgres.Row[]>;
export type ReadEntity = 'customer' | 'branch' | 'space';

export const customerOut = (tx: Tx, T: string): Frag => tx`
  SELECT c.external_id, c.id, c.code, c.kind, c.name, c.trade_name, c.vat, c.tax_office, c.gemi, c.activity, c.status, c.category, c.tags, c.source,
         c.parent_id, p.external_id AS parent_external_id, c.account_manager_id, u.email AS account_manager_email, c.email, c.phone, c.mobile, c.website,
         json_build_object('street', c.address_street, 'city', c.address_city, 'postal', c.address_postal, 'region', c.address_region, 'country', c.address_country) AS address,
         c.billing_address, gz.name AS geo_zone, c.payment_terms, c.credit_limit::float8 AS credit_limit, c.discount::float8 AS discount, c.annual_value::float8 AS annual_value,
         c.notes, c.custom, c.branches_count, c.spaces_count, c.archived_at, c.created_at, c.updated_at
  FROM customers c
  LEFT JOIN customers p ON p.id = c.parent_id
  LEFT JOIN users u ON u.id = c.account_manager_id
  LEFT JOIN lookup_values gz ON gz.id = c.geo_zone_id
  WHERE c.tenant_id = ${T}`;

export const branchOut = (tx: Tx, T: string): Frag => tx`
  SELECT b.external_id, b.id, b.customer_id, c.external_id AS customer_external_id, b.name, b.trade_name, b.address, b.city, b.postal_code, b.region, b.phone, b.manager_name,
         b.status, gz.name AS geo_zone, fs.name AS fee_schedule, tr.name AS tour, os.name AS ongoing_status, b.seasonality, b.season_months,
         b.custom, b.spaces_count, b.created_at, b.updated_at
  FROM branches b JOIN customers c ON c.id = b.customer_id
  LEFT JOIN lookup_values gz ON gz.id = b.geo_zone_id LEFT JOIN lookup_values fs ON fs.id = b.fee_schedule_id
  LEFT JOIN lookup_values tr ON tr.id = b.tour_id LEFT JOIN lookup_values os ON os.id = b.ongoing_status_id
  WHERE b.tenant_id = ${T}`;

export const spaceOut = (tx: Tx, T: string): Frag => tx`
  SELECT s.external_id, s.id, s.branch_id, b.external_id AS branch_external_id, b.customer_id, s.name, s.kind, s.area_sqm::float8 AS area_sqm, s.notes, s.custom,
         s.created_at, s.updated_at
  FROM spaces s JOIN branches b ON b.id = s.branch_id
  WHERE s.tenant_id = ${T}`;

export const READ_MODEL: Record<ReadEntity, { out: (tx: Tx, T: string) => Frag; alias: string; table: string }> = {
  customer: { out: customerOut, alias: 'c', table: 'customers' },
  branch: { out: branchOut, alias: 'b', table: 'branches' },
  space: { out: spaceOut, alias: 's', table: 'spaces' },
};

// Column → field name in the read model (for changed_fields)
const FIELD_OF: Record<string, string> = {
  address_street: 'address.street', address_city: 'address.city', address_postal: 'address.postal', address_region: 'address.region', address_country: 'address.country',
  geo_zone_id: 'geo_zone', fee_schedule_id: 'fee_schedule', tour_id: 'tour', ongoing_status_id: 'ongoing_status',
};
const IGNORE = new Set(['updated_at', 'created_at', 'search', 'city_key', 'branches_count', 'spaces_count', 'companies_count', 'tenant_id', 'id']);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Fields that differ between two raw rows of the same table, as read-model names (custom fields as custom.<key>). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: string[] = [];
  for (const k of Object.keys(before)) {
    if (IGNORE.has(k) || !(k in after)) continue;
    if (k === 'custom') {
      const a = (before.custom ?? {}) as Record<string, unknown>, b = (after.custom ?? {}) as Record<string, unknown>;
      for (const ck of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[ck], b[ck])) out.push(`custom.${ck}`);
      continue;
    }
    if (!same(before[k], after[k])) out.push(FIELD_OF[k] ?? k);
  }
  return out;
}
