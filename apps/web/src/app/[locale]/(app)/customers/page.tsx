'use client';
import { useTabTitle } from '@/components/tabs';
import { CustomerAvatar } from '@/components/customer-avatar';
import { Suspense, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useTranslations } from 'next-intl';
import { ListTree, Loader2, Plus, Search, Store, Users, X } from 'lucide-react';
import { api, type Customer, type Page } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { EntityTile, PageHeader, Skeleton } from '@/components/ui';
import { ActiveFilterChips, CustomerTreeView, ExpandToggle, SortMenu, StoresView, type ExpandMode } from '@/components/customer-views';
import { IndexFilterMenu, useFilterChips, useIndexFilters } from '@/components/index-filters';
import { useMe } from '@/components/app-shell';
import { tabStore } from '@/lib/tab-store';
import { decodeConfig, ManageViewsDialog, sameConfig, SavedViewsBar, SaveViewButton, useSavedViews, type SavedView, type ViewConfig } from '@/components/saved-views';
import { useRouter, usePathname } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { CustomerRowParts } from '@/components/display-views';
import { DisplayCustomizeButton } from '@/components/display';

type View = 'list' | 'tree' | 'stores';
type Row = Customer & { trade_name: string | null; tags: string[]; address_city: string | null; archived_at: string | null };

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

// Filters survive navigation (back from a customer card keeps your view)
function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => { try { const s = tabStore.getItem(key); if (s) setV(JSON.parse(s)); } catch {} }, [key]);
  return [v, (x: T) => { setV(x); try { tabStore.setItem(key, JSON.stringify(x)); } catch {} }];
}

