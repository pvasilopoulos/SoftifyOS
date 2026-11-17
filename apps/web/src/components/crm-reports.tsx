'use client';
// CRM reports: KPIs, daily trend, by user (table), by type / outcome (ranked bars, one hue), customers without contact.
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { dot, useCrmMeta } from '@/lib/crm';
import { Link } from '@/i18n/navigation';

type Report = {
  kpi: { done: number; due_in_range: number; due_done: number; overdue: number; open: number; on_time: number; minutes: number; customers_reached: number };
  by_user: { id: string; full_name: string; done: number; open: number; overdue: number; positive: number }[];
  by_type: { key: string; name: string; color: string | null; done: number }[];
  by_outcome: { key: string; name: string; color: string | null; positive: boolean; n: number }[];
  trend: { day: string; done: number }[];
  no_contact: { id: string; name: string; code: string; annual_value: number | null; manager_name: string | null; last_contact: string | null }[];
  conversion: { reached: number; with_offer: number };
};
const RANGES = [7, 30, 90, 365] as const;

export function CrmReports({ scope, owner }: { scope: 'mine' | 'all'; owner?: string }) {
  const t = useTranslations('crm');
  const locale = useLocale();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [silent, setSilent] = useState(60);
  const range = useMemo(() => {
    const to = new Date(); to.setHours(24, 0, 0, 0);
    const from = new Date(to.getTime() - days * 864e5);
    return { from, to };
  }, [days]);
  const meta = useCrmMeta();
  // Mine = my own numbers; all = everyone (or the owner picked in the filters)
  const who = scope === 'mine' ? meta.data?.me : owner || undefined;
  const r = useQuery({
    queryKey: ['crm', 'reports', days, who, silent], enabled: !!meta.data,
    queryFn: () => api<Report>(`/crm/reports?from=${range.from.toISOString()}&to=${range.to.toISOString()}&days=${silent}${who ? `&owner=${who}` : ''}`),
  });
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  if (!r.data) return <div className="grid place-items-center p-10">{r.isError ? <p className="text-danger">{t('loadError')}</p> : <Loader2 className="animate-spin text-muted" />}</div>;
  const d = r.data;
  const completion = pct(d.kpi.due_done, d.kpi.due_in_range);
  const onTime = pct(d.kpi.on_time, d.kpi.done);
  const conv = pct(d.conversion.with_offer, d.conversion.reached);
  // daily series with empty days filled in
  const series = (() => {
    const map = new Map(d.trend.map((x) => [x.day, x.done]));
    const out: { day: string; done: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date(range.to.getTime() - (i + 1) * 864e5);
      const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      out.push({ day: k, done: map.get(k) ?? 0 });
    }
    return out;
  })();
  const max = Math.max(1, ...series.map((x) => x.done));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-surface-2 p-1">
          {RANGES.map((n) => <button key={n} onClick={() => setDays(n)} className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium', days === n ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t('lastDays', { n })}</button>)}
        </div>
        <span className="text-xs text-muted">{scope === 'mine' ? t('scope_mine') : t('scope_all')}</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('k_done')} value={d.kpi.done.toLocaleString(locale)} hint={t('k_minutes', { h: Math.round(d.kpi.minutes / 60) })} />
        <Kpi label={t('k_completion')} value={completion === null ? '—' : `${completion}%`} hint={t('k_completionHint', { a: d.kpi.due_done, b: d.kpi.due_in_range })} />
        <Kpi label={t('k_onTime')} value={onTime === null ? '—' : `${onTime}%`} hint={t('k_overdueNow', { n: d.kpi.overdue })} warn={d.kpi.overdue > 0} />
        <Kpi label={t('k_conversion')} value={conv === null ? '—' : `${conv}%`} hint={t('k_conversionHint', { a: d.conversion.with_offer, b: d.conversion.reached })} />
      </div>

      {/* Trend: one series, one hue; hover shows the day */}
      <section className="card p-4">
        <h3 className="mb-3 font-semibold">{t('r_trend')}</h3>
        <div className="flex h-40 items-end gap-[2px]" role="img" aria-label={t('r_trend')}>
          {series.map((x) => (
            <div key={x.day} className="group relative flex h-full flex-1 items-end">
              <div className="w-full rounded-t-[4px] bg-primary/80 transition group-hover:bg-primary" style={{ height: `${(x.done / max) * 100}%`, minHeight: x.done ? 3 : 0 }} />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-text px-2 py-1 text-xs text-bg shadow-lg group-hover:block">
                {new Date(`${x.day}T12:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}: <b>{x.done}</b>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted">
          <span>{new Date(`${series[0].day}T12:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span>
          <span>{t('maxPerDay', { n: max })}</span>
          <span>{new Date(`${series.at(-1)!.day}T12:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Ranked title={t('r_byType')} rows={d.by_type.map((x) => ({ key: x.key, label: x.name, value: x.done }))} empty={t('noData')} />
        <Ranked title={t('r_byOutcome')} empty={t('noData')}
          rows={d.by_outcome.map((x) => ({ key: x.key || '_', label: x.name || t('noOutcome'), value: x.n, marker: x.color, note: x.positive ? '✓' : undefined }))} />
      </div>

      {/* By user: a table (exact numbers) */}
      {d.by_user.length > 0 && (
        <section className="card overflow-hidden">
          <h3 className="border-b border-border px-4 py-3 font-semibold">{t('r_byUser')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted"><tr className="text-left">
                <th className="px-4 py-2 font-medium">{t('owner')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('k_done')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('positive')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('c_open')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('c_overdue')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {d.by_user.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5 font-medium">{u.full_name}</td>
                    <td className="tabular px-3 py-2.5 text-right">{u.done}</td>
                    <td className="tabular px-3 py-2.5 text-right">{u.done ? `${Math.round((u.positive / u.done) * 100)}%` : '—'}</td>
                    <td className="tabular px-3 py-2.5 text-right">{u.open}</td>
                    <td className={clsx('tabular px-4 py-2.5 text-right', u.overdue > 0 && 'font-semibold text-danger')}>{u.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Customers without contact */}
      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h3 className="flex-1 font-semibold">{t('r_noContact')}</h3>
          <select value={silent} onChange={(e) => setSilent(Number(e.target.value))} className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm" aria-label={t('r_noContact')}>
            {[30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>{t('moreThanDays', { n })}</option>)}
          </select>
        </header>
        {!d.no_contact.length ? <p className="p-4 text-sm text-muted">{t('noData')}</p> : (
          <ul className="divide-y divide-border">
            {d.no_contact.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted">{c.code}{c.manager_name ? ` · ${c.manager_name}` : ''}</span></span>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block text-muted">{c.last_contact ? t('lastContact', { d: new Date(c.last_contact).toLocaleDateString(locale) }) : t('neverContacted')}</span>
                    {c.annual_value ? <span className="block font-semibold tabular">{money(c.annual_value, locale, 0)}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular">{value}</div>
      {hint && <div className={clsx('mt-0.5 text-xs', warn ? 'font-medium text-danger' : 'text-muted')}>{hint}</div>}
    </div>
  );
}

/** Ranked horizontal bars: one hue (magnitude), the value as text; an optional marker dot names a status colour. */
function Ranked({ title, rows, empty }: { title: string; rows: { key: string; label: string; value: number; marker?: string | null; note?: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <section className="card p-4">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {!rows.length ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.key} title={`${r.label}: ${r.value} (${Math.round((r.value / total) * 100)}%)`}>
              <div className="mb-1 flex items-center gap-2 text-sm">
                {r.marker && <span className={clsx('h-2 w-2 shrink-0 rounded-full', dot(r.marker))} />}
                <span className="min-w-0 flex-1 truncate">{r.label}{r.note && <span className="ml-1 text-success">{r.note}</span>}</span>
                <span className="tabular font-semibold">{r.value}</span>
                <span className="w-10 text-right text-xs tabular text-muted">{Math.round((r.value / total) * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary/80" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
