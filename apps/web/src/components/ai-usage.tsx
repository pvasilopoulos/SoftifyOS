'use client';
// Settings → AI: usage dashboard, per-user / per-role / per-feature limits, requests for more budget,
// price list per model and reconciliation with Anthropic's billed cost. Plus "my AI usage" for every user.
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle, Check, ChevronDown, Download, Gauge, KeyRound, Loader2, Pencil, Plus, ReceiptText, RefreshCw, Save, Scale, Tag, Trash2, TrendingUp, Users, X, Zap,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { appConfirm } from './confirm';
import { useToast } from './providers';

type Limit = { monthly: number | null; daily: number | null };
type Limits = { warn_pct: number; rate_per_min: number | null; roles: Record<string, Limit>; users: Record<string, Limit>; features: Record<string, number | null> };
type UserRow = { user_id: string; name: string; email: string; role: string; calls: number; usd: number; errors: number; blocked: number; month_usd: number; today_usd: number;
  last_at: string | null; limit: Limit; extra: number; source: 'user' | 'role' | null; pct: number | null };
type Usage = {
  period: { from: string; to: string };
  totals: { usd: number; calls: number; errors: number; refused: number; blocked: number; input: number; output: number; cache_read: number; cache_write: number; avg_ms: number; users: number; avg_call: number; cache_hit_pct: number; error_rate: number };
  month: { usd: number; budget: number; forecast: number; days_left: number };
  limits: Limits; users: UserRow[];
  by_feature: { feature: string; calls: number; usd: number | null; blocked: number }[];
  by_model: { model: string; calls: number; usd: number; input: number; output: number }[];
  by_day: { day: string; usd: number; calls: number }[];
  by_customer: { id: string; name: string; calls: number; usd: number }[];
  spikes: { user_id: string; name: string; hour: number; avg: number }[];
  recent: { created_at: string; user_name: string | null; feature: string; model: string; status: string; error: string | null; input_tokens: number; output_tokens: number; cache_read: number; usd: number; duration_ms: number | null; request_id: string | null }[];
  requests: { id: string; user_id: string; name: string; amount_usd: number; reason: string | null; status: 'pending' | 'approved' | 'rejected'; note: string | null; created_at: string; decided_by_name: string | null }[];
  reconciliation: { configured: boolean; meta: { last4?: string; api_key_ids?: string[]; keys?: { id: string; name: string; hint: string; status: string }[]; last_run_at?: string; last_error?: string | null } | null;
    days: { day: string; estimated_usd: number; billed_usd: number | null; list_usd: number | null; requests: number | null; by_model: Record<string, number> }[] };
};
type Roles = { key: string; name: string }[];
const FEATURES = ['copilot', 'voice', 'summary', 'actions_summary', 'reports', 'offer_draft', 'import'];

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';
const btn = 'flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium hover:border-primary disabled:opacity-60';
const btnPrimary = 'flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60';

function useUsd() {
  const locale = useLocale();
  return (n: number | null | undefined, digits = 2) => (n == null ? '—' : n.toLocaleString(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, n !== 0 && Math.abs(n) < 0.01 ? 4 : digits) }));
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function Section({ title, hint, icon, action, children, open: initial = true }: { title: string; hint?: string; icon: ReactNode; action?: ReactNode; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">{icon}</span>
          <span className="min-w-0"><span className="block text-base font-semibold">{title}</span>{hint && <span className="block text-sm text-muted">{hint}</span>}</span>
        </button>
        {action}
        <button type="button" onClick={() => setOpen(!open)} aria-label="toggle" className="mt-1 text-muted"><ChevronDown size={18} className={clsx('transition', open && 'rotate-180')} /></button>
      </div>
      {open && <div className="mt-4">{children}</div>}
    </section>
  );
}

