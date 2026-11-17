'use client';
// Subscription: Settings → Subscription (plan, usage vs limits, upgrade via Stripe Checkout, invoices and card in the
// Stripe Customer Portal) and the banner shown in the app while on trial / when a payment failed / when it lapsed.
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, CreditCard, ExternalLink, Loader2, Sparkles, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useMe } from './app-shell';
import { Link } from '@/i18n/navigation';
import { Card } from './settings-sections';
import { useToast } from './providers';

type PlanKey = 'trial' | 'starter' | 'business' | 'enterprise';
type Limits = { users: number | null; storage_gb: number; features: { ai: boolean; api: boolean; calendar: boolean }; month: number | null; year: number | null };
type Data = {
  enabled: boolean; checkout: boolean; can_manage: boolean;
  plan: { plan: PlanKey; status: 'trialing' | 'active' | 'past_due' | 'canceled'; interval: 'month' | 'year' | null; trial_ends_at: string | null;
    current_period_end: string | null; cancel_at_period_end: boolean; stripe_customer_id: string | null; limits: Limits; active: boolean; reason: string | null };
  usage: { users: number; storage_bytes: number; ai_usd: number };
  plans: (Limits & { key: PlanKey; can_month: boolean; can_year: boolean })[];
};

const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5)) : 0);

