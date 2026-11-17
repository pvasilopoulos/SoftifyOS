'use client';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Building2, CheckCircle2, ChevronDown, ChevronRight, Clock, TrendingUp } from 'lucide-react';
import { api, type Activity, type CalEvent } from '@/lib/api';
import { compactMoney, relative, time } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { useMe } from '@/components/app-shell';
import { SectionTitle, Skeleton } from '@/components/ui';
import { DashboardWidgets } from '@/components/reports-ui';

type Dashboard = {
  stats: { status: string; count: string; amount: string }[];
  counters: { key: string; value: string }[];
  upcoming: CalEvent[];
  recent: Activity[];
};

export default function HomePage() {
  const t = useTranslations('home');
  const tp = useTranslations('pipeline');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });

  const s = (keys: string[]) => (data?.stats ?? []).filter((x) => keys.includes(x.status))
    .reduce((a, x) => ({ count: a.count + Number(x.count), amount: a.amount + Number(x.amount) }), { count: 0, amount: 0 });
  const open = s(['draft', 'in_progress', 'pending_approval', 'sent']);
  const pending = s(['pending_approval']);
  const closed = s(['accepted']);
  const all = s(['draft', 'in_progress', 'pending_approval', 'approved', 'sent', 'accepted']);
  const customers = Number(data?.counters.find((c) => c.key === 'customers')?.value ?? 0);
  const hour = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Athens' }).format(new Date()));
  const first = me?.user.full_name.split(' ')[0] ?? '';

  const pipeline = [
    { label: tp('initial'), v: s(['draft']), color: '#a99bff' },
    { label: tp('negotiation'), v: s(['in_progress', 'sent']), color: '#8a73ff' },
    { label: tp('approval'), v: s(['pending_approval']), color: '#6a4ff7' },
    { label: tp('closed'), v: s(['accepted']), color: '#16a34a' },
  ];
  const maxP = Math.max(1, ...pipeline.map((p) => p.v.count));

  const kpis = [
    { label: t('commercialValue'), value: compactMoney(all.amount, locale), sub: `${customers.toLocaleString(locale)} ${t('customers').toLowerCase()}`, icon: TrendingUp, tone: 'text-success' },
    { label: t('openOffers'), value: compactMoney(open.amount, locale), sub: t('offersCount', { count: open.count }), icon: ArrowUpRight, tone: 'text-primary' },
    { label: t('pending'), value: compactMoney(pending.amount, locale), sub: t('offersCount', { count: pending.count }), icon: Clock, tone: 'text-warning' },
    { label: t('closed'), value: compactMoney(closed.amount, locale), sub: t('offersCount', { count: closed.count }), icon: CheckCircle2, tone: 'text-success' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{hour < 13 ? t('greeting', { name: first }) : t('greetingAfternoon', { name: first })} 👋</h1>
        <p className="text-muted">{t('subtitle')}</p>
      </div>

      <button className="card flex w-full items-center gap-3 px-4 py-3 text-left lg:max-w-md">
        <Building2 size={20} className="text-muted" />
        <span className="flex-1 font-medium">{t('allCompanies')}</span>
        <ChevronDown size={18} className="text-muted" />
      </button>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm text-muted">{k.label}</span>
              <k.icon size={18} className={k.tone} />
            </div>
            {isLoading ? <Skeleton className="mt-2 h-7 w-28" /> : <div className="tabular mt-1 text-xl font-bold lg:text-2xl">{k.value}</div>}
            <div className="mt-1 text-xs text-muted">{k.sub}</div>
          </div>
        ))}
      </div>

      <DashboardWidgets />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-4">
          <SectionTitle>{t('pipeline')}</SectionTitle>
          <div className="space-y-3">
            {pipeline.map((p) => (
              <div key={p.label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.label}</span>
                  <span className="tabular text-muted">{p.v.count.toLocaleString(locale)} · {compactMoney(p.v.amount, locale)}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(p.v.count / maxP) * 100}%`, background: p.color }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <SectionTitle action={<Link href="/calendar" className="flex items-center text-sm font-medium text-primary">{t('all')} <ChevronRight size={16} /></Link>}>
            {t('upcoming')}
          </SectionTitle>
          {isLoading ? <Skeleton className="h-16" /> : data?.upcoming.length ? (
            <ul className="space-y-2">
              {data.upcoming.map((e) => (
                <li key={e.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <span className="tabular rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm font-semibold">{time(e.starts_at, locale)}</span>
                  <span className="h-8 w-1 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{e.title}</div>
                    <div className="truncate text-sm text-muted">{e.location ?? e.customer_name}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">{t('noEvents')}</p>}
        </section>
      </div>

      <section className="card p-4">
        <SectionTitle>{t('recent')}</SectionTitle>
        <ul className="divide-y divide-border">
          {(data?.recent ?? []).map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium">{a.title}</div>
                <div className="truncate text-sm text-muted">{a.body} {a.actor_name && `· ${a.actor_name}`}</div>
              </div>
              <span className="shrink-0 text-xs text-muted">{relative(a.occurred_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
