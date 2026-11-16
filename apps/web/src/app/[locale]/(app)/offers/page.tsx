'use client';
import { CustomerAvatar } from '@/components/customer-avatar';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { api, type Offer, type Page } from '@/lib/api';
import { money } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { EntityTile, PageHeader, Segmented, Skeleton, StatusBadge } from '@/components/ui';

type Filter = 'all' | 'in_progress' | 'pending_approval' | 'approved';

export default function OffersPage() {
  const t = useTranslations('offers');
  const ts = useTranslations('status');
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>('all');

  const query = useInfiniteQuery({
    queryKey: ['offers', filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '40' });
      if (filter !== 'all') p.set('status', filter);
      if (pageParam) p.set('cursor', pageParam);
      return api<Page<Offer>>(`/offers?${p}`, { signal });
    },
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const listRef = useRef<HTMLDivElement>(null);
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => 108, overscan: 8, scrollMargin: listRef.current?.offsetTop ?? 0 });
  const items = v.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= rows.length - 10 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [lastIndex, rows.length, query]);

  return (
    <div>
      <PageHeader title={t('title')} actions={
        <Link href="/offers/new" className="hidden items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white lg:flex"><Plus size={18} /> {t('new')}</Link>
      } />
      <Link href="/offers/new" aria-label={t('new')}
        className="fixed bottom-24 right-5 z-30 flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 font-semibold text-white shadow-xl shadow-primary/40 lg:hidden">
        <Plus size={20} /> {t('new')}
      </Link>
      <div className="mb-4">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: t('all') }, { value: 'in_progress', label: t('inProgress') },
          { value: 'pending_approval', label: ts('pending_approval') }, { value: 'approved', label: t('approved') },
        ]} />
      </div>

      {query.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : rows.length === 0 ? <p className="py-16 text-center text-muted">{t('empty')}</p> : (
        <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((it) => {
            const o = rows[it.index];
            return (
              <div key={o.id} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start - v.options.scrollMargin}px)` }} className="pb-3">
                <Link href={`/offers/${o.id}`} className="card flex items-center gap-3.5 p-3.5 transition hover:border-primary/40">
                  <CustomerAvatar name={o.customer_name} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{o.number} <span className="font-normal text-muted">v.{String(o.current_version).padStart(2, '0')}</span></div>
                    <div className="truncate text-sm text-muted">{o.customer_name}{o.branch_name && ` • ${o.branch_name}`}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="tabular text-lg font-bold">{money(o.total_amount, locale)}</span>
                      <StatusBadge status={o.status} />
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
      {query.isFetchingNextPage && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted" /></div>}
    </div>
  );
}
