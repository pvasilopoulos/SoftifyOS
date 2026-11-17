'use client';
// Values of each display surface (customer row, store row, store details, space chip, customer card)
// and the small components the screens use. What is shown and in which order comes from display.tsx.
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CustomerDetail } from '@/lib/customers';
import { useLocale, useTranslations } from 'next-intl';
import { Activity, CalendarRange, Globe2, LayoutGrid, Map, MapPin, Phone, Receipt, Route, Tag, UserRound, Mail, Smartphone, Globe, Star, Hash, Loader2 } from 'lucide-react';
import { money } from '@/lib/format';
import type { Effective } from '@/lib/forms';
import { DisplayRows, DisplaySection, useValues, type DValues, type Surface } from './display';

type Any = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

// ---------------------------------------------------------------- customer row (list & tree)
export function useCustomerRowValues(c: Any, override?: Effective): DValues {
  const t = useTranslations('customers');
  const ts = useTranslations('status');
  const locale = useLocale();
  const kind = c.kind === 'group' ? `${t('group')} · ${t('companies', { count: Number(c.companies_count ?? 0) })}` : str(c.trade_name) ?? str(c.code);
  const tags = (c.tags as string[] | undefined) ?? [];
  return useValues('disp_customer_row', {
    kind_info: kind ? { value: kind } : null,
    stores_spaces: { value: `${t('storesCount', { count: Number(c.branches_count ?? 0) })} · ${t('spacesCount', { count: Number(c.spaces_count ?? 0) })}` },
    city: str(c.address_city) ? { value: str(c.address_city), icon: MapPin } : null,
    region: str(c.address_region) ? { value: str(c.address_region) } : null,
    code: str(c.code) ? { value: str(c.code), icon: Hash } : null,
    vat: str(c.vat) ? { value: str(c.vat) } : null,
    phone: str(c.phone) ? { value: str(c.phone), icon: Phone } : null,
    email: str(c.email) ? { value: str(c.email), icon: Mail } : null,
    manager: str(c.manager_name) ? { value: str(c.manager_name), icon: UserRound } : null,
    status: c.status ? { value: ts(String(c.status) as never), status: String(c.status) } : null,
    tags: tags.length ? { value: tags.slice(0, 3).map((x) => `#${x}`).join(' ') } : null,
    category: str(c.category) ? { value: str(c.category) } : null,
    source: str(c.source) ? { value: str(c.source) } : null,
    annual_value: c.annual_value !== undefined ? { value: money(String(c.annual_value), locale, 0) } : null,
  }, c.custom as Any, override);
}

// ---------------------------------------------------------------- store row (tree & store list)
export function useStoreRowValues(b: Any, override?: Effective): DValues {
  const t = useTranslations('customers');
  const ts = useTranslations('status');
  const tc = useTranslations('customer');
  return useValues('disp_store_row', {
    trade_name: str(b.trade_name) ? { value: str(b.trade_name) } : null,
    customer: str(b.customer_name) ? { value: str(b.customer_name) } : null,
    address: str(b.address) || str(b.postal_code) ? { value: [b.address, b.postal_code].filter(Boolean).join(', '), icon: MapPin } : null,
    city: str(b.city) ? { value: str(b.city) } : null,
    region: str(b.region) ? { value: str(b.region) } : null,
    spaces_count: { value: t('spacesCount', { count: Number(b.spaces_count ?? 0) }) },
    phone: str(b.phone) ? { value: str(b.phone), icon: Phone } : null,
    manager: str(b.manager_name) ? { value: str(b.manager_name), icon: UserRound } : null,
    open_offers: Number(b.open_offers ?? 0) > 0 ? { value: t('openOffers', { count: Number(b.open_offers) }) } : null,
    ongoing_status: str(b.ongoing_status_name) ? { value: str(b.ongoing_status_name) } : null,
    tour: str(b.tour_name) ? { value: str(b.tour_name) } : null,
    geo_zone: str(b.geo_zone_name) ? { value: str(b.geo_zone_name) } : null,
    seasonality: str(b.seasonality) ? { value: tc(`seasons.${b.seasonality}` as never) } : null,
    status: b.status ? { value: ts(String(b.status) as never), status: String(b.status) } : null,
  }, b.custom as Any, override);
}