function CustomersPageInner() {
  const t = useTranslations('customers');
  const ts = useTranslations('status');
  const tl = useTranslations('lookup');
  // Opens with the default view from Settings → Indexes (user → role → organisation);
  // a view picked here is kept for this browser session.
  const [view, setViewState] = useState<View | null>(null);
  const { data: me } = useMe();
  const defaultView = (me?.tenant?.customers_view ?? null) as View | null;
  useEffect(() => {
    if (view) return;
    let saved: View | null = null;
    try { saved = JSON.parse(tabStore.getItem('cust.view') ?? 'null'); } catch {}
    if (saved) setViewState(saved);
    else if (defaultView) setViewState(defaultView);
  }, [view, defaultView]);
  const setView = (v: View) => { setViewState(v); try { tabStore.setItem('cust.view', JSON.stringify(v)); } catch {} };
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [expand, setExpand] = useState<ExpandMode>('none');

  // Filters (which ones are visible: Settings → Indexes). Customers list + tree share one set, stores have their own.
  const custFilters = useIndexFilters('customers');
  const treeFilters = useIndexFilters('tree');
  const storeFilters = useIndexFilters('stores');
  const [sort, setSort] = usePersisted('cust.sort', 'name');
  const [sSort, setSSort] = usePersisted('store.sort', 'name');
  const isStores = view === 'stores';
  const filters = isStores ? storeFilters : view === 'tree' ? treeFilters : custFilters;
  const custChips = useFilterChips(custFilters);
  const treeChips = useFilterChips(treeFilters);
  const storeChips = useFilterChips(storeFilters);

  // ---- Saved views: the active view, what it would look like now, and whether it changed ----
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const views = useSavedViews();
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const setActiveId = (id: string | null) => {
    setActiveIdState(id);
    try { if (id) tabStore.setItem('cust.activeView', id); else tabStore.removeItem('cust.activeView'); } catch {}
  };
  const filtersFor = (v: View) => (v === 'stores' ? storeFilters : v === 'tree' ? treeFilters : custFilters);
  const current: ViewConfig | null = view ? {
    view, filters: filtersFor(view).values, sort: view === 'stores' ? sSort : sort, q: q.trim(), expand,
  } : null;
  const active = views.data?.views.find((x) => x.id === activeId) ?? null;
  const dirty = !!active && !!current && !sameConfig(current, active.config);
  useTabTitle(active ? `${t('title')} · ${active.name}` : view ? `${t('title')} · ${t(view === 'list' ? 'viewList' : view === 'tree' ? 'viewTree' : 'viewStores')}` : null);
  const applyConfig = (c: ViewConfig) => {
    setView(c.view);
    filtersFor(c.view).replace(c.filters ?? {});
    if (c.view === 'stores') setSSort(c.sort || 'name'); else setSort(c.sort || 'name');
    setQ(c.q ?? '');
    setExpand(c.expand ?? 'none');
  };
  const applyView = (sv: SavedView) => {
    applyConfig(sv.config);
    setActiveId(sv.id);
    if (params.get('v') || params.get('cfg')) router.replace(pathname, { scroll: false });
  };
  // Opening the page: a shared link (?v= / ?cfg=) wins, then this session's view, then the default view
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current || !views.data) return;
    booted.current = true;
    const link = params.get('v');
    const linked = link ? views.data.views.find((x) => x.id === link) : null;
    const cfg = decodeConfig(params.get('cfg'));
    let sessionId: string | null = null;
    try { sessionId = tabStore.getItem('cust.activeView'); } catch {}
    if (linked) { applyView(linked); return; }
    if (cfg) { applyConfig(cfg); setActiveId(null); return; }
    if (sessionId && views.data.views.some((x) => x.id === sessionId)) { setActiveIdState(sessionId); return; }
    let touched = false;
    try { touched = !!tabStore.getItem('cust.view'); } catch {}
    const def = views.data.views.find((x) => x.id === views.data!.default_view);
    if (def && !touched) applyView(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.data]);
  const exportHref = view === 'stores'
    ? `/api/branches/export.csv?${new URLSearchParams(q.trim() ? { q: q.trim() } : {})}${storeFilters.query ? `&${storeFilters.query}` : ''}`
    : `/api/customers/export.csv?${new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), tree: view === 'tree' ? '1' : '0' })}${(view === 'tree' ? treeFilters : custFilters).query ? `&${(view === 'tree' ? treeFilters : custFilters).query}` : ''}`;

  const query = useInfiniteQuery({
    enabled: view === 'list',
    queryKey: ['customers', sort, custFilters.query, dq],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '40', sort });
      if (dq.length >= 2) p.set('q', dq);
      if (pageParam) p.set('cursor', pageParam);
      return api<Page<Row>>(`/customers?${p}${custFilters.query ? `&${custFilters.query}` : ''}`, { signal });
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

  // ---- Toolbar configuration per view ----
  const chips = isStores ? storeChips : view === 'tree' ? treeChips : custChips;
  const sortOptions = isStores
    ? [{ value: 'name', label: t('sortName') }, { value: 'city', label: t('sortCity') }, { value: 'spaces', label: t('sortSpaces') }]
    : [{ value: 'name', label: t('sortName') }, { value: 'recent', label: t('sortRecent') }, { value: 'value', label: t('sortValue') }];

  return (
    <div>
      <PageHeader title={t('title')} actions={
        <Link href="/customers/new" className="hidden items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white lg:flex">
          <Plus size={18} /> {t('new')}
        </Link>
      } />

      {/* View switcher */}
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl border border-border bg-surface-2 p-1">
        {([
          { value: 'list', icon: Users, label: t('viewList') },
          { value: 'tree', icon: ListTree, label: t('viewTree') },
          { value: 'stores', icon: Store, label: t('viewStores') },
        ] as const).map(({ value, icon: Icon, label }) => (
          // Phone: icon above the full name (2 lines), active one filled with the brand colour
          <button key={value} onClick={() => setView(value)} aria-pressed={view === value}
            className={clsx('flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[12px] font-semibold leading-tight transition sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm sm:font-medium',
              view === value ? 'bg-primary text-white shadow-md shadow-primary/25' : 'text-muted hover:bg-surface hover:text-text')}>
            <Icon size={18} className="shrink-0 sm:size-4" /> <span className="line-clamp-2 text-center sm:truncate">{label}</span>
          </button>
        ))}
      </div>

      <SavedViewsBar activeId={activeId} dirty={dirty} onApply={applyView} onManage={() => setManage(true)} />

      {/* Toolbar: search + filters + sort (+ expand on the tree) */}
      {/* Phone: search on its own row, the filter / sort / expand buttons below it */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <div className="flex h-11 min-w-0 basis-full items-center gap-2 rounded-xl border border-border bg-surface px-3.5 sm:basis-auto sm:flex-1">
          <Search size={18} className="shrink-0 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isStores ? t('searchStores') : t('search')} className="w-full min-w-0 bg-transparent outline-none" />
          {q && <button onClick={() => setQ('')} aria-label="clear"><X size={18} className="text-muted" /></button>}
          {query.isFetching && !query.isFetchingNextPage && <Loader2 size={16} className="animate-spin text-muted" />}
        </div>
        <IndexFilterMenu state={filters} />
        <SortMenu value={isStores ? sSort : sort} options={sortOptions} onChange={isStores ? setSSort : setSort} />
        {view === 'tree' && <ExpandToggle mode={expand} onChange={setExpand} />}
        {current && (
          <SaveViewButton active={active} dirty={dirty} current={current} exportHref={exportHref}
            onSaved={(id) => setActiveId(id)} onRevert={() => active && applyConfig(active.config)} onManage={() => setManage(true)} />
        )}
        <DisplayCustomizeButton surface={isStores ? 'disp_store_row' : 'disp_customer_row'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:text-text" />
      </div>
      {manage && <ManageViewsDialog onClose={() => setManage(false)} onApply={applyView} />}
      <ActiveFilterChips chips={chips} />

      {view === 'tree' ? <CustomerTreeView filters={{ sort, q: dq, extra: treeFilters.query }} mode={expand} />
      : isStores ? <StoresView filters={{ q: dq, sort: sSort, extra: storeFilters.query }} />
      : !view || query.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[84px]" />)}</div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-muted">{t('empty')}</p>
      ) : (
        <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((it) => {
            const c = rows[it.index];
            return (
              <div key={c.id} data-index={it.index} ref={v.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start - v.options.scrollMargin}px)` }} className="pb-3">
                <Link href={`/customers/${c.id}`} className={clsx('card flex items-center gap-3.5 p-3.5 transition hover:border-primary/40', c.archived_at && 'opacity-60')}>
                  <CustomerRowParts c={c as unknown as Record<string, unknown>}>{(p) => (<>
                  <CustomerAvatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="min-w-0 text-sm text-muted">{p.line}</div>
                    <div className="mt-1 min-w-0 overflow-hidden empty:hidden">{p.badges}</div>
                  </div>
                  <div className="hidden text-right sm:block">{p.side}</div>
                  </>)}</CustomerRowParts>
                </Link>
              </div>
            );
          })}
        </div>
      )}
      {view === 'list' && query.isFetchingNextPage && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted" /></div>}

      <Link href="/customers/new" aria-label={t('new')}
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-primary text-white shadow-xl shadow-primary/40 lg:hidden">
        <Plus size={26} />
      </Link>
    </div>
  );
}

// useSearchParams (shared view links) needs a Suspense boundary
export default function CustomersPage() {
  return <Suspense><CustomersPageInner /></Suspense>;
}
