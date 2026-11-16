'use client';
import { CustomerAvatar } from './customer-avatar';
// Customers page: toolbar controls (filters / sort / expand), "Customers & stores" tree and "Stores" list.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowDownUp, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FilePlus2, LayoutGrid, ListFilter, Loader2,
  MapPin, Pencil, Plus, Store, Trash2, X,
} from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { money } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { EntityTile, Skeleton, StatusBadge } from './ui';
import { BranchDialog, type BranchLike } from './customer-dialogs';
import { BranchDetails } from './branch-details';

// ============================== Toolbar controls ==============================
const iconBtn = 'relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:text-text';

/** Popover on desktop, bottom sheet on phones. Closes on outside click / Escape. */
export function Popover({ open, onClose, children, align = 'right' }: { open: boolean; onClose: () => void; children: ReactNode; align?: 'right' | 'left' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={onClose} />
      <div ref={ref} role="dialog"
        className={clsx('fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-auto rounded-t-3xl border border-border bg-surface p-4 shadow-2xl sheet-pb',
          'sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:w-80 sm:rounded-2xl', align === 'right' ? 'sm:right-0' : 'sm:left-0')}>
        {children}
      </div>
    </>
  );
}

export type SortOption = { value: string; label: string };

/** Sort: one icon, dropdown to choose the column. */
export function SortMenu({ value, options, onChange }: { value: string; options: SortOption[]; onChange: (v: string) => void }) {
  const t = useTranslations('customers');
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={iconBtn} aria-label={`${t('sortBy')}: ${current?.label}`} title={`${t('sortBy')}: ${current?.label}`} aria-expanded={open}>
        <ArrowDownUp size={18} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('sortBy')}</div>
        <ul>
          {options.map((o) => (
            <li key={o.value}>
              <button onClick={() => { onChange(o.value); setOpen(false); }}
                className={clsx('flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-2', o.value === value && 'font-semibold text-primary')}>
                {o.label} {o.value === value && <Check size={16} />}
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

export type FilterGroup = {
  key: string; label: string;
  options: { value: string; label: string }[];
  value: string; onChange: (v: string) => void;   // '' = all
};

/** Filters: one icon with an active-count badge; grouped choices in a popover / bottom sheet. */
export function FilterMenu({ groups, toggles, onReset }: {
  groups: FilterGroup[];
  toggles: { key: string; label: string; value: boolean; onChange: (v: boolean) => void }[];
  onReset: () => void;
}) {
  const t = useTranslations('customers');
  const [open, setOpen] = useState(false);
  const active = groups.filter((g) => g.value).length + toggles.filter((x) => x.value).length;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('filters')} title={t('filters')}
        className={clsx(iconBtn, active && 'border-primary bg-primary-soft text-primary')}>
        <ListFilter size={18} />
        {active > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-white">{active}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold">{t('filters')}</span>
          {active > 0 && <button onClick={onReset} className="text-sm font-medium text-primary">{t('clearFilters')}</button>}
        </div>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</div>
              {g.options.length > 6 ? (
                <select value={g.value} onChange={(e) => g.onChange(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-primary">
                  <option value="">{t('all')}</option>
                  {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {[{ value: '', label: t('all') }, ...g.options].map((o) => (
                    <button key={o.value || 'all'} onClick={() => g.onChange(o.value)}
                      className={clsx('rounded-full border px-3 py-1.5 text-sm', g.value === o.value ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border')}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {toggles.length > 0 && (
            <div className="space-y-1 border-t border-border pt-3">
              {toggles.map((x) => (
                <label key={x.key} className="flex cursor-pointer items-center justify-between rounded-xl px-1 py-2 text-sm">
                  {x.label}
                  <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={x.value} onChange={(e) => x.onChange(e.target.checked)} />
                </label>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setOpen(false)} className="mt-4 w-full rounded-xl bg-primary py-2.5 font-semibold text-white sm:hidden">{t('done')}</button>
      </Popover>
    </div>
  );
}

/** Removable chips summarising the active filters under the toolbar. */
export function ActiveFilterChips({ chips }: { chips: { key: string; label: string; onRemove: () => void }[] }) {
  if (!chips.length) return null;
  return (
    <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto">
      {chips.map((c) => (
        <button key={c.key} onClick={c.onRemove} className="flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
          {c.label} <X size={13} />
        </button>
      ))}
    </div>
  );
}

export type ExpandMode = 'all' | 'none';

/** Expand / collapse all: a single toggling icon. */
export function ExpandToggle({ mode, onChange }: { mode: ExpandMode; onChange: (m: ExpandMode) => void }) {
  const t = useTranslations('customers');
  const next = mode === 'all' ? 'none' : 'all';
  const label = next === 'all' ? t('expandAll') : t('collapseAll');
  return (
    <button onClick={() => onChange(next)} aria-label={label} title={label}
      className={clsx(iconBtn, mode === 'all' && 'border-primary bg-primary-soft text-primary')}>
      {mode === 'all' ? <ChevronsDownUp size={18} /> : <ChevronsUpDown size={18} />}
    </button>
  );
}

// ============================== Customers & stores ==============================
/** extra = the f_* filter query from useIndexFilters */
export type ListFilters = { sort: string; q: string; extra: string };

type TreeSpace = { id: string; name: string; kind: string; area_sqm: string | null };
type TreeBranch = BranchLike & { status: string; spaces_count: number; open_offers: number; spaces: TreeSpace[] };
type TreeCustomer = {
  id: string; code: string; kind: string; name: string; trade_name: string | null; status: string; annual_value: string;
  address_city: string | null; branches_count: number; spaces_count: number; branches: TreeBranch[]; matched_branches?: string[];
};

const offerHref = (customerId: string, customerName: string, branchId: string) =>
  `/offers/new?customer=${customerId}&name=${encodeURIComponent(customerName)}&branch=${branchId}`;

export function CustomerTreeView({ filters, mode }: { filters: ListFilters; mode: ExpandMode }) {
  const t = useTranslations('customers');
  const tc = useTranslations('customer');
  const locale = useLocale();
  const qc = useQueryClient();
  // Expansion = default for everyone ("all" / "none") + per-row exceptions, so "expand all" also covers pages loaded later
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [openStores, setOpenStores] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ customerId: string; branch?: BranchLike } | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api(`/branches/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); qc.invalidateQueries({ queryKey: ['customer'] }); },
  });

  const query = useInfiniteQuery({
    queryKey: ['customers', 'tree', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '30', sort: filters.sort, include: 'branches' });
      if (filters.q.length >= 2) p.set('q', filters.q);
      if (pageParam) p.set('cursor', pageParam);
      return api<Page<TreeCustomer>>(`/customers?${p}${filters.extra ? `&${filters.extra}` : ''}`, { signal });
    },
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const searching = filters.q.length >= 2;
  useEffect(() => { setToggled(new Set()); setOpenStores(new Set()); }, [filters, mode]);

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
                      <CustomerAvatar name={c.name} size={44} />
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
                    <button onClick={() => setDialog({ customerId: c.id })} title={t('addStore')} aria-label={t('addStore')}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-primary hover:bg-primary-soft"><Plus size={18} /></button>
                  </div>

                  {/* Stores */}
                  {open && (
                    <ul className="border-t border-border bg-surface-2/40 py-1.5">
                      {c.branches.map((b, i) => {
                        // 'Expand all' opens every store (details + spaces) too; a tap on a store flips it
                        const storeOpen = (mode === 'all') !== openStores.has(b.id);
                        const last = i === c.branches.length - 1 && c.branches_count <= c.branches.length;
                        return (
                          <li key={b.id} className="relative pl-9 pr-3">
                            {/* tree connector */}
                            <span className={clsx('absolute left-[29px] top-0 w-px bg-border', last ? 'h-[26px]' : 'h-full')} />
                            <span className="absolute left-[29px] top-[26px] h-px w-3 bg-border" />
                            {/* Phone: name gets the full width; status + actions go on a second line */}
                            <div className={clsx('ml-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 rounded-xl px-2 py-2 sm:flex-nowrap', matched.has(b.id) && 'bg-warning-soft ring-1 ring-warning/40')}>
                              <button onClick={() => setOpenStores((s) => toggle(s, b.id))} aria-expanded={storeOpen}
                                className="flex min-w-0 basis-full items-center gap-2.5 text-left sm:basis-auto sm:flex-1">
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Store size={15} /></span>
                                <div className="min-w-0 flex-1">
                                  <div className="line-clamp-2 text-sm font-medium sm:truncate">{b.name}{b.trade_name && <span className="font-normal text-primary"> · {b.trade_name}</span>}</div>
                                  <div className="truncate text-xs text-muted">
                                    {[b.address, b.city].filter(Boolean).join(', ') || '—'} · {t('spacesCount', { count: b.spaces_count })}
                                  </div>
                                </div>
                                {b.open_offers > 0 && <span className="hidden shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning sm:inline">{t('openOffers', { count: b.open_offers })}</span>}
                                {b.ongoing_status_name && <span className="hidden shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning sm:inline">{b.ongoing_status_name}</span>}
                                <span className="hidden sm:inline-flex"><StatusBadge status={b.status} /></span>
                                <ChevronDown size={16} className={clsx('shrink-0 text-muted transition-transform', storeOpen && 'rotate-180 text-primary')} />
                              </button>
                              <div className="flex w-full items-center gap-1 pl-[42px] sm:w-auto sm:pl-0">
                              <span className="mr-auto sm:hidden"><StatusBadge status={b.status} /></span>
                              <Link href={offerHref(c.id, c.name, b.id)} title={t('offerForStore')} aria-label={t('offerForStore')}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-primary-soft hover:text-primary"><FilePlus2 size={16} /></Link>
                              <button onClick={() => setDialog({ customerId: c.id, branch: b })} title={tc('editBranch')} aria-label={tc('editBranch')}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-primary-soft hover:text-primary"><Pencil size={15} /></button>
                              <button onClick={() => { if (confirm(tc('confirmDeleteBranch', { name: b.name }))) del.mutate(b.id); }}
                                title={tc('deleteBranch')} aria-label={tc('deleteBranch')}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"><Trash2 size={15} /></button>
                              </div>
                            </div>
                            {storeOpen && (
                              <div className="mb-2 ml-5 space-y-2 pb-1 sm:ml-14">
                                {/* Store data and its spaces are separate, labelled blocks */}
                                <div className="rounded-xl border border-border bg-surface p-2.5">
                                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Store size={12} /> {tc('storeData')}</div>
                                  <BranchDetails b={b} />
                                </div>
                                {b.spaces.length > 0 && (
                                  <div className="rounded-xl border border-primary/20 bg-primary-soft/40 p-2.5">
                                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary"><LayoutGrid size={12} /> {tc('spacesTitle', { count: b.spaces.length })}</div>
                                  <ul className="flex flex-wrap gap-1.5">
                                    {b.spaces.map((s) => (
                                      <li key={s.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs">
                                        <LayoutGrid size={12} className="text-primary" />
                                        <span className="font-medium">{s.name}</span>
                                        <span className="text-muted">{[s.kind, s.area_sqm && `${Number(s.area_sqm)} m²`].filter(Boolean).join(' · ')}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  </div>
                                )}
                              </div>
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
      {dialog && <BranchDialog customerId={dialog.customerId} branch={dialog.branch} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ============================== Stores (flat) ==============================
export type StoreFilters = { q: string; sort: string; extra: string };

type StoreRow = {
  id: string; name: string; trade_name: string | null; city: string | null; region: string | null; address: string | null; postal_code: string | null;
  status: string; spaces_count: number; customer_id: string; customer_name: string; customer_status: string; open_offers: number;
  geo_zone_name: string | null; tour_name: string | null; ongoing_status_name: string | null;
};

export function StoresView({ filters: f }: { filters: StoreFilters }) {
  const t = useTranslations('customers');
  const query = useInfiniteQuery({
    queryKey: ['branches', f],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '40', sort: f.sort });
      if (f.q.length >= 2) p.set('q', f.q);
      if (pageParam) p.set('cursor', pageParam);
      return api<Page<StoreRow>>(`/branches?${p}${f.extra ? `&${f.extra}` : ''}`, { signal });
    },
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const listRef = useRef<HTMLDivElement>(null);
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => 96, overscan: 8, scrollMargin: listRef.current?.offsetTop ?? 0 });
  const items = v.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= rows.length - 10 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [lastIndex, rows.length, query]);

  return (
    <div>
      {query.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[80px]" />)}</div>
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
                      <div className="truncate font-semibold">{b.name}{b.trade_name && <span className="font-normal text-primary"> · {b.trade_name}</span>}</div>
                      <div className="truncate text-sm text-muted">{b.customer_name}</div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs text-muted">
                        <MapPin size={12} className="shrink-0" />{[b.address, b.postal_code, b.city, b.region].filter(Boolean).join(', ') || '—'}
                      </div>
                    </div>
                  </Link>
                  <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">{t('spacesCount', { count: b.spaces_count })}</span>
                    {b.ongoing_status_name && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">{b.ongoing_status_name}</span>}
                    {b.tour_name && <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs text-info">{b.tour_name}</span>}
                    {b.geo_zone_name && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{b.geo_zone_name}</span>}
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
