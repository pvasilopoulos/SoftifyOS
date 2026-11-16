'use client';
// "Customers & stores" (expandable hierarchy) and "Stores" (flat list) views of the Customers page.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowDownAZ, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FilePlus2, LayoutGrid, Loader2, MapPin, Plus, Store,
} from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { money } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { EntityTile, Skeleton, StatusBadge } from './ui';
import { BranchDialog } from './customer-dialogs';

export type ListFilters = { status: string; sort: string; mine: boolean; archived: boolean; q: string };

type TreeSpace = { id: string; name: string; kind: string; area_sqm: string | null };
type TreeBranch = { id: string; name: string; city: string | null; address: string | null; status: string; spaces_count: number; open_offers: number; spaces: TreeSpace[] };
type TreeCustomer = {
  id: string; code: string; kind: string; name: string; trade_name: string | null; status: string; annual_value: string;
  address_city: string | null; branches_count: number; spaces_count: number; branches: TreeBranch[]; matched_branches?: string[];
};

const offerHref = (customerId: string, customerName: string, branchId: string) =>
  `/offers/new?customer=${customerId}&name=${encodeURIComponent(customerName)}&branch=${branchId}`;

// ============================== Customers & stores ==============================
export type ExpandMode = 'all' | 'none';

/** Expand / collapse all: two labelled buttons on desktop, one toggling icon on mobile. */
export function ExpandToggle({ mode, onChange }: { mode: ExpandMode; onChange: (m: ExpandMode) => void }) {
  const t = useTranslations('customers');
  const btn = 'flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface text-sm font-medium text-muted transition hover:text-text';
  const next = mode === 'all' ? 'none' : 'all';
  return (
    <>
      <button onClick={() => onChange(next)} aria-label={next === 'all' ? t('expandAll') : t('collapseAll')} title={next === 'all' ? t('expandAll') : t('collapseAll')}
        className={clsx(btn, 'grid h-[34px] w-[34px] place-items-center sm:hidden', mode === 'all' && 'border-primary bg-primary-soft text-primary')}>
        {mode === 'all' ? <ChevronsDownUp size={17} /> : <ChevronsUpDown size={17} />}
      </button>
      <button onClick={() => onChange('all')} className={clsx(btn, 'hidden px-3 py-1.5 sm:flex')}><ChevronsUpDown size={15} /> {t('expandAll')}</button>
      <button onClick={() => onChange('none')} className={clsx(btn, 'hidden px-3 py-1.5 sm:flex')}><ChevronsDownUp size={15} /> {t('collapseAll')}</button>
    </>
  );
}

