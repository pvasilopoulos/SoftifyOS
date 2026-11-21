'use client';
// Customers at risk: score and reasons computed by the server every few hours (no AI). Open one for the AI next step.
import { useState } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ChevronRight, Loader2, MapPin, RefreshCw, ShieldAlert, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { Link, useRouter } from '@/i18n/navigation';
import { IconButton, PageHeader, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { useTabTitle } from '@/components/tabs';
import { levelTone, RiskPill, useReasonText, type RiskLevel, type RiskReason } from '@/components/customer-insights';

type Item = {
  id: string; name: string; code: string; city: string | null; annual_value: string; account_manager: string | null;
  score: number; level: RiskLevel; reasons: RiskReason[]; last_contact: string | null;
};
type Resp = { items: Item[]; has_more: boolean; counts: Record<RiskLevel, number>; computed_at: string | null; can_refresh: boolean };
const PAGE = 50;

export default function AtRiskPage() {
  const t = useTranslations('insights');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const reason = useReasonText();
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  useTabTitle(t('pageTitle'));
  const [level, setLevel] = useState<'' | RiskLevel>('');
  const [mine, setMine] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ['at-risk', level, mine],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<Resp>(`/customers/at-risk?${new URLSearchParams({ level, mine: mine ? '1' : '0', limit: String(PAGE), offset: String(pageParam) })}`),
    getNextPageParam: (last, all) => (last.has_more ? all.length * PAGE : undefined),
  });
  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = first ? first.counts.high + first.counts.medium + first.counts.low : 0;
  const rel = (iso: string | null) => {
    if (!iso) return t('never');
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
    return days <= 0 ? t('today') : t('daysAgo', { n: days });
  };
  const refresh = async () => {
    await api('/customers/at-risk/refresh', { method: 'POST' });
    toast({ title: t('refreshQueued') });
    setTimeout(() => qc.invalidateQueries({ queryKey: ['at-risk'] }), 8000);
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('pageTitle')}
        back={<IconButton label="back" onClick={() => router.push('/customers')}><ArrowLeft size={22} /></IconButton>}
        actions={first?.can_refresh && (
          <button type="button" onClick={refresh} title={t('refresh')} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-primary">
            <RefreshCw size={15} /> <span className="hidden sm:inline">{t('refresh')}</span>
          </button>
        )} />

      <p className="-mt-2 text-sm text-muted">
        {t('pageHint')}{first?.computed_at && ` ${t('computed', { when: new Date(first.computed_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })}`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-full gap-0.5 rounded-xl bg-surface-2 p-1 text-[13px] sm:w-auto sm:text-sm">
          {(['', 'high', 'medium', 'low'] as const).map((l) => (
            <button key={l || 'all'} type="button" onClick={() => setLevel(l)} aria-pressed={level === l}
              className={clsx('flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-1 py-1.5 sm:flex-none sm:flex-row sm:gap-1.5 sm:px-2.5 font-medium transition sm:flex-none',
                level === l ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
              {l ? t(`level_${l}`) : t('all')}
              <span className={clsx('rounded-full px-1.5 text-[11px] tabular', l ? levelTone[l] : 'bg-surface text-muted')}>{first ? compact.format(l ? first.counts[l] : total) : '·'}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm">
          <input type="checkbox" className="accent-[var(--primary)]" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t('mine')}
        </label>
      </div>

      {list.isLoading && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {!list.isLoading && !rows.length && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <ShieldAlert size={28} className="text-success" />
          <p className="font-semibold">{t('emptyTitle')}</p>
          <p className="text-sm text-muted">{first?.computed_at ? t('emptyHint') : t('notComputed')}</p>
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.id}>
            <Link href={`/customers/${c.id}`} className="card flex items-start gap-3 p-3.5 transition hover:border-primary/40">
              <span className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-base font-bold tabular', levelTone[c.level])}>{c.score}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold [overflow-wrap:anywhere]">{c.name}</span>
                  <RiskPill level={c.level} />
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span className="font-mono">{c.code}</span>
                  {c.city && <span className="flex items-center gap-1"><MapPin size={11} /> {c.city}</span>}
                  {c.account_manager && <span className="flex items-center gap-1"><UserRound size={11} /> {c.account_manager}</span>}
                  <span>{t('lastContact')}: {rel(c.last_contact)}</span>
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.reasons.map((r, i) => <span key={i} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs">{reason(r)}</span>)}
                </span>
              </span>
              <ChevronRight size={18} className="mt-3 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="card w-full py-2.5 text-sm font-medium text-primary">
          {list.isFetchingNextPage ? <Loader2 size={15} className="mx-auto animate-spin" /> : t('more')}
        </button>
      )}
    </div>
  );
}
