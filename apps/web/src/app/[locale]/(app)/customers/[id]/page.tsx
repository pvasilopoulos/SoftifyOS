'use client';
import { use, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowLeft, CalendarDays, CheckCircle2, ChevronRight, FileText, Mail, MapPin, MoreHorizontal, Phone, PencilLine, Star, StickyNote,
} from 'lucide-react';
import { api, type Activity, type Page } from '@/lib/api';
import { money, relative } from '@/lib/format';
import { Link, useRouter } from '@/i18n/navigation';
import { Avatar, EntityTile, IconButton, Skeleton, StatusBadge, Tabs } from '@/components/ui';

type Detail = {
  customer: {
    id: string; name: string; code: string; kind: string; status: string; vat: string | null; category: string | null;
    parent_name: string | null; account_manager_name: string | null; annual_value: string; spaces_count: number;
  };
  branches: { id: string; name: string; city: string | null; status: string; spaces_count: number }[];
  stats: { open_offers: number; won_offers: number; pending_amount: string };
  activities: Activity[];
  contacts: { id: string; full_name: string; email: string | null; phone: string | null; role_title: string | null }[];
};

const activityIcon: Record<string, typeof FileText> = {
  offer_updated: FileText, meeting_done: CalendarDays, email_sent: Mail, approval: CheckCircle2, call: Phone, note: StickyNote,
};

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('customer');
  const tc = useTranslations('customers');
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<'overview' | 'branches' | 'activity' | 'contacts'>('overview');
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: () => api<Detail>(`/customers/${id}`) });
  const c = data?.customer;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-1">
        <IconButton label="back" onClick={() => router.back()}><ArrowLeft size={22} /></IconButton>
        <span className="flex-1 text-lg font-semibold">{t('back')}</span>
        <IconButton label="favourite"><Star size={20} /></IconButton>
        <IconButton label="more"><MoreHorizontal size={20} /></IconButton>
      </header>

      <section className="card flex items-center gap-4 p-4">
        {c ? <EntityTile name={c.name} size={72} /> : <Skeleton className="h-[72px] w-[72px]" />}
        <div className="min-w-0 flex-1">
          {c ? <>
            <h1 className="truncate text-xl font-bold">{c.name}</h1>
            <div className="text-sm text-muted">{c.kind === 'group' ? tc('group') : tc('company')}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} />
              <span className="text-sm text-muted">{c.code}</span>
            </div>
          </> : <Skeleton className="h-14 w-48" />}
        </div>
      </section>

      <div className="grid grid-cols-4 gap-2">
        {[{ icon: Phone, l: t('call') }, { icon: Mail, l: t('email') }, { icon: CalendarDays, l: t('meeting') }, { icon: CheckCircle2, l: t('task') }].map(({ icon: Icon, l }) => (
          <button key={l} className="card flex flex-col items-center gap-1.5 py-3 text-xs font-medium">
            <Icon size={20} className="text-primary" /> {l}
          </button>
        ))}
      </div>

      <Tabs value={tab} onChange={setTab} options={[
        { value: 'overview', label: t('overview') }, { value: 'branches', label: t('branches') },
        { value: 'activity', label: t('activity') }, { value: 'contacts', label: t('contacts') },
      ]} />

      {isLoading || !data ? <Skeleton className="h-48" /> : tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">{t('basics')}</h2>
              <PencilLine size={18} className="text-primary" />
            </div>
            <dl className="divide-y divide-border text-sm">
              {[
                [t('group'), data.customer.parent_name ?? data.customer.name],
                [t('vat'), data.customer.vat ?? '—'],
                [t('category'), data.customer.category ? <span className="rounded-md bg-warning-soft px-2 py-0.5 text-warning">{data.customer.category}</span> : '—'],
                [t('manager'), data.customer.account_manager_name ? <span className="flex items-center gap-2"><Avatar name={data.customer.account_manager_name} size={22} />{data.customer.account_manager_name}</span> : '—'],
              ].map(([k, v], i) => (
                <div key={i} className="flex items-center justify-between py-2.5"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>
              ))}
            </dl>
          </section>
          <section className="card p-4">
            <h2 className="mb-2 font-semibold">{t('commercial')}</h2>
            <div className="tabular text-3xl font-bold">{money(data.customer.annual_value, locale, 0)}</div>
            <div className="text-sm text-muted">{t('totalValue')}</div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Stat value={String(data.stats.open_offers)} label={t('openOffers')} />
              <Stat value={String(data.stats.won_offers)} label={t('wonOffers')} />
              <Stat value={money(data.stats.pending_amount, locale, 0)} label={t('pendingAmount')} />
            </div>
          </section>
        </div>
      ) : tab === 'branches' ? (
        data.branches.length ? (
          <ul className="space-y-3">
            {data.branches.map((b) => (
              <li key={b.id} className="card flex items-center gap-3 p-3.5">
                <EntityTile name={b.name} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{b.name}</div>
                  {b.city && <div className="flex items-center gap-1 text-sm text-muted"><MapPin size={14} />{b.city}</div>}
                  <div className="mt-1 flex gap-2"><span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">{t('spaces', { count: b.spaces_count })}</span><StatusBadge status={b.status} /></div>
                </div>
                <ChevronRight size={18} className="text-muted" />
              </li>
            ))}
          </ul>
        ) : <p className="py-10 text-center text-muted">{t('noBranches')}</p>
      ) : tab === 'activity' ? (
        <ActivityTimeline customerId={id} />
      ) : (
        <ul className="card divide-y divide-border">
          {data.contacts.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3.5">
              <Avatar name={p.full_name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.full_name}</div>
                <div className="truncate text-sm text-muted">{[p.role_title, p.email].filter(Boolean).join(' · ')}</div>
              </div>
              {p.phone && <a href={`tel:${p.phone}`} className="text-primary"><Phone size={18} /></a>}
            </li>
          ))}
        </ul>
      )}
      <div className="h-2" />
      <Link href="/customers" className="sr-only">back</Link>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="tabular truncate text-lg font-bold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function ActivityTimeline({ customerId }: { customerId: string }) {
  const ta = useTranslations('activity');
  const tcm = useTranslations('common');
  const locale = useLocale();
  const q = useInfiniteQuery({
    queryKey: ['activities', customerId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<Activity>>(`/customers/${customerId}/activities?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="card p-4">
      <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-px before:bg-border">
        {rows.map((a) => {
          const Icon = activityIcon[a.kind] ?? StickyNote;
          return (
            <li key={a.id} className="relative flex gap-3">
              <span className={`z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full ${a.kind === 'approval' ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary'}`}><Icon size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{a.title}</span>
                  <span className="shrink-0 text-xs text-muted">{relative(a.occurred_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}</span>
                </div>
                {a.body && <div className="text-sm text-muted">{a.body}</div>}
                {a.actor_name && <div className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Avatar name={a.actor_name} size={18} />{a.actor_name}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mt-4 w-full rounded-xl bg-primary-soft py-2.5 text-sm font-semibold text-primary">
          {q.isFetchingNextPage ? tcm('loading') : tcm('loadMore')}
        </button>
      )}
    </div>
  );
}