// ============================================================ dashboard (admins)
export function AiUsageDashboard({ roles }: { roles: Roles }) {
  const t = useTranslations('aiUsage');
  const tai = useTranslations('ai');
  const locale = useLocale();
  const usd = useUsd();
  const [preset, setPreset] = useState<'month' | 'last' | '30d' | 'custom'>('month');
  const [custom, setCustom] = useState({ from: ymd(new Date(Date.now() - 30 * 864e5)), to: ymd(new Date()) });
  const range = useMemo(() => {
    const n = new Date();
    if (preset === 'month') return { from: ymd(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), to: ymd(n) };
    if (preset === 'last') return { from: ymd(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1))), to: ymd(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0))) };
    if (preset === '30d') return { from: ymd(new Date(n.getTime() - 29 * 864e5)), to: ymd(n) };
    return custom;
  }, [preset, custom]);
  const q = useQuery({ queryKey: ['settings', 'ai-usage', range], queryFn: () => api<Usage>(`/settings/ai/usage?from=${range.from}&to=${range.to}`), refetchInterval: 60_000 });
  const d = q.data;
  const feat = (f: string) => (tai.has(`f_${f}`) ? tai(`f_${f}` as never) : f);

  return (
    <div className="@container space-y-4">
      {/* period + export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-xl bg-surface-2 p-1 text-sm">
          {(['month', 'last', '30d', 'custom'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPreset(p)} aria-pressed={preset === p}
              className={clsx('rounded-lg px-3 py-1 font-medium', preset === p ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t(`p_${p}`)}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5 text-sm">
            <input type="date" className={clsx(input, 'w-auto py-1.5')} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-muted">→</span>
            <input type="date" className={clsx(input, 'w-auto py-1.5')} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => q.refetch()} aria-label={t('refresh')} className="grid h-9 w-9 place-items-center rounded-xl border border-border"><RefreshCw size={15} className={clsx(q.isFetching && 'animate-spin')} /></button>
        <a href={`/api/settings/ai/usage.csv?from=${range.from}&to=${range.to}`} className={btn}><Download size={15} /> CSV</a>
      </div>

      {!d ? <div className="card py-12 text-center"><Loader2 className="mx-auto animate-spin text-muted" /></div> : (
        <>
          {/* KPIs */}
          <section className="card overflow-hidden">
            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm text-muted">{t('thisMonth')}</span>
                <span className="text-2xl font-bold tabular">{usd(d.month.usd)}</span>
                <span className="text-sm text-muted">/ {usd(d.month.budget)}</span>
                <span className="flex-1" />
                <span className={clsx('flex items-center gap-1 text-sm font-medium', d.month.forecast > d.month.budget ? 'text-danger' : 'text-muted')}>
                  <TrendingUp size={14} /> {t('forecast', { usd: usd(d.month.forecast), days: d.month.days_left })}
                </span>
              </div>
              <Meter pct={(d.month.usd / Math.max(0.0001, d.month.budget)) * 100} forecastPct={(d.month.forecast / Math.max(0.0001, d.month.budget)) * 100} />
            </div>
            <dl className="grid grid-cols-2 border-t border-border @2xl:grid-cols-5">
              {[
                [t('k_cost'), usd(d.totals.usd), t('k_calls', { n: d.totals.calls })],
                [t('k_avg'), usd(d.totals.avg_call, 3), t('k_ms', { ms: (d.totals.avg_ms / 1000).toFixed(1) })],
                [t('k_cache'), `${d.totals.cache_hit_pct}%`, t('k_tokens', { n: Math.round((d.totals.input + d.totals.output + d.totals.cache_read) / 1000).toLocaleString(locale) })],
                [t('k_errors'), `${d.totals.error_rate}%`, t('k_errorsSub', { e: d.totals.errors, r: d.totals.refused })],
                [t('k_blocked'), String(d.totals.blocked), t('k_users', { n: d.totals.users })],
              ].map(([k, v, sub], i) => (
                <div key={k} className={clsx('min-w-0 border-border p-4 sm:px-5', i % 2 === 0 && 'border-r', i < 4 && 'border-b @2xl:border-b-0', '@2xl:border-r', i === 4 && '@2xl:border-r-0')}>
                  <dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 truncate text-lg font-bold tabular">{v}</dd><dd className="truncate text-xs text-muted">{sub}</dd>
                </div>
              ))}
            </dl>
          </section>

          {d.spikes.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>{d.spikes.map((x) => <div key={x.user_id}>{t('spike', { name: x.name, hour: usd(x.hour), avg: usd(x.avg) })}</div>)}</div>
            </div>
          )}

          <DayChart days={d.by_day} from={d.period.from} to={d.period.to} />
          <Requests rows={d.requests} onDone={() => q.refetch()} />
          <UsersTable d={d} roles={roles} onSaved={() => q.refetch()} />

          <div className="grid gap-4 @3xl:grid-cols-2">
            <Section title={t('byFeature')} icon={<Zap size={15} />}>
              <Rows rows={d.by_feature.map((f) => ({ key: f.feature, label: feat(f.feature), usd: f.usd ?? 0, sub: t('calls', { n: f.calls }) + (f.blocked ? ` · ${t('blockedN', { n: f.blocked })}` : '') }))} usd={usd} empty={t('empty')} />
            </Section>
            <Section title={t('byModel')} icon={<Tag size={15} />}>
              <Rows rows={d.by_model.map((m) => ({ key: m.model, label: m.model, mono: true, usd: m.usd ?? 0, sub: `${t('calls', { n: m.calls })} · ${Math.round(Number(m.input) / 1000).toLocaleString(locale)}k / ${Math.round(Number(m.output) / 1000).toLocaleString(locale)}k tokens` }))} usd={usd} empty={t('empty')} />
            </Section>
          </div>
          {d.by_customer.length > 0 && (
            <Section title={t('byCustomer')} hint={t('byCustomerHint')} icon={<Users size={15} />} open={false}>
              <Rows rows={d.by_customer.map((c) => ({ key: c.id, label: c.name, href: `/el/customers/${c.id}`, usd: c.usd, sub: t('calls', { n: c.calls }) }))} usd={usd} empty={t('empty')} />
            </Section>
          )}
          <Ledger rows={d.recent} feat={feat} />
          <LimitsCard limits={d.limits} roles={roles} onSaved={() => q.refetch()} feat={feat} />
          <PricesCard />
          <ReconcileCard r={d.reconciliation} onChanged={() => q.refetch()} />
        </>
      )}
    </div>
  );
}