// ---------------------------------------------------------------- store details (chips)
export function useStoreDetailValues(b: Any, override?: Effective): DValues {
  const t = useTranslations('customer');
  const ts = useTranslations('status');
  const months = t.raw('months') as string[];
  const sm = (b.season_months as number[] | undefined) ?? [];
  const season = !b.seasonality ? null : b.seasonality === 'custom' ? (sm.length ? sm.map((m) => months[m - 1]).join(', ') : t('seasons.custom')) : t(`seasons.${b.seasonality}` as never);
  return useValues('disp_store_details', {
    ongoing_status: str(b.ongoing_status_name) ? { value: str(b.ongoing_status_name), icon: Activity } : null,
    trade_name: str(b.trade_name) ? { value: str(b.trade_name), icon: Tag } : null,
    address: str(b.address) || str(b.postal_code) ? { value: [b.address, b.postal_code].filter(Boolean).join(', '), icon: MapPin } : null,
    city: str(b.city) ? { value: str(b.city), icon: MapPin } : null,
    region: str(b.region) ? { value: str(b.region), icon: Map } : null,
    geo_zone: str(b.geo_zone_name) ? { value: str(b.geo_zone_name), icon: Globe2 } : null,
    fee_schedule: str(b.fee_schedule_name) ? { value: str(b.fee_schedule_name), icon: Receipt } : null,
    tour: str(b.tour_name) ? { value: str(b.tour_name), icon: Route } : null,
    seasonality: season ? { value: season, icon: CalendarRange } : null,
    phone: str(b.phone) ? { value: <a href={`tel:${String(b.phone).replace(/\s/g, '')}`} className="text-primary">{String(b.phone)}</a>, icon: Phone } : null,
    manager: str(b.manager_name) ? { value: str(b.manager_name), icon: UserRound } : null,
    status: b.status ? { value: ts(String(b.status) as never) } : null,
  }, b.custom as Any, override);
}
/** Store details chips (tree and customer card). */
export function BranchDetailsDisplay({ b, override }: { b: Any; override?: Effective }) {
  const v = useStoreDetailValues(b, override);
  return <DisplaySection surface="disp_store_details" section="main" values={v} override={override} />;
}

// ---------------------------------------------------------------- spaces
function useSpaceValues(s: Any, override?: Effective, icon = true) {
  return useValues('disp_space', {
    name: { value: <span className="font-medium text-text">{String(s.name)}</span>, icon: icon ? LayoutGrid : undefined },
    kind: str(s.kind) ? { value: str(s.kind) } : null,
    area: s.area_sqm ? { value: `${Number(s.area_sqm)} m²` } : null,
    notes: str(s.notes) ? { value: str(s.notes) } : null,
  }, s.custom as Any, override);
}
/** One space as a single line (customer card store list). */
export function SpaceLine({ s, override }: { s: Any; override?: Effective }) {
  const v = useSpaceValues(s, override, false);
  return <DisplaySection surface="disp_space" section="main" values={v} layout="line" className="text-xs text-muted" override={override} />;
}
export function SpaceChip({ s, override }: { s: Any; override?: Effective }) {
  const v = useSpaceValues(s, override);
  return (
    <li className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-muted">
      <DisplaySection surface="disp_space" section="main" values={v} layout="line" override={override} />
    </li>
  );
}

