'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLocale, useTranslations } from 'next-intl';
import { Archive, ArrowDownAZ, Clock, Euro, ListTree, Loader2, MapPin, Plus, Search, Store, UserRound, Users, X } from 'lucide-react';
import { api, type Customer, type Page } from '@/lib/api';
import { money } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { EntityTile, PageHeader, Segmented, Skeleton, StatusBadge } from '@/components/ui';
import { CustomerTreeView, StoresView } from '@/components/customer-views';

type View = 'list' | 'tree' | 'stores';

type Status = 'all' | 'active' | 'prospect' | 'negotiation' | 'inactive';
type Sort = 'name' | 'recent' | 'value';
type Row = Customer & { trade_name: string | null; tags: string[]; address_city: string | null; archived_at: string | null };

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

// Filters survive navigation (back from a customer card keeps your view)
function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => { try { const s = sessionStorage.getItem(key); if (s) setV(JSON.parse(s)); } catch {} }, [key]);
  return [v, (x: T) => { setV(x); try { sessionStorage.setItem(key, JSON.stringify(x)); } catch {} }];
}

export default function CustomersPage() {
  const t = useTranslations('customers');
  const locale = useLocale();
  const [status, setStatus] = usePersisted<Status>('cust.status', 'all');
  const [sort, setSort] = usePersisted<Sort>('cust.sort', 'name');
  const [mine, setMine] = usePersisted('cust.mine', false);
  const [archived, setArchived] = usePersisted('cust.archived', false);
  const [view, setView] = usePersisted<View>('cust.view', 'list');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());

  const query = useInfiniteQuery({
    enabled: view === 'list',
    queryKey: ['customers', status, sort, mine, archived, dq],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '40', sort });
      if (status !== 'all') p.set('status', status);
      if (mine) p.set('manager', 'me');
      if (archived) p.set('archived', '1');
      if (dq.length >= 2) p.set('q', dq);
      if (pageParam) p.set('cursor', pageParam);
      return api<Page<Row>>(`/customers?${p}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  // Window virtualisation: only visible rows are in the DOM, so huge lists stay smooth
  const listRef = useRef<HTMLDivElement>(null);
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => 96, overscan: 8, scrollMargin: listRef.current?.offsetTop ?? 0 });
  const items = v.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= rows.length - 10 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [lastIndex, rows.length, query]);

  const chip = (active: boolean) => clsx('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition',
    active ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted');

  return (
    <div>
      <PageHeader title={t('title')} actions={
        <Link href="/customers/new" className="hidden items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white lg:flex">
          <Plus size={18} /> {t('new')}
        </Link>
      } />

      {/* View switcher */}
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1">
        {([
          { value: 'list', icon: Users, label: t('viewList') },
          { value: 'tree', icon: ListTree, label: t('viewTree') },
          { value: 'stores', icon: Store, label: t('viewStores') },
        ] as const).map(({ value, icon: Icon, label }) => (
          <button key={value} onClick={() => setView(value)} aria-pressed={view === value}
            className={clsx('flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm font-medium transition',
              view === value ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
            <Icon size={16} className="shrink-0" /> <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5">
        <Search size={18} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === 'stores' ? t('searchStores') : t('search')} className="w-full bg-transparent py-3 outline-none" />
        {q && <button onClick={() => setQ('')} aria-label="clear"><X size={18} className="text-muted" /></button>}
        {query.isFetching && !query.isFetchingNextPage && <Loader2 size={16} className="animate-spin text-muted" />}
      </div>

      {view !== 'stores' && (
        <>
          <div className="mb-3">
            <Segmented value={status} onChange={setStatus} options={[
              { value: 'all', label: t('all') }, { value: 'active', label: t('active') }, { value: 'prospect', label: t('prospects') },
              { value: 'negotiation', label: t('negotiation') }, { value: 'inactive', label: t('inactive') },
            ]} />
          </div>
          <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
            <button onClick={() => setSort('name')} className={chip(sort === 'name')}><ArrowDownAZ size={15} /> {t('sortName')}</button>
            <button onClick={() => setSort('recent')} className={chip(sort === 'recent')}><Clock size={15} /> {t('sortRecent')}</button>
            <button onClick={() => setSort('value')} className={chip(sort === 'value')}><Euro size={15} /> {t('sortValue')}</button>
            <span className="mx-1 w-px shrink-0 bg-border" />
            <button onClick={() => setMine(!mine)} className={chip(mine)}><UserRound size={15} /> {t('mine')}</button>
            <button onClick={() => setArchived(!archived)} className={chip(archived)}><Archive size={15} /> {t('archivedList')}</button>
          </div>
        </>
      )}

      {view === 'tree' ? <CustomerTreeView filters={{ status, sort, mine, archived, q: dq }} />
      : view === 'stores' ? <StoresView q={dq} mine={mine} />
      : query.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[84px]" />)}</div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-muted">{t('empty')}</p>
      ) : (
        <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((it) => {
            const c = rows[it.index];
            return (
              <div key={c.id} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start - v.options.scrollMargin}px)` }} className="pb-3">
                <Link href={`/customers/${c.id}`} className={clsx('card flex items-center gap-3.5 p-3.5 transition hover:border-primary/40', c.archived_at && 'opacity-60')}>
                  <EntityTile name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="flex min-w-0 items-center gap-1 truncate text-sm text-muted">
                      {c.kind === 'group' ? `${t('group')} · ${t('companies', { count: c.companies_count })}` : (c.trade_name || c.code)}
                      {c.address_city && <><span>·</span><MapPin size={13} className="shrink-0" />{c.address_city}</>}
                    </div>
                    <div className="mt-1 flex min-w-0 gap-1.5 overflow-hidden">
                      <StatusBadge status={c.status} />
                      {c.tags?.slice(0, 2).map((tag) => <span key={tag} className="truncate rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary">#{tag}</span>)}
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="text-xs text-muted">{t('annualValue')}</div>
                    <div className="tabular font-semibold">{money(c.annual_value, locale, 0)}</div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
      {query.isFetchingNextPage && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted" /></div>}

      <Link href="/customers/new" aria-label={t('new')}
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-primary text-white shadow-xl shadow-primary/40 lg:hidden">
        <Plus size={26} />
      </Link>
    </div>
  );
}
