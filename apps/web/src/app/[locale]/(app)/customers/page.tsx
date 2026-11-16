'use client';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { api, type Customer, type Page } from '@/lib/api';
import { money } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { EntityTile, PageHeader, Segmented, Skeleton, StatusBadge } from '@/components/ui';

type Filter = 'all' | 'active' | 'prospect';

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

export default function CustomersPage() {
  const t = useTranslations('customers');
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q.trim());

  const query = useInfiniteQuery({
    queryKey: ['customers', filter, dq],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '40' });
      if (filter !== 'all') p.set('status', filter);
      if (dq.length >= 2) p.set('q', dq);
      if (pageParam) p.set('cursor', pageParam);
      return api<Page<Customer>>(`/customers?${p}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  // Window virtualisation: only visible rows are in the DOM, so 100k+ loaded rows still scroll smoothly
  const listRef = useRef<HTMLDivElement>(null);
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => 92, overscan: 8, scrollMargin: listRef.current?.offsetTop ?? 0 });
  const items = v.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= rows.length - 10 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [lastIndex, rows.length, query]);

  return (
    <div>
      <PageHeader title={t('title')} actions={
        <button onClick={() => setCreating(true)} className="hidden items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white lg:flex">
          <Plus size={18} /> {t('new')}
        </button>
      } />

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5">
        <Search size={18} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-full bg-transparent py-3 outline-none" />
        {q && <button onClick={() => setQ('')} aria-label="clear"><X size={18} className="text-muted" /></button>}
        {query.isFetching && !query.isFetchingNextPage && <Loader2 size={16} className="animate-spin text-muted" />}
      </div>

      <div className="mb-4">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: t('all') }, { value: 'active', label: t('active') }, { value: 'prospect', label: t('prospects') },
        ]} />
      </div>

      {query.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[80px]" />)}</div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-muted">{t('empty')}</p>
      ) : (
        <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((it) => {
            const c = rows[it.index];
            return (
              <div key={c.id} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start - v.options.scrollMargin}px)` }} className="pb-3">
                <Link href={`/customers/${c.id}`} className="card flex items-center gap-3.5 p-3.5 transition hover:border-primary/40">
                  <EntityTile name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="truncate text-sm text-muted">
                      {c.kind === 'group' ? `${t('group')} · ${t('companies', { count: c.companies_count })}` : c.code}
                    </div>
                    <div className="mt-1"><StatusBadge status={c.status} /></div>
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

      <button onClick={() => setCreating(true)} aria-label={t('new')}
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-primary text-white shadow-xl shadow-primary/40 lg:hidden">
        <Plus size={26} />
      </button>
      {creating && <NewCustomer onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCustomer({ onClose }: { onClose: () => void }) {
  const t = useTranslations('customers');
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [vat, setVat] = useState('');
  const [kind, setKind] = useState<'company' | 'group'>('company');
  const m = useMutation({
    mutationFn: () => api('/customers', { method: 'POST', json: { name, vat: vat || undefined, kind } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); onClose(); },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}
        className="w-full max-w-md rounded-t-3xl bg-surface p-6 safe-bottom sm:rounded-3xl">
        <h2 className="mb-4 text-lg font-bold">{t('new')}</h2>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'company', label: t('company') }, { value: 'group', label: t('group') }]} />
        <input autoFocus required minLength={2} placeholder={t('name')} value={name} onChange={(e) => setName(e.target.value)}
          className="mt-4 w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 outline-none focus:border-primary" />
        <input placeholder={t('vat')} value={vat} onChange={(e) => setVat(e.target.value)}
          className="mt-3 w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 outline-none focus:border-primary" />
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-border py-3 font-medium">{t('cancel')}</button>
          <button disabled={m.isPending} className="flex-1 rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-60">{t('create')}</button>
        </div>
      </form>
    </div>
  );
}