function Meter({ pct, forecastPct }: { pct: number; forecastPct?: number }) {
  return (
    <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      {forecastPct !== undefined && <div className="absolute inset-y-0 left-0 rounded-full bg-primary/20" style={{ width: `${Math.min(100, forecastPct)}%` }} />}
      <div className={clsx('absolute inset-y-0 left-0 rounded-full', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(pct > 0 ? 1 : 0, Math.min(100, pct))}%` }} />
    </div>
  );
}

function Rows({ rows, usd, empty }: { rows: { key: string; label: string; usd: number; sub?: string; mono?: boolean; href?: string }[]; usd: (n: number) => string; empty: string }) {
  const max = Math.max(...rows.map((r) => r.usd), 0.0001);
  if (!rows.length) return <p className="py-3 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline gap-2 text-sm">
            {r.href ? <a href={r.href} className={clsx('min-w-0 flex-1 truncate font-medium hover:text-primary', r.mono && 'font-mono text-xs')}>{r.label}</a>
              : <span className={clsx('min-w-0 flex-1 truncate font-medium', r.mono && 'font-mono text-xs')}>{r.label}</span>}
            <span className="font-semibold tabular">{usd(r.usd)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(1, (r.usd / max) * 100)}%` }} /></div>
            {r.sub && <span className="shrink-0 text-xs text-muted">{r.sub}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DayChart({ days, from, to }: { days: Usage['by_day']; from: string; to: string }) {
  const t = useTranslations('aiUsage');
  const locale = useLocale();
  const usd = useUsd();
  const [hover, setHover] = useState<number | null>(null);
  // Every day of the period, empty ones as zero
  const all = useMemo(() => {
    const by = new Map(days.map((x) => [x.day, x]));
    const out: { day: string; usd: number; calls: number }[] = [];
    for (let d = new Date(from); d < new Date(to) && out.length < 400; d = new Date(d.getTime() + 864e5)) {
      const k = ymd(d); out.push(by.get(k) ?? { day: k, usd: 0, calls: 0 });
    }
    return out;
  }, [days, from, to]);
  const max = Math.max(...all.map((x) => x.usd), 0.0001);
  const cur = all[hover ?? all.length - 1];
  const label = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center gap-2"><h3 className="flex-1 text-base font-semibold">{t('perDay')}</h3></div>
      <p className="mb-3 h-5 text-sm" aria-live="polite">{cur && <><span className="font-semibold">{label(cur.day)}</span><span className="text-muted"> · {usd(cur.usd)} · {t('calls', { n: cur.calls })}</span></>}</p>
      <div className="flex h-32 items-end gap-px border-b border-border" onMouseLeave={() => setHover(null)}>
        {all.map((x, i) => (
          <div key={x.day} tabIndex={0} role="img" aria-label={`${label(x.day)}: ${usd(x.usd)}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
            className="flex h-full min-w-0 flex-1 items-end outline-none">
            <div className={clsx('w-full rounded-t-[3px] bg-primary transition-opacity', hover !== null && hover !== i && 'opacity-40')} style={{ height: x.usd ? `${Math.max(3, (x.usd / max) * 100)}%` : '0' }} />
          </div>
        ))}
      </div>
      {all.length > 1 && <div className="mt-1.5 flex justify-between text-[11px] text-muted tabular"><span>{label(all[0].day)}</span><span>{label(all[all.length - 1].day)}</span></div>}
    </section>
  );
}

// ---------------------------------------------------------------- users + their limits
function UsersTable({ d, roles, onSaved }: { d: Usage; roles: Roles; onSaved: () => void }) {
  const t = useTranslations('aiUsage');
  const usd = useUsd();
  const toast = useToast();
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState<{ monthly: string; daily: string }>({ monthly: '', daily: '' });
  const roleName = (k: string) => roles.find((r) => r.key === k)?.name ?? k;
  const save = async (uid: string, clear = false) => {
    const users = { ...d.limits.users };
    if (clear) delete users[uid];
    else users[uid] = { monthly: val.monthly === '' ? null : Number(val.monthly), daily: val.daily === '' ? null : Number(val.daily) };
    try { await api('/settings/ai/limits', { method: 'PUT', json: { ...d.limits, users } }); toast({ title: t('saved') }); setEdit(null); onSaved(); }
    catch { toast({ title: t('saveError') }); }
  };
  return (
    <Section title={t('users')} hint={t('usersHint')} icon={<Users size={15} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="py-2 font-medium">{t('user')}</th><th className="py-2 text-right font-medium">{t('period')}</th><th className="w-56 py-2 pl-4 font-medium">{t('monthLimit')}</th><th className="py-2 text-right font-medium">{t('today')}</th><th className="w-10" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.users.map((u) => {
              const cap = u.limit.monthly !== null ? u.limit.monthly + u.extra : null;
              const isEdit = edit === u.user_id;
              return (
                <Fragment key={u.user_id}>
                  <tr className="align-top">
                    <td className="py-2.5"><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{roleName(u.role)}{u.errors ? ` · ${t('errorsN', { n: u.errors })}` : ''}{u.blocked ? ` · ${t('blockedN', { n: u.blocked })}` : ''}</div></td>
                    <td className="py-2.5 text-right"><div className="font-semibold tabular">{usd(u.usd)}</div><div className="text-xs text-muted">{t('calls', { n: u.calls })}</div></td>
                    <td className="py-2.5 pl-4">
                      {cap === null ? <span className="text-xs text-muted">{t('noLimit')}</span> : (
                        <>
                          <div className="flex items-baseline justify-between gap-2 text-xs"><span className="tabular">{usd(u.month_usd)} / {usd(cap)}</span>
                            <span className="text-muted">{u.source === 'role' ? t('fromRole') : t('own')}{u.extra ? ` · +${usd(u.extra)}` : ''}</span></div>
                          <Meter pct={u.pct ?? 0} />
                        </>
                      )}
                      {u.limit.daily !== null && <div className="mt-1 text-xs text-muted">{t('dailyLimit', { usd: usd(u.limit.daily) })}</div>}
                    </td>
                    <td className="py-2.5 text-right tabular">{usd(u.today_usd)}</td>
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => { setEdit(isEdit ? null : u.user_id); setVal({ monthly: d.limits.users[u.user_id]?.monthly?.toString() ?? '', daily: d.limits.users[u.user_id]?.daily?.toString() ?? '' }); }}
                        aria-label={t('editLimit')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"><Pencil size={14} /></button>
                    </td>
                  </tr>
                  {isEdit && (
                    <tr><td colSpan={5} className="pb-3">
                      <div className="flex flex-wrap items-end gap-2 rounded-xl bg-surface-2 p-3">
                        <label className="w-36"><span className="mb-1 block text-xs text-muted">{t('monthlyUsd')}</span><input type="number" min={0} step="0.5" className={input} value={val.monthly} placeholder={t('fromRoleOrNone')} onChange={(e) => setVal((v) => ({ ...v, monthly: e.target.value }))} /></label>
                        <label className="w-36"><span className="mb-1 block text-xs text-muted">{t('dailyUsd')}</span><input type="number" min={0} step="0.5" className={input} value={val.daily} placeholder="—" onChange={(e) => setVal((v) => ({ ...v, daily: e.target.value }))} /></label>
                        <button type="button" onClick={() => save(u.user_id)} className={btnPrimary}><Save size={14} /> {t('save')}</button>
                        {d.limits.users[u.user_id] && <button type="button" onClick={() => save(u.user_id, true)} className={btn}>{t('useRole')}</button>}
                        <button type="button" onClick={() => setEdit(null)} className="px-2 text-sm text-muted">{t('cancel')}</button>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- requests for more budget
function Requests({ rows, onDone }: { rows: Usage['requests']; onDone: () => void }) {
  const t = useTranslations('aiUsage');
  const usd = useUsd();
  const locale = useLocale();
  const toast = useToast();
  const pending = rows.filter((r) => r.status === 'pending');
  const decide = async (id: string, approve: boolean, amount?: number) => {
    try { await api(`/settings/ai/budget-requests/${id}/decide`, { method: 'POST', json: { approve, amount_usd: amount } }); toast({ title: approve ? t('approved') : t('rejected') }); onDone(); }
    catch { toast({ title: t('saveError') }); }
  };
  if (!rows.length) return null;
  return (
    <Section title={t('requests')} hint={pending.length ? t('pendingN', { n: pending.length }) : t('requestsHint')} icon={<ReceiptText size={15} />} open={pending.length > 0}>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="min-w-0 flex-1"><span className="font-medium">{r.name}</span> <span className="font-semibold tabular text-primary">+{usd(r.amount_usd)}</span>
              {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
              <span className="block text-xs text-muted">{new Date(r.created_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}{r.decided_by_name ? ` · ${r.decided_by_name}` : ''}</span></span>
            {r.status === 'pending' ? (
              <span className="flex gap-1.5">
                <button type="button" onClick={() => decide(r.id, false)} className={btn}><X size={14} /> {t('reject')}</button>
                <button type="button" onClick={() => decide(r.id, true)} className={btnPrimary}><Check size={14} /> {t('approve')}</button>
              </span>
            ) : <span className={clsx('rounded-md px-2 py-0.5 text-xs font-semibold', r.status === 'approved' ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')}>{t(r.status)}</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- ledger
function Ledger({ rows, feat }: { rows: Usage['recent']; feat: (f: string) => string }) {
  const t = useTranslations('aiUsage');
  const usd = useUsd();
  const locale = useLocale();
  const [status, setStatus] = useState<'all' | 'ok' | 'error' | 'blocked'>('all');
  const list = rows.filter((r) => status === 'all' || (status === 'error' ? r.status === 'error' || r.status === 'refused' : r.status === status));
  return (
    <Section title={t('ledger')} hint={t('ledgerHint')} icon={<ReceiptText size={15} />} open={false}>
      <div className="mb-2 flex w-fit gap-0.5 rounded-lg bg-surface-2 p-0.5 text-sm">
        {(['all', 'ok', 'error', 'blocked'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={clsx('rounded-md px-3 py-1 font-medium', status === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t(`st_${k}`)}</button>
        ))}
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[44rem] text-xs">
          <thead className="sticky top-0 bg-surface text-left text-muted">
            <tr>{['time', 'user', 'feature', 'model', 'tokens', 'cost', 'status'].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{t(`l_${h}`)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.map((r, i) => (
              <tr key={i} title={r.request_id ?? undefined}>
                <td className="whitespace-nowrap py-1.5 pr-3 tabular">{new Date(r.created_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' })}</td>
                <td className="max-w-32 truncate py-1.5 pr-3">{r.user_name ?? '—'}</td>
                <td className="py-1.5 pr-3">{feat(r.feature)}</td>
                <td className="py-1.5 pr-3 font-mono">{r.model === '-' ? '—' : r.model}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 tabular">{r.input_tokens ? `${r.input_tokens.toLocaleString(locale)} → ${r.output_tokens.toLocaleString(locale)}${r.cache_read ? ` (+${r.cache_read.toLocaleString(locale)} cache)` : ''}` : '—'}</td>
                <td className="py-1.5 pr-3 font-semibold tabular">{usd(r.usd, 4)}</td>
                <td className="py-1.5 pr-3">
                  <span className={clsx('rounded px-1.5 py-0.5 font-semibold', r.status === 'ok' ? 'bg-success-soft text-success' : r.status === 'blocked' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')} title={r.error ?? undefined}>
                    {t(`s_${r.status}`)}{r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}″` : ''}
                  </span>
                  {r.error && r.status !== 'ok' && <div className="mt-0.5 max-w-56 truncate text-muted">{r.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="py-4 text-center text-sm text-muted">{t('empty')}</p>}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- limits (roles, features, warning, rate)
function LimitsCard({ limits, roles, onSaved, feat }: { limits: Limits; roles: Roles; onSaved: () => void; feat: (f: string) => string }) {
  const t = useTranslations('aiUsage');
  const toast = useToast();
  const [l, setL] = useState<Limits>(limits);
  const [dirty, setDirty] = useState(false);
  const num = (v: string) => (v === '' ? null : Number(v));
  const setRole = (k: string, p: Partial<Limit>) => { setL((x) => { const cur = x.roles[k] ?? { monthly: null, daily: null }; const next = { ...cur, ...p };
    const roles2 = { ...x.roles }; if (next.monthly === null && next.daily === null) delete roles2[k]; else roles2[k] = next; return { ...x, roles: roles2 }; }); setDirty(true); };
  const setFeat = (k: string, v: number | null) => { setL((x) => { const f = { ...x.features }; if (v === null) delete f[k]; else f[k] = v; return { ...x, features: f }; }); setDirty(true); };
  const save = async () => {
    try { await api('/settings/ai/limits', { method: 'PUT', json: l }); toast({ title: t('saved') }); setDirty(false); onSaved(); }
    catch { toast({ title: t('saveError') }); }
  };
  return (
    <Section title={t('limits')} hint={t('limitsHint')} icon={<Gauge size={15} />} open={false}
      action={dirty ? <button type="button" onClick={save} className={btnPrimary}><Save size={14} /> {t('save')}</button> : undefined}>
      <div className="grid gap-6 @3xl:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t('roleLimits')}</h4>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-medium">{t('role')}</th><th className="w-28 py-1 font-medium">{t('monthlyUsd')}</th><th className="w-28 py-1 font-medium">{t('dailyUsd')}</th></tr></thead>
            <tbody className="divide-y divide-border">
              {roles.map((r) => (
                <tr key={r.key}>
                  <td className="py-1.5">{r.name}</td>
                  <td className="py-1.5 pr-2"><input type="number" min={0} step="0.5" className={clsx(input, 'py-1.5')} placeholder="∞" value={l.roles[r.key]?.monthly ?? ''} onChange={(e) => setRole(r.key, { monthly: num(e.target.value) })} /></td>
                  <td className="py-1.5"><input type="number" min={0} step="0.5" className={clsx(input, 'py-1.5')} placeholder="∞" value={l.roles[r.key]?.daily ?? ''} onChange={(e) => setRole(r.key, { daily: num(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">{t('roleLimitsHelp')}</p>
        </div>
        <div className="space-y-5">
          <div>
            <h4 className="mb-2 text-sm font-semibold">{t('featureLimits')}</h4>
            <div className="grid grid-cols-2 gap-2">
              {FEATURES.map((f) => (
                <label key={f} className="min-w-0"><span className="mb-1 block truncate text-xs text-muted">{feat(f)}</span>
                  <input type="number" min={0} step="1" className={clsx(input, 'py-1.5')} placeholder="∞" value={l.features[f] ?? ''} onChange={(e) => setFeat(f, num(e.target.value))} /></label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{t('featureLimitsHelp')}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label><span className="mb-1 block text-xs text-muted">{t('warnPct')}</span><input type="number" min={10} max={99} className={input} value={l.warn_pct} onChange={(e) => { setL((x) => ({ ...x, warn_pct: Number(e.target.value) })); setDirty(true); }} /></label>
            <label><span className="mb-1 block text-xs text-muted">{t('ratePerMin')}</span><input type="number" min={1} max={600} className={input} placeholder="∞" value={l.rate_per_min ?? ''} onChange={(e) => { setL((x) => ({ ...x, rate_per_min: num(e.target.value) })); setDirty(true); }} /></label>
          </div>
          <p className="text-xs text-muted">{t('reserveHelp')}</p>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- price list
function PricesCard() {
  const t = useTranslations('aiUsage');
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings', 'ai-prices'], queryFn: () => api<{ defaults: Record<string, { input: number; output: number; cache_read: number; cache_write: number }>; rows: { model: string; valid_from: string; input: number; output: number; cache_read: number; cache_write: number }[] }>('/settings/ai/prices') });
  const [form, setForm] = useState({ model: 'claude-opus-5-5', valid_from: ymd(new Date()), input: '', output: '', cache_read: '', cache_write: '' });
  const save = async () => {
    try { await api('/settings/ai/prices', { method: 'PUT', json: form }); toast({ title: t('saved') }); q.refetch(); }
    catch { toast({ title: t('saveError') }); }
  };
  const remove = async (model: string, from: string) => { await api(`/settings/ai/prices?model=${encodeURIComponent(model)}&valid_from=${from}`, { method: 'DELETE' }); q.refetch(); };
  const fill = (model: string) => { const p = q.data?.defaults[model]; if (p) setForm((f) => ({ ...f, model, input: String(p.input), output: String(p.output), cache_read: String(p.cache_read), cache_write: String(p.cache_write) })); };
  return (
    <Section title={t('prices')} hint={t('pricesHint')} icon={<Tag size={15} />} open={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-medium">{t('model')}</th><th className="py-1.5 font-medium">{t('from')}</th>
            {['input', 'output', 'cache_read', 'cache_write'].map((k) => <th key={k} className="py-1.5 text-right font-medium">{t(`pr_${k}`)}</th>)}<th className="w-8" /></tr></thead>
          <tbody className="divide-y divide-border">
            {q.data?.rows.map((r) => (
              <tr key={`${r.model}-${r.valid_from}`}><td className="py-1.5 font-mono text-xs">{r.model}</td><td className="py-1.5 tabular">{r.valid_from}</td>
                {[r.input, r.output, r.cache_read, r.cache_write].map((v, i) => <td key={i} className="py-1.5 text-right tabular">{v}</td>)}
                <td className="py-1.5 text-right"><button type="button" onClick={() => remove(r.model, r.valid_from)} aria-label={t('remove')} className="grid h-7 w-7 place-items-center rounded-lg text-danger hover:bg-danger-soft"><Trash2 size={13} /></button></td></tr>
            ))}
            {Object.entries(q.data?.defaults ?? {}).filter(([m]) => !q.data?.rows.some((r) => r.model === m)).map(([m, p]) => (
              <tr key={m} className="text-muted"><td className="py-1.5 font-mono text-xs">{m}</td><td className="py-1.5 text-xs">{t('default')}</td>
                {[p.input, p.output, p.cache_read, p.cache_write].map((v, i) => <td key={i} className="py-1.5 text-right tabular">{v}</td>)}
                <td className="py-1.5 text-right"><button type="button" onClick={() => fill(m)} aria-label={t('edit')} className="grid h-7 w-7 place-items-center rounded-lg hover:bg-surface-2"><Pencil size={13} /></button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-3 @xl:grid-cols-6">
        <label className="col-span-2"><span className="mb-1 block text-xs text-muted">{t('model')}</span><input className={clsx(input, 'bg-surface font-mono')} value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value.trim() }))} /></label>
        <label><span className="mb-1 block text-xs text-muted">{t('from')}</span><input type="date" className={clsx(input, 'bg-surface')} value={form.valid_from} onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} /></label>
        {(['input', 'output', 'cache_read'] as const).map((k) => <label key={k}><span className="mb-1 block text-xs text-muted">{t(`pr_${k}`)}</span><input type="number" min={0} step="0.01" className={clsx(input, 'bg-surface')} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} /></label>)}
        <label><span className="mb-1 block text-xs text-muted">{t('pr_cache_write')}</span><input type="number" min={0} step="0.01" className={clsx(input, 'bg-surface')} value={form.cache_write} onChange={(e) => setForm((f) => ({ ...f, cache_write: e.target.value }))} /></label>
        <div className="col-span-2 flex items-end @xl:col-span-5"><p className="text-xs text-muted">{t('pricesHelp')}</p></div>
        <div className="flex items-end"><button type="button" onClick={save} disabled={!form.model || form.input === '' || form.output === ''} className={clsx(btnPrimary, 'w-full')}><Plus size={14} /> {t('add')}</button></div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- reconciliation with Anthropic
function ReconcileCard({ r, onChanged }: { r: Usage['reconciliation']; onChanged: () => void }) {
  const t = useTranslations('aiUsage');
  const usd = useUsd();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const meta = r.meta;
  const setAdminKey = async () => {
    setBusy('key'); setErr(null);
    try {
      const res = await api<{ ok: boolean; error?: string; detail?: string; matched?: string[] }>('/settings/ai/admin-key', { method: 'PUT', json: { key } });
      if (!res.ok) setErr(t(`ak_${res.error}` as never)); else { setKey(''); toast({ title: res.matched?.length ? t('keySavedMatched', { n: res.matched.length }) : t('keySavedNoMatch') }); onChanged(); }
    } catch (e) { setErr(e instanceof ApiError && e.status === 400 ? t('ak_format') : t('saveError')); }
    setBusy(null);
  };
  const toggleKey = async (id: string) => {
    const ids = new Set(meta?.api_key_ids ?? []); if (ids.has(id)) ids.delete(id); else ids.add(id);
    await api('/settings/ai/admin-key/keys', { method: 'PUT', json: { api_key_ids: [...ids] } }); onChanged();
  };
  const run = async () => {
    setBusy('run'); setErr(null);
    const res = await api<{ ok: boolean; error?: string }>('/settings/ai/reconcile', { method: 'POST', json: { days: 14 } }).catch(() => ({ ok: false, error: 'api_error' }));
    if (!res.ok) setErr(res.error ?? null); else toast({ title: t('reconciled') });
    setBusy(null); onChanged(); qc.invalidateQueries({ queryKey: ['settings', 'ai-usage'] });
  };
  const remove = async () => { if (await appConfirm(t('removeKeyConfirm'), { danger: true })) { await api('/settings/ai/admin-key', { method: 'DELETE' }); onChanged(); } };
  const totals = r.days.reduce((a, x) => ({ est: a.est + x.estimated_usd, billed: a.billed + (x.billed_usd ?? 0) }), { est: 0, billed: 0 });
  return (
    <Section title={t('reconcile')} hint={t('reconcileHint')} icon={<Scale size={15} />} open={!!meta}
      action={meta ? <button type="button" onClick={run} disabled={!!busy} className={btn}>{busy === 'run' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('runNow')}</button> : undefined}>
      {!meta ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t('adminKeyHelp')}</p>
          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 focus-within:border-primary">
              <KeyRound size={15} className="text-muted" /><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="sk-ant-admin…" className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none" />
            </label>
            <button type="button" onClick={setAdminKey} disabled={!key || !!busy} className={btnPrimary}>{busy === 'key' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t('save')}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex items-center gap-1.5"><KeyRound size={14} className="text-muted" /> Admin ••••{meta.last4}</span>
            {meta.last_run_at && <span className="text-xs text-muted">· {t('lastRun', { when: new Date(meta.last_run_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })}</span>}
            <span className="flex-1" />
            <button type="button" onClick={remove} className="text-sm font-medium text-danger">{t('removeKey')}</button>
          </div>
          {meta.keys && meta.keys.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('whichKeys')}</div>
              <div className="flex flex-wrap gap-2">
                {meta.keys.map((k) => (
                  <label key={k.id} className={clsx('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm', meta.api_key_ids?.includes(k.id) ? 'border-primary bg-primary-soft' : 'border-border')}>
                    <input type="checkbox" className="accent-[var(--primary)]" checked={!!meta.api_key_ids?.includes(k.id)} onChange={() => toggleKey(k.id)} />
                    <span>{k.name}</span><span className="font-mono text-xs text-muted">{k.hint}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {(meta.last_error || err) && <p className="rounded-xl bg-danger-soft p-2.5 text-sm text-danger [overflow-wrap:anywhere]">{err ?? meta.last_error}</p>}
          {r.days.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-medium">{t('day')}</th><th className="py-1.5 text-right font-medium">{t('estimated')}</th><th className="py-1.5 text-right font-medium">{t('billed')}</th><th className="py-1.5 text-right font-medium">{t('diff')}</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {r.days.map((x) => {
                    const diff = x.billed_usd == null ? null : x.estimated_usd - x.billed_usd;
                    const pct = diff == null || !x.billed_usd ? null : (diff / x.billed_usd) * 100;
                    return (
                      <tr key={x.day} title={Object.entries(x.by_model).map(([m, v]) => `${m}: ${usd(v)}`).join('\n')}>
                        <td className="py-1.5 tabular">{new Date(`${x.day}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                        <td className="py-1.5 text-right tabular">{usd(x.estimated_usd)}</td>
                        <td className="py-1.5 text-right font-semibold tabular">{x.billed_usd == null ? <span className="text-xs font-normal text-muted">{t('notYet')}</span> : usd(x.billed_usd)}</td>
                        <td className={clsx('py-1.5 text-right tabular', pct !== null && Math.abs(pct) > 5 ? 'text-warning' : 'text-muted')}>{diff == null ? '—' : `${diff >= 0 ? '+' : ''}${usd(diff)}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-border font-semibold"><tr><td className="py-1.5">{t('total')}</td><td className="py-1.5 text-right tabular">{usd(totals.est)}</td><td className="py-1.5 text-right tabular">{usd(totals.billed)}</td><td /></tr></tfoot>
              </table>
              <p className="mt-2 text-xs text-muted">{t('reconcileNote')}</p>
            </div>
          ) : <p className="text-sm text-muted">{t('noReconcile')}</p>}
        </div>
      )}
    </Section>
  );
}

// ============================================================ my usage (every user) + asking for more
export function MyAiUsage() {
  const t = useTranslations('aiUsage');
  const tai = useTranslations('ai');
  const usd = useUsd();
  const q = useQuery({ queryKey: ['ai', 'me-usage'], queryFn: () => api<{ month: number; today: number; calls: number; limit: Limit; extra: number;
    by_feature: { feature: string; calls: number; usd: number }[]; requests: { id: string; amount_usd: number; reason: string | null; status: string; note: string | null; created_at: string }[] }>('/ai/me/usage') });
  if (!q.data) return null;
  const d = q.data;
  const cap = d.limit.monthly !== null ? d.limit.monthly + d.extra : null;
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2"><Zap size={16} className="text-primary" /><h3 className="flex-1 text-base font-semibold">{t('myUsage')}</h3></div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-bold tabular">{usd(d.month)}</span>
        <span className="text-sm text-muted">{cap !== null ? `/ ${usd(cap)} ${t('thisMonthShort')}` : t('noLimitMine')}</span>
      </div>
      {cap !== null && <Meter pct={(d.month / Math.max(0.0001, cap)) * 100} />}
      <p className="mt-2 text-xs text-muted">{t('myToday', { usd: usd(d.today), n: d.calls })}{d.limit.daily !== null ? ` · ${t('dailyLimit', { usd: usd(d.limit.daily) })}` : ''}{d.extra ? ` · +${usd(d.extra)} ${t('approvedExtra')}` : ''}</p>
      {d.by_feature.length > 0 && <p className="mt-1 text-xs text-muted">{d.by_feature.map((f) => `${tai.has(`f_${f.feature}`) ? tai(`f_${f.feature}` as never) : f.feature} ${usd(f.usd)}`).join(' · ')}</p>}
      {cap !== null && <RequestMore pending={d.requests.some((r) => r.status === 'pending')} onSent={() => q.refetch()} />}
      {d.requests.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {d.requests.slice(0, 3).map((r) => (
            <li key={r.id} className="flex items-center gap-2"><span className="tabular">+{usd(r.amount_usd)}</span>
              <span className={clsx('rounded px-1.5 py-0.5 font-semibold', r.status === 'approved' ? 'bg-success-soft text-success' : r.status === 'pending' ? 'bg-info-soft text-info' : 'bg-surface-2 text-muted')}>{t(r.status as never)}</span>
              {r.note && <span className="truncate text-muted">{r.note}</span>}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Ask for more this month": from My usage and from the "limit reached" message. */
export function RequestMore({ pending, onSent, compact }: { pending: boolean; onSent?: () => void; compact?: boolean }) {
  const t = useTranslations('aiUsage');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('5');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (pending) return <p className={clsx('text-xs text-info', compact ? 'mt-1.5' : 'mt-3')}>{t('requestPending')}</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={clsx('text-sm font-semibold text-primary', compact ? 'mt-1.5' : 'mt-3')}>{t('askMore')}</button>;
  const send = async () => {
    setBusy(true);
    try { await api('/ai/budget-requests', { method: 'POST', json: { amount_usd: Number(amount), reason: reason || undefined } }); toast({ title: t('requestSent') }); setOpen(false); onSent?.(); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'already_pending' ? t('requestPending') : t('saveError') }); }
    setBusy(false);
  };
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-surface-2 p-2.5">
      <label className="w-24"><span className="mb-1 block text-xs text-muted">USD</span><input type="number" min={0.5} step="0.5" className={clsx(input, 'bg-surface py-1.5')} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="min-w-0 flex-1 basis-40"><span className="mb-1 block text-xs text-muted">{t('reason')}</span><input className={clsx(input, 'bg-surface py-1.5')} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPh')} /></label>
      <button type="button" onClick={send} disabled={busy || !(Number(amount) > 0)} className={btnPrimary}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('send')}</button>
    </div>
  );
}
