'use client';
// Filters of the index pages. Which filters a user sees comes from Settings → Indexes
// (organisation → role → user); values persist for the browser session.
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ListFilter } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from './app-shell';
import { Popover } from './customer-views';
import type { LookupValue } from './lookup-select';
import { SearchSelect } from './search-select';

export type IndexKey = 'customers' | 'tree' | 'stores';
type Kind =
  | { t: 'enum'; values: readonly string[]; label: (v: string) => string }
  | { t: 'name' | 'id'; list: string }
  | { t: 'city'; source: 'customers' | 'branches' }
  | { t: 'manager' } | { t: 'bool' } | { t: 'range' };

export const FILTER_GROUPS = ['c', 'b', 's'] as const;
export const DEFAULT_FILTERS: Record<IndexKey, string[]> = {
  customers: ['c_status', 'c_mine', 'c_archived'],
  tree: ['c_status', 'c_mine', 'c_archived'],
  stores: ['b_city', 'b_geo_zone', 'b_tour', 'b_ongoing_status', 'b_status', 'c_mine'],
};

function useDefs() {
  const ts = useTranslations('status');
  const tf = useTranslations('filters');
  return useMemo<Record<string, Kind>>(() => ({
    c_status: { t: 'enum', values: ['active', 'prospect', 'negotiation', 'inactive'], label: (v) => ts(v as never) },
    c_kind: { t: 'enum', values: ['group', 'company'], label: (v) => tf(`kind_${v}` as never) },
    c_category: { t: 'name', list: 'customer_category' },
    c_source: { t: 'name', list: 'customer_source' },
    c_payment_terms: { t: 'name', list: 'payment_terms' },
    c_prefecture: { t: 'name', list: 'prefecture' },
    c_city: { t: 'city', source: 'customers' },
    c_geo_zone: { t: 'id', list: 'geo_zone' },
    c_manager: { t: 'manager' },
    c_value: { t: 'range' },
    c_created: { t: 'enum', values: ['7', '30', '90', '365'], label: (v) => tf('lastDays', { n: Number(v) }) },
    c_updated: { t: 'enum', values: ['7', '30', '90', '365'], label: (v) => tf('lastDays', { n: Number(v) }) },
    c_mine: { t: 'bool' },
    c_archived: { t: 'bool' },
    b_status: { t: 'enum', values: ['active', 'inactive'], label: (v) => tf(`bstatus_${v}` as never) },
    b_city: { t: 'city', source: 'branches' },
    b_prefecture: { t: 'name', list: 'prefecture' },
    b_geo_zone: { t: 'id', list: 'geo_zone' },
    b_fee_schedule: { t: 'id', list: 'fee_schedule' },
    b_tour: { t: 'id', list: 'tour' },
    b_ongoing_status: { t: 'id', list: 'ongoing_status' },
    b_seasonality: { t: 'enum', values: ['all_year', 'summer', 'winter', 'custom'], label: (v) => tf(`season_${v}` as never) },
    s_kind: { t: 'name', list: 'space_kind' },
    s_area: { t: 'range' },
  }), [ts, tf]);
}