// ---------------------------------------------------------------- customer card
export function useCustomerCardValues(c: Any, extra: { primary?: string | null; termsLabel: (x: string | null) => string | null; sourceLabel: (x: string | null) => string | null }, override?: Effective): DValues {
  const t = useTranslations('customer');
  const locale = useLocale();
  const b = c.billing_address as Any | null;
  const link = (href: string, text: string): ReactNode => <a href={href} className="text-primary hover:underline" target={href.startsWith('http') ? '_blank' : undefined} rel="noopener">{text}</a>;
  return useValues('disp_customer_card', {
    code: str(c.code) ? { value: str(c.code) } : null,
    vat: str(c.vat) ? { value: str(c.vat) } : null,
    tax_office: str(c.tax_office) ? { value: str(c.tax_office) } : null,
    gemi: str(c.gemi) ? { value: str(c.gemi) } : null,
    activity: str(c.activity) ? { value: str(c.activity) } : null,
    trade_name: str(c.trade_name) ? { value: str(c.trade_name) } : null,
    manager: str(c.account_manager_name) ? { value: str(c.account_manager_name), icon: UserRound } : null,
    source: extra.sourceLabel(str(c.source)) ? { value: extra.sourceLabel(str(c.source)) } : null,
    category: str(c.category) ? { value: str(c.category) } : null,
    region: str(c.address_region) ? { value: str(c.address_region) } : null,
    geo_zone: str(c.geo_zone_name) ? { value: str(c.geo_zone_name) } : null,
    tags: (c.tags as string[] | undefined)?.length ? { value: (c.tags as string[]).map((x) => `#${x}`).join(' ') } : null,
    email: str(c.email) ? { value: link(`mailto:${c.email}`, String(c.email)), icon: Mail } : null,
    phone: str(c.phone) ? { value: link(`tel:${c.phone}`, String(c.phone)), icon: Phone } : null,
    mobile: str(c.mobile) ? { value: link(`tel:${c.mobile}`, String(c.mobile)), icon: Smartphone } : null,
    website: str(c.website) ? { value: link(String(c.website).startsWith('http') ? String(c.website) : `https://${c.website}`, String(c.website)), icon: Globe } : null,
    primary_contact: extra.primary ? { value: extra.primary, icon: Star } : null,
    address: { value: [c.address_street, [c.address_postal, c.address_city].filter(Boolean).join(' '), c.address_region, c.address_country].filter(Boolean).join(', ') || null },
    billing: { value: b ? [b.street, [b.postal, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : t('sameAsAddress') },
    payment_terms: extra.termsLabel(str(c.payment_terms)) ? { value: extra.termsLabel(str(c.payment_terms)) } : null,
    credit_limit: c.credit_limit ? { value: money(String(c.credit_limit), locale, 0) } : null,
    discount: Number(c.discount) ? { value: `${Number(c.discount)}%` } : null,
    annual_value: c.annual_value !== undefined ? { value: money(String(c.annual_value), locale, 0) } : null,
    notes: str(c.notes) ? { value: <span className="whitespace-pre-line">{String(c.notes)}</span> } : null,
  }, c.custom as Any, override);
}

// ---------------------------------------------------------------- row parts (render props: rows are rendered inside lists)
type Parts = Record<string, ReactNode>;
export function CustomerRowParts({ c, override, children }: { c: Any; override?: Effective; children: (p: Parts) => ReactNode }) {
  const v = useCustomerRowValues(c, override);
  return <>{children({
    line: <DisplaySection surface="disp_customer_row" section="line" values={v} layout="line" override={override} />,
    badges: <DisplaySection surface="disp_customer_row" section="badges" values={v} override={override} />,
    side: <DisplaySection surface="disp_customer_row" section="side" values={v} layout="column" className="tabular text-sm font-semibold" override={override} />,
  })}</>;
}
export function StoreRowParts({ b, override, children }: { b: Any; override?: Effective; children: (p: Parts) => ReactNode }) {
  const v = useStoreRowValues(b, override);
  return <>{children({
    title: <DisplaySection surface="disp_store_row" section="title" values={v} layout="line" className="shrink-0 font-normal text-primary before:mr-1 before:content-['·']" override={override} />,
    line: <DisplaySection surface="disp_store_row" section="line" values={v} layout="line" override={override} />,
    badges: <DisplaySection surface="disp_store_row" section="badges" values={v} override={override} />,
  })}</>;
}

// ---------------------------------------------------------------- settings preview with a real record
/** Settings → Module Forms → Display: the surface as it looks with `eff` (draft / view-as), on a real customer. */
export function DisplayPreview({ surface, eff }: { surface: Surface; eff: Effective }) {
  const t = useTranslations('display');
  const list = useQuery({
    queryKey: ['display-preview-list'], staleTime: 300_000,
    queryFn: () => api<{ items: { id: string; name: string; branches_count?: number }[] }>('/customers?limit=30'),
  });
  const [pick, setPick] = useState('');
  const options = list.data?.items ?? [];
  const id = pick || options.find((x) => Number(x.branches_count ?? 0) > 0)?.id || options[0]?.id || '';
  const detail = useQuery({ queryKey: ['customer', id], enabled: !!id, queryFn: () => api<CustomerDetail>(`/customers/${id}`) });
  if (list.isLoading || (id && detail.isLoading)) return <Loader2 className="mx-auto animate-spin text-muted" />;
  if (!id || !detail.data) return <p className="text-sm text-muted">{t('noSample')}</p>;
  const c = { ...detail.data.customer, branches_count: detail.data.branches.length, spaces_count: detail.data.branches.reduce((a, b) => a + b.spaces.length, 0) } as unknown as Any;
  const b0 = detail.data.branches[0];
  const b = b0 ? ({ ...b0, customer_name: detail.data.customer.name, spaces_count: b0.spaces.length } as unknown as Any) : null;
  const noStore = <p className="text-sm text-muted">{t('noStore')}</p>;
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">{t('sample')}</span>
        <select className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" value={id} onChange={(e) => setPick(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      {surface === 'disp_customer_row' && (
        <div className="card flex items-center gap-3 p-3">
          <CustomerRowParts c={c} override={eff}>{(p) => (<>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{String(c.name)}</div>
              <div className="min-w-0 text-xs text-muted">{p.line}</div>
              <div className="mt-1 empty:hidden">{p.badges}</div>
            </div>
            <div className="text-right">{p.side}</div>
          </>)}</CustomerRowParts>
        </div>
      )}
      {surface === 'disp_store_row' && (!b ? noStore : (
        <div className="card p-3">
          <StoreRowParts b={b} override={eff}>{(p) => (
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-x-1 text-sm font-medium"><span className="truncate">{String(b.name)}</span>{p.title}</div>
              <div className="min-w-0 text-xs text-muted">{p.line}</div>
              <div className="mt-1 empty:hidden">{p.badges}</div>
            </div>
          )}</StoreRowParts>
        </div>
      ))}
      {surface === 'disp_store_details' && (!b ? noStore : <div className="rounded-xl border border-border p-2.5"><BranchDetailsDisplay b={b} override={eff} /></div>)}
      {surface === 'disp_space' && (!b0?.spaces.length ? noStore : (
        <ul className="flex flex-wrap gap-1.5">{b0.spaces.map((s) => <SpaceChip key={s.id} s={s as unknown as Any} override={eff} />)}</ul>
      ))}
      {surface === 'disp_customer_card' && <CardPreview c={c} eff={eff} />}
    </div>
  );
}
function CardPreview({ c, eff }: { c: Any; eff: Effective }) {
  const values = useCustomerCardValues(c, { primary: null, termsLabel: (x) => x, sourceLabel: (x) => x }, eff);
  return (
    <div className="space-y-3">
      <DisplayRows surface="disp_customer_card" values={values} override={eff} render={(s, rows) => (
        <section className="rounded-xl border border-border p-3">
          <h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
          <dl className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.key} className="flex justify-between gap-3 py-1.5 text-xs">
                {r.label && <dt className="shrink-0 text-muted">{r.label}</dt>}
                <dd className="min-w-0 text-right font-medium">{r.value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      )} />
    </div>
  );
}