export function BillingSection() {
  const t = useTranslations('billing');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const q = useQuery({ queryKey: ['settings', 'billing'], queryFn: () => api<Data>('/settings/billing') });
  const [interval, setInterval_] = useState<'month' | 'year'>('year');
  const [busy, setBusy] = useState<string | null>(null);

  // Back from Stripe Checkout: refresh until the subscription shows up (webhook may take a few seconds)
  useEffect(() => {
    if (sp.get('checkout') !== 'success') return;
    toast({ title: t('thanks') });
    let n = 0;
    const id = window.setInterval(async () => {
      await api('/settings/billing/refresh', { method: 'POST' }).catch(() => {});
      const d = await qc.fetchQuery({ queryKey: ['settings', 'billing'], queryFn: () => api<Data>('/settings/billing') });
      qc.invalidateQueries({ queryKey: ['me'] });
      if (d.plan.status === 'active' || ++n > 10) window.clearInterval(id);
    }, 3000);
    return () => window.clearInterval(id);
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isError) return <p className="text-sm text-muted">{t('noAccess')}</p>;
  if (!q.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const d = q.data;
  if (!d.enabled) return <Card title={t('title')} description={t('selfHosted')}><p className="text-sm text-muted">{t('selfHostedHint')}</p></Card>;

  const eur = (n: number) => n.toLocaleString(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const p = d.plan;
  const go = async (path: string, body: unknown, key: string) => {
    setBusy(key);
    try { const r = await api<{ url: string }>(path, { method: 'POST', json: body }); window.location.href = r.url; }
    catch (e) { toast({ title: e instanceof ApiError ? t.has(`err_${e.code}` as never) ? t(`err_${e.code}` as never) : e.code : t('error') }); setBusy(null); }
  };
  const subscribed = !!p.stripe_customer_id && p.status !== 'canceled' && p.plan !== 'trial';
  const gb = d.usage.storage_bytes / 1073741824;

  return (
    <div className="space-y-4">
      <Card title={t('current')} description={t(`status_${p.status}`)}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary"><Sparkles size={22} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold">{t(`plan_${p.plan}`)}{p.interval && <span className="ml-2 text-sm font-medium text-muted">· {t(`per_${p.interval}`)}</span>}</div>
              <div className="text-sm text-muted">
                {p.status === 'trialing' && p.trial_ends_at ? t('trialLeft', { days: daysLeft(p.trial_ends_at) })
                  : p.current_period_end ? t(p.cancel_at_period_end ? 'endsOn' : 'renewsOn', { date: new Date(p.current_period_end).toLocaleDateString(locale) }) : null}
              </div>
            </div>
            {subscribed && d.can_manage && (
              <button type="button" onClick={() => go('/settings/billing/portal', { locale }, 'portal')} disabled={!!busy}
                className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">
                {busy === 'portal' ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />} {t('manage')} <ExternalLink size={12} className="text-muted" />
              </button>
            )}
          </div>
          {!p.active && <p className="flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {t(`blocked_${p.reason}` as never)}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Meter label={t('users')} value={d.usage.users} max={p.limits.users} fmt={(n) => String(n)} />
            <Meter label={t('storage')} value={gb} max={p.limits.storage_gb} fmt={(n) => `${n < 10 ? n.toFixed(1) : Math.round(n)} GB`} />
            <div className="rounded-xl border border-border p-3 text-sm">
              <div className="text-xs text-muted">{t('features')}</div>
              <ul className="mt-1 space-y-0.5">
                {(['ai', 'api', 'calendar'] as const).map((f) => (
                  <li key={f} className={clsx('flex items-center gap-1.5', !p.limits.features[f] && 'text-muted line-through')}>
                    {p.limits.features[f] ? <Check size={13} className="text-success" /> : <X size={13} />} {t(`f_${f}`)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Card>

      {!subscribed && (
        <Card title={t('choose')} description={d.checkout ? t('chooseHint') : t('noCheckout')}>
          <div className="mb-4 inline-grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-sm">
            {(['month', 'year'] as const).map((i) => (
              <button key={i} type="button" onClick={() => setInterval_(i)} aria-pressed={interval === i}
                className={clsx('rounded-lg px-3 py-1.5 font-medium', interval === i ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
                {t(`int_${i}`)}{i === 'year' && <span className="ml-1 rounded bg-success-soft px-1 text-[11px] font-semibold text-success">−17%</span>}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {d.plans.map((pl) => {
              const price = interval === 'year' ? pl.year : pl.month;
              const can = interval === 'year' ? pl.can_year : pl.can_month;
              return (
                <div key={pl.key} className={clsx('flex flex-col rounded-2xl border p-4', pl.key === 'business' ? 'border-primary ring-1 ring-primary' : 'border-border')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">{t(`plan_${pl.key}`)}</span>
                    {pl.key === 'business' && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-white">{t('popular')}</span>}
                  </div>
                  <div className="mt-2"><span className="tabular text-3xl font-bold">{price !== null ? eur(interval === 'year' ? price / 12 : price) : '—'}</span><span className="text-sm text-muted"> / {t('mo')}</span></div>
                  <div className="text-xs text-muted">{interval === 'year' && price !== null ? t('billedYearly', { amount: eur(price) }) : t('billedMonthly')} · {t('exVat')}</div>
                  <ul className="my-4 flex-1 space-y-1.5 text-sm">
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-success" /> {pl.users === null ? t('usersUnlimited') : t('usersN', { n: pl.users })}</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-success" /> {t('storageN', { n: pl.storage_gb >= 1000 ? `${pl.storage_gb / 1000} TB` : `${pl.storage_gb} GB` })}</li>
                    {(['ai', 'api', 'calendar'] as const).map((f) => (
                      <li key={f} className={clsx('flex gap-2', !pl.features[f] && 'text-muted')}>
                        {pl.features[f] ? <Check size={15} className="mt-0.5 shrink-0 text-success" /> : <X size={15} className="mt-0.5 shrink-0" />} {t(`f_${f}`)}
                      </li>
                    ))}
                  </ul>
                  <button type="button" disabled={!d.can_manage || !d.checkout || !can || !!busy} onClick={() => go('/settings/billing/checkout', { plan: pl.key, interval, locale }, pl.key)}
                    className={clsx('flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50', pl.key === 'business' ? 'bg-primary text-white' : 'border border-border')}>
                    {busy === pl.key && <Loader2 size={15} className="animate-spin" />} {t('subscribe')}
                  </button>
                </div>
              );
            })}
          </div>
          {!d.can_manage && <p className="mt-3 text-xs text-muted">{t('ownerOnly')}</p>}
        </Card>
      )}
    </div>
  );
}

function Meter({ label, value, max, fmt }: { label: string; value: number; max: number | null; fmt: (n: number) => string }) {
  const t = useTranslations('billing');
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="rounded-xl border border-border p-3 text-sm">
      <div className="flex items-baseline justify-between text-xs text-muted"><span>{label}</span><span className="tabular">{fmt(value)} / {max === null ? t('unlimited') : fmt(max)}</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={clsx('h-full rounded-full', pct >= 90 ? 'bg-danger' : 'bg-primary')} style={{ width: `${max ? Math.max(2, pct) : 0}%` }} />
      </div>
    </div>
  );
}

/** Thin bar above the app: trial days left, failed payment, or lapsed subscription (read-only). */
export function BillingBar() {
  const t = useTranslations('billing');
  const { data: me } = useMe();
  const [hidden, setHidden] = useState(false);
  const b = me?.billing;
  if (!b || hidden) return null;
  const days = daysLeft(b.trial_ends_at);
  const kind = !b.active ? 'blocked' : b.status === 'past_due' ? 'past_due' : b.status === 'trialing' && days <= 7 ? 'trial' : null;
  if (!kind) return null;
  const text = kind === 'blocked' ? t(`blocked_${b.reason}` as never) : kind === 'past_due' ? t('barPastDue') : t('barTrial', { days });
  return (
    <div role="status" className={clsx('sticky top-0 z-40 flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium safe-top',
      kind === 'trial' ? 'bg-primary text-white' : 'bg-danger text-white')}>
      <span className="min-w-0 text-center">{text}</span>
      <Link href="/settings?s=billing" className="shrink-0 rounded-lg bg-white/20 px-3 py-1 font-semibold hover:bg-white/30">{t('barCta')}</Link>
      {kind === 'trial' && <button type="button" aria-label="close" onClick={() => setHidden(true)} className="shrink-0 opacity-80 hover:opacity-100"><X size={16} /></button>}
    </div>
  );
}