/** Filter state for one index page; `query` is ready to append to the list request. */
export function useIndexFilters(index: IndexKey) {
  const { data: me } = useMe();
  const visible = (me?.tenant as { index_filters?: Record<IndexKey, string[]> } | undefined)?.index_filters?.[index] ?? DEFAULT_FILTERS[index];
  const storageKey = `ixf.${index}`;
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => { try { setValues(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')); } catch {} }, [storageKey]);
  const save = (v: Record<string, string>) => { setValues(v); try { sessionStorage.setItem(storageKey, JSON.stringify(v)); } catch {} };
  // Every set value applies (a saved view may use filters that are hidden in this user's menu: they show as chips)
  const active = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v != null));
  const query = Object.entries(active).map(([k, v]) => `f_${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return {
    index, visible, values: active,
    set: (k: string, v: string) => save({ ...values, [k]: v }),
    remove: (keys: string[]) => save(Object.fromEntries(Object.entries(values).filter(([k]) => !keys.includes(k)))),
    reset: () => save({}),
    replace: (v: Record<string, string>) => save({ ...v }),
    query,
    count: new Set(Object.keys(active).map((k) => k.replace(/_(min|max)$/, ''))).size,
  };
}
export type IndexFilterState = ReturnType<typeof useIndexFilters>;

/** Option lists, loaded only for the filters that are visible. */
function useOptions(visible: string[], defs: Record<string, Kind>) {
  const lists = [...new Set(visible.map((k) => defs[k]).filter((d): d is Extract<Kind, { list: string }> => !!d && 'list' in d).map((d) => d.list))];
  const lookups = useQuery({
    queryKey: ['filter-lookups', lists], enabled: lists.length > 0, staleTime: 300_000,
    queryFn: async () => Object.fromEntries(await Promise.all(lists.map(async (l) => [l, await api<LookupValue[]>(`/lookups?list=${l}`)] as const))),
  });
  const custCities = useQuery({ queryKey: ['customer-cities'], enabled: visible.includes('c_city'), staleTime: 300_000, queryFn: () => api<{ city: string; customers: number }[]>('/customers/cities') });
  const storeCities = useQuery({ queryKey: ['branch-cities'], enabled: visible.includes('b_city'), staleTime: 300_000, queryFn: () => api<{ city: string; stores: number }[]>('/branches/cities') });
  const users = useQuery({ queryKey: ['users'], enabled: visible.includes('c_manager'), staleTime: 300_000, queryFn: () => api<{ id: string; full_name: string }[]>('/users') });
  return { lookups: lookups.data ?? {}, custCities: custCities.data ?? [], storeCities: storeCities.data ?? [], users: users.data ?? [] };
}

function useOptionsFor(state: IndexFilterState) {
  const defs = useDefs();
  const tf = useTranslations('filters');
  const locale = useLocale();
  const o = useOptions(state.visible, defs);
  const optionsOf = (key: string): { value: string; label: string; hint?: string }[] => {
    const d = defs[key];
    if (!d) return [];
    switch (d.t) {
      case 'enum': return d.values.map((v) => ({ value: v, label: d.label(v) }));
      case 'name': return (o.lookups[d.list] ?? []).filter((v) => v.active || state.values[key] === v.name).map((v) => ({ value: v.name, label: v.name }));
      case 'id': return (o.lookups[d.list] ?? []).filter((v) => v.active || state.values[key] === v.id).map((v) => ({ value: v.id, label: v.name }));
      case 'city': return d.source === 'customers'
        ? o.custCities.map((c) => ({ value: c.city, label: c.city, hint: c.customers.toLocaleString(locale) }))
        : o.storeCities.map((c) => ({ value: c.city, label: c.city, hint: c.stores.toLocaleString(locale) }));
      case 'manager': return [{ value: 'me', label: tf('me') }, ...o.users.map((u) => ({ value: u.id, label: u.full_name }))];
      default: return [];
    }
  };
  return { defs, optionsOf };
}

/** The filter button + popover (grouped: customer, store, space). */
export function IndexFilterMenu({ state }: { state: IndexFilterState }) {
  const t = useTranslations('customers');
  const tf = useTranslations('filters');
  const [open, setOpen] = useState(false);
  const { defs, optionsOf } = useOptionsFor(state);
  const groups = FILTER_GROUPS.map((g) => ({ g, keys: state.visible.filter((k) => k.startsWith(`${g}_`) && defs[k]) })).filter((x) => x.keys.length);
  const showGroupTitles = groups.length > 1;

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('filters')} title={t('filters')}
        className={clsx('relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:text-text', state.count && 'border-primary bg-primary-soft text-primary')}>
        <ListFilter size={18} />
        {state.count > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-white">{state.count}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold">{t('filters')}</span>
          {state.count > 0 && <button onClick={state.reset} className="text-sm font-medium text-primary">{t('clearFilters')}</button>}
        </div>
        {!groups.length && <p className="text-sm text-muted">{tf('none')}</p>}
        <div className="space-y-5">
          {groups.map(({ g, keys }) => {
            const choices = keys.filter((k) => defs[k].t !== 'bool');
            const toggles = keys.filter((k) => defs[k].t === 'bool');
            return (
              <section key={g}>
                {showGroupTitles && (
                  <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
                    <span className="text-sm font-semibold">{tf(`g_${g}`)}</span>
                    {g !== 'c' && <span className="truncate text-[11px] text-muted">{tf(`hint_${state.index}_${g}`)}</span>}
                  </div>
                )}
                <div className="space-y-3">
                  {choices.map((k) => <FilterControl key={k} k={k} kind={defs[k]} state={state} options={optionsOf(k)} />)}
                  {toggles.length > 0 && (
                    <div className="space-y-0.5">
                      {toggles.map((k) => (
                        <label key={k} className="flex cursor-pointer items-center justify-between rounded-xl px-1 py-1.5 text-sm">
                          {tf(k)}
                          <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={state.values[k] === '1'} onChange={(e) => state.set(k, e.target.checked ? '1' : '')} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <button onClick={() => setOpen(false)} className="mt-4 w-full rounded-xl bg-primary py-2.5 font-semibold text-white sm:hidden">{t('done')}</button>
      </Popover>
    </div>
  );
}

function FilterControl({ k, kind, state, options }: { k: string; kind: Kind; state: IndexFilterState; options: { value: string; label: string; hint?: string }[] }) {
  const t = useTranslations('customers');
  const tf = useTranslations('filters');
  const label = <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{tf(k)}</div>;
  if (kind.t === 'range') {
    const box = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';
    return (
      <div>
        {label}
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min={0} inputMode="decimal" placeholder={tf('min')} className={box} value={state.values[`${k}_min`] ?? ''} onChange={(e) => state.set(`${k}_min`, e.target.value)} />
          <input type="number" min={0} inputMode="decimal" placeholder={tf('max')} className={box} value={state.values[`${k}_max`] ?? ''} onChange={(e) => state.set(`${k}_max`, e.target.value)} />
        </div>
      </div>
    );
  }
  const value = state.values[k] ?? '';
  if (kind.t === 'enum' && options.length <= 5) {
    return (
      <div>
        {label}
        <div className="flex flex-wrap gap-1.5">
          {[{ value: '', label: t('all') }, ...options].map((o) => (
            <button key={o.value || 'all'} onClick={() => state.set(k, o.value)}
              className={clsx('rounded-full border px-3 py-1.5 text-sm', value === o.value ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border')}>{o.label}</button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      {label}
      <SearchSelect value={value} onChange={(v) => state.set(k, v)} allLabel={t('all')} placeholder={tf('searchIn', { name: tf(k) })} ariaLabel={tf(k)}
        options={value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options} />
    </div>
  );
}

/** Removable chips for the active filters. */
export function useFilterChips(state: IndexFilterState) {
  const tf = useTranslations('filters');
  const { defs, optionsOf } = useOptionsFor(state);
  const keys = [...new Set(Object.keys(state.values).map((k) => k.replace(/_(min|max)$/, '')))].filter((k) => defs[k]);
  return keys.map((k) => {
    const d = defs[k];
    let text: string;
    if (d.t === 'bool') text = tf(k);
    else if (d.t === 'range') text = `${tf(k)}: ${state.values[`${k}_min`] ?? '…'} – ${state.values[`${k}_max`] ?? '…'}`;
    else text = `${tf(k)}: ${optionsOf(k).find((o) => o.value === state.values[k])?.label ?? state.values[k]}`;
    return { key: k, label: text, onRemove: () => state.remove([k, `${k}_min`, `${k}_max`]) };
  });
}