export function CustomerTreeView({ filters, mode }: { filters: ListFilters; mode: ExpandMode }) {
  const t = useTranslations('customers');
  const tc = useTranslations('customer');
  const locale = useLocale();
  // Expansion = default for everyone ("all" / "none") + per-row exceptions, so "expand all" also covers pages loaded later
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [openSpaces, setOpenSpaces] = useState<Set<string>>(new Set());
  const [addFor, setAddFor] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['customers', 'tree', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '30', sort: filters.sort, include: 'branches' });
      if (filters.status !== 'all') p.set('status', filters.status);
      if (filters.mine) p.set('manager', 'me');
      if (filters.archived) p.set('archived', '1');
      if (filters.q.length >= 2) p.set('q', filters.q);
      if (pageParam) p.set('cursor', pageParam);
      return api<Page<TreeCustomer>>(`/customers?${p}`, { signal });
    },
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const searching = filters.q.length >= 2;
  useEffect(() => { setToggled(new Set()); }, [filters, mode]);

  const isOpen = (c: TreeCustomer) => {
    const base = mode === 'all' || (searching && !!c.matched_branches?.length); // search results open on the matching stores
    return toggled.has(c.id) ? !base : base;
  };
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  const listRef = useRef<HTMLDivElement>(null);
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => 92, overscan: 6, scrollMargin: listRef.current?.offsetTop ?? 0 });
  const items = v.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= rows.length - 6 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [lastIndex, rows.length, query]);

  return (
    <div>

      {query.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />)}</div>
      ) : rows.length === 0 ? <p className="py-16 text-center text-muted">{t('empty')}</p> : (
        <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((it) => {
            const c = rows[it.index];
            const open = isOpen(c);
            const matched = new Set(c.matched_branches ?? []);
            return (
              <div key={c.id} data-index={it.index} ref={v.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start - v.options.scrollMargin}px)` }} className="pb-3">
                <div className={clsx('card overflow-hidden', open && 'border-primary/30')}>
                  {/* Customer row */}
                  <div className="flex items-center gap-2 p-3">
                    <button onClick={() => setToggled((s) => toggle(s, c.id))} aria-expanded={open} aria-label={`${open ? t('collapse') : t('expand')}: ${c.name}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2" disabled={!c.branches.length}>
                      {c.branches.length ? (open ? <ChevronDown size={20} className="text-primary" /> : <ChevronRight size={20} />) : <span className="h-1.5 w-1.5 rounded-full bg-border" />}
                    </button>
                    <Link href={`/customers/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <EntityTile name={c.name} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold hover:text-primary">{c.name}</div>
                        <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted">
                          {t('storesCount', { count: c.branches_count })} · {t('spacesCount', { count: c.spaces_count })}
                          {c.address_city && <> · <MapPin size={12} className="shrink-0" />{c.address_city}</>}
                        </div>
                      </div>
                    </Link>
                    <div className="hidden text-right sm:block">
                      <div className="tabular text-sm font-semibold">{money(c.annual_value, locale, 0)}</div>
                      <StatusBadge status={c.status} />
                    </div>
                    <button onClick={() => setAddFor(c.id)} title={t('addStore')} aria-label={t('addStore')}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-primary hover:bg-primary-soft"><Plus size={18} /></button>
                  </div>

                  {/* Stores */}
                  {open && (
                    <ul className="border-t border-border bg-surface-2/40 py-1.5">
                      {c.branches.map((b, i) => {
                        const spacesOpen = openSpaces.has(b.id);
                        const last = i === c.branches.length - 1 && c.branches_count <= c.branches.length;
                        return (
                          <li key={b.id} className="relative pl-9 pr-3">
                            {/* tree connector */}
                            <span className={clsx('absolute left-[29px] top-0 w-px bg-border', last ? 'h-[26px]' : 'h-full')} />
                            <span className="absolute left-[29px] top-[26px] h-px w-3 bg-border" />
                            <div className={clsx('ml-3 flex items-center gap-2 rounded-xl px-2 py-2', matched.has(b.id) && 'bg-warning-soft ring-1 ring-warning/40')}>
                              <button onClick={() => setOpenSpaces((s) => toggle(s, b.id))} aria-expanded={spacesOpen}
                                className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Store size={15} /></span>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">{b.name}</div>
                                  <div className="truncate text-xs text-muted">
                                    {[b.address, b.city].filter(Boolean).join(', ') || '—'} · {t('spacesCount', { count: b.spaces_count })}
                                  </div>
                                </div>
                                {b.open_offers > 0 && <span className="hidden shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning sm:inline">{t('openOffers', { count: b.open_offers })}</span>}
                                {b.status === 'inactive' && <StatusBadge status="inactive" />}
                                {b.spaces_count > 0 && <ChevronDown size={16} className={clsx('shrink-0 text-muted transition-transform', spacesOpen && 'rotate-180')} />}
                              </button>
                              <Link href={offerHref(c.id, c.name, b.id)} title={t('offerForStore')} aria-label={t('offerForStore')}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-primary-soft hover:text-primary"><FilePlus2 size={16} /></Link>
                            </div>
                            {spacesOpen && (
                              <ul className="mb-1 ml-14 flex flex-wrap gap-1.5 pb-1">
                                {b.spaces.map((s) => (
                                  <li key={s.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs">
                                    <LayoutGrid size={12} className="text-primary" />
                                    <span className="font-medium">{s.name}</span>
                                    <span className="text-muted">{tc(`spaceKinds.${s.kind}` as never)}{s.area_sqm && ` · ${Number(s.area_sqm)} m²`}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                      {c.branches_count > c.branches.length && (
                        <li className="pl-12 pr-3 pt-1">
                          <Link href={`/customers/${c.id}?tab=branches`} className="text-sm font-medium text-primary">{t('moreStores', { count: c.branches_count - c.branches.length })}</Link>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {query.isFetchingNextPage && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted" /></div>}
      {addFor && <BranchDialog customerId={addFor} onClose={() => setAddFor(null)} />}
    </div>
  );
}

// ============================== Stores (flat) ==============================
type StoreRow = {
  id: string; name: string; city: string | null; address: string | null; postal_code: string | null; status: string; spaces_count: number;
  customer_id: string; customer_name: string; customer_status: string; open_offers: number;
};

export function StoresView({ q, mine }: { q: string; mine: boolean }) {
  const t = useTranslations('customers');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [sort, setSort] = useState<'name' | 'city' | 'spaces'>('name');
  const cities = useQuery({ queryKey: ['branch-cities'], queryFn: () => api<{ city: string; stores: number }[]>('/branches/cities'), staleTime: 300_000 });

  const query = useInfiniteQuery({
    queryKey: ['branches', q, city, status, sort, mine],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '40', sort });
      if (q.length >= 2) p.set('q', q);
      if (city) p.set('city', city);
      if (status) p.set('status', status);
      if (mine) p.set('manager', 'me');
      if (pageParam) p.set('cursor', pageParam);
      return api<Page<StoreRow>>(`/branches?${p}`, { signal });
    },
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const listRef = useRef<HTMLDivElement>(null);
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => 88, overscan: 8, scrollMargin: listRef.current?.offsetTop ?? 0 });
  const items = v.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= rows.length - 10 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [lastIndex, rows.length, query]);

  const chip = (active: boolean) => clsx('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition',
    active ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted');

  return (
    <div>
      <div className="no-scrollbar mb-4 flex items-center gap-2 overflow-x-auto">
        <label className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface pl-3 text-sm">
          <MapPin size={15} className="text-muted" />
          <select aria-label={t('city')} value={city} onChange={(e) => setCity(e.target.value)} className="rounded-full bg-transparent py-1.5 pr-3 font-medium outline-none">
            <option value="">{t('allCities')}</option>
            {cities.data?.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.stores.toLocaleString()})</option>)}
          </select>
        </label>
        <button onClick={() => setStatus(status === 'active' ? '' : 'active')} className={chip(status === 'active')}>{t('activeStores')}</button>
        <button onClick={() => setStatus(status === 'inactive' ? '' : 'inactive')} className={chip(status === 'inactive')}>{t('inactiveStores')}</button>
        <span className="mx-1 h-6 w-px shrink-0 bg-border" />
        <button onClick={() => setSort('name')} className={chip(sort === 'name')}><ArrowDownAZ size={15} /> {t('sortName')}</button>
        <button onClick={() => setSort('city')} className={chip(sort === 'city')}><MapPin size={15} /> {t('sortCity')}</button>
        <button onClick={() => setSort('spaces')} className={chip(sort === 'spaces')}><LayoutGrid size={15} /> {t('sortSpaces')}</button>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />)}</div>
      ) : rows.length === 0 ? <p className="py-16 text-center text-muted">{t('noStoresFound')}</p> : (
        <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((it) => {
            const b = rows[it.index];
            return (
              <div key={b.id} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start - v.options.scrollMargin}px)` }} className="pb-3">
                <div className="card flex items-center gap-3 p-3.5 transition hover:border-primary/40">
                  <Link href={`/customers/${b.customer_id}?tab=branches&branch=${b.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary"><Store size={22} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{b.name}</div>
                      <div className="truncate text-sm text-muted">{b.customer_name}</div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs text-muted">
                        <MapPin size={12} className="shrink-0" />{[b.address, b.postal_code, b.city].filter(Boolean).join(', ') || '—'}
                      </div>
                    </div>
                  </Link>
                  <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">{t('spacesCount', { count: b.spaces_count })}</span>
                    {b.open_offers > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">{t('openOffers', { count: b.open_offers })}</span>}
                    {b.status === 'inactive' && <StatusBadge status="inactive" />}
                  </div>
                  <Link href={offerHref(b.customer_id, b.customer_name, b.id)} title={t('offerForStore')} aria-label={t('offerForStore')}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-primary-soft hover:text-primary"><FilePlus2 size={18} /></Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {query.isFetchingNextPage && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted" /></div>}
    </div>
  );
}
