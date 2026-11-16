import { emptyCustomer, type CustomerFormValues } from '@/components/customer-form';

export type Space = { id: string; name: string; kind: string; area_sqm: string | null; notes: string | null; custom?: Record<string, unknown> };
export type Branch = {
  id: string; name: string; trade_name: string | null; region: string | null;
  geo_zone_id: string | null; fee_schedule_id: string | null; tour_id: string | null; ongoing_status_id: string | null;
  geo_zone_name: string | null; fee_schedule_name: string | null; tour_name: string | null; ongoing_status_name: string | null;
  seasonality: 'all_year' | 'summer' | 'winter' | 'custom'; season_months: number[];
  city: string | null; address: string | null; postal_code: string | null; phone: string | null;
  manager_name: string | null; status: string; spaces_count: number; spaces: Space[]; custom?: Record<string, unknown>;
};
export type Contact = {
  id: string; full_name: string; role_title: string | null; email: string | null; phone: string | null; mobile: string | null;
  is_primary: boolean; notes: string | null; custom?: Record<string, unknown>;
};
export type CustomerProfile = {
  id: string; code: string; kind: 'group' | 'company'; name: string; geo_zone_id: string | null; geo_zone_name: string | null; trade_name: string | null; vat: string | null;
  tax_office: string | null; gemi: string | null; activity: string | null; status: CustomerFormValues['status'];
  category: string | null; tags: string[]; source: string | null; parent_id: string | null; parent_name: string | null;
  account_manager_id: string | null; account_manager_name: string | null;
  email: string | null; phone: string | null; mobile: string | null; website: string | null;
  address_street: string | null; address_city: string | null; address_postal: string | null; address_region: string | null; address_country: string;
  billing_address: { street?: string | null; city?: string | null; postal?: string | null; region?: string | null; country?: string | null } | null;
  payment_terms: string | null; credit_limit: string | null; discount: string; annual_value: string; notes: string | null;
  companies_count: number; branches_count: number; spaces_count: number; archived_at: string | null; created_at: string;
  custom?: Record<string, unknown>;
};
export type CustomerDetail = {
  customer: CustomerProfile;
  stats: {
    open_offers: number; won_offers: number; lost_offers: number; open_amount: string; won_amount: string;
    win_rate: number | null; last_offer_at: string | null; last_activity_at: string | null;
  };
  branches: Branch[];
  contacts: Contact[];
  subsidiaries: { id: string; name: string; code: string; status: string; annual_value: string; branches_count: number }[];
  can: { edit: boolean; archive: boolean };
};

export function toFormValues(c: CustomerProfile): CustomerFormValues {
  const s = (x: string | null | undefined) => x ?? '';
  const b = c.billing_address;
  return {
    ...emptyCustomer(),
    kind: c.kind, code: c.code, geo_zone_id: c.geo_zone_id, name: c.name, trade_name: s(c.trade_name), vat: s(c.vat), tax_office: s(c.tax_office), gemi: s(c.gemi),
    activity: s(c.activity), status: c.status, category: s(c.category), tags: c.tags ?? [], source: s(c.source),
    parent_id: c.parent_id, parent_name: c.parent_name, account_manager_id: c.account_manager_id,
    email: s(c.email), phone: s(c.phone), mobile: s(c.mobile), website: s(c.website),
    address_street: s(c.address_street), address_city: s(c.address_city), address_postal: s(c.address_postal),
    address_region: s(c.address_region), address_country: c.address_country || 'GR',
    billing_same: !b, billing: { street: s(b?.street), city: s(b?.city), postal: s(b?.postal), region: s(b?.region), country: b?.country || 'GR' },
    payment_terms: s(c.payment_terms), credit_limit: c.credit_limit ?? '', discount: String(Number(c.discount)),
    annual_value: String(Number(c.annual_value)), notes: s(c.notes), custom: c.custom ?? {},
  };
}
