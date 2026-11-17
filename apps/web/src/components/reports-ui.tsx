'use client';
// Reports: meta, value labels, a report viewer (filters, chart, table, actions) and dashboard widgets.
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, Download, LayoutDashboard, Loader2, Printer, Save, Settings2, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Dialog } from './customer-dialogs';
import { useToast } from './providers';
import { appConfirm } from './confirm';
import { ReportChart, ReportTable, resultCsv, type Chart, type ReportResult } from './report-chart';

type L10n = { el: string; en: string };
export type Definition = {
  source: string; measure: string; group: string; period: { preset: string; from?: string; to?: string }; compare: boolean;
  filters: { owner?: string; status?: string; category?: string; region?: string }; limit: number; chart: Chart;
};
export type Saved = { id: string; name: string; description: string | null; definition: Definition; scope: 'private' | 'role' | 'organization'; role_key: string | null;
  schedule: { freq: 'daily' | 'weekly' | 'monthly'; weekday?: number; day?: number; hour: number; recipients: string[] } | null; next_run_at: string | null; owner_name: string | null; mine: boolean };
export type ReportsMeta = {
  catalogue: Record<string, { label: L10n; filters: string[]; measures: Record<string, { label: L10n; money: boolean; pct: boolean }>; dims: Record<string, { label: L10n; time: boolean }> }>;
  presets: { key: string; group: string; name: L10n; definition: Definition }[]; saved: Saved[];
  users: { id: string; full_name: string }[]; roles: { key: string; name: string }[]; categories: string[]; regions: string[]; can: { share: boolean }; me: string;
};
export const PERIODS = ['7d', '30d', '90d', 'month', 'last_month', 'quarter', 'year', 'last_year', 'all', 'custom'] as const;

export const useReportsMeta = () => useQuery({ queryKey: ['reports', 'meta'], queryFn: () => api<ReportsMeta>('/reports/meta'), staleTime: 120_000 });
export const useRunReport = (def: Definition | null) => useQuery({
  queryKey: ['reports', 'run', def], enabled: !!def, staleTime: 60_000,
  queryFn: () => api<ReportResult>('/reports/run', { method: 'POST', json: { definition: def } }),
});
export const pick = (l: L10n | undefined, locale: string) => (l ? (locale === 'en' ? l.en : l.el) : '');

/** Human labels for grouped values (statuses, months, priorities…). */
export function useValueLabel(def: Definition | null) {
  const locale = useLocale();
  const ts = useTranslations('status');
  const tc = useTranslations('crm');
  const tt = useTranslations('tasks');
  const tcu = useTranslations('customer');
  const tf = useTranslations('cform');
  return (v: string) => {
    if (!def) return v;
    if (def.group === 'status') {
      if (def.source === 'activities' && tc.has(`st_${v}`)) return tc(`st_${v}` as never);
      if (def.source === 'tasks' && tt.has(`st_${v}`)) return tt(`st_${v}` as never);
      if (def.source === 'stores') return v === 'active' ? ts('active') : v === 'inactive' ? ts('inactive') : v;
      if (ts.has(v)) return ts(v as never);
    }
    if (def.group === 'priority' && tc.has(`prio_${v}`)) return tc(`prio_${v}` as never);
    if (def.group === 'seasonality' && tcu.has(`seasons.${v}`)) return tcu(`seasons.${v}` as never);
    if (def.group === 'kind' && tf.has(v)) return tf(v as never);
    if (def.group === 'month' && /^\d{4}-\d{2}$/.test(v)) return new Date(`${v}-15`).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
    if (def.group === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    return v;
  };
}

const sel = 'h-10 rounded-xl border border-border bg-surface px-3 text-sm';

/** Filter bar + chart + table + actions for one definition. */
export function ReportView({ title, def, setDef, saved, onSaved }: { title: string; def: Definition; setDef: (d: Definition) => void; saved?: Saved; onSaved?: (id: string | null) => void }) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useReportsMeta();
  const res = useRunReport(def);
  const label = useValueLabel(def);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const src = meta.data?.catalogue[def.source];
  const setF = (k: keyof Definition['filters'], v: string) => setDef({ ...def, filters: { ...def.filters, [k]: v || undefined } });
  const addToDashboard = async () => {
    const cur = (await api<{ widgets: { id: string; kind: string; ref: string; size: string }[] }>('/reports/dashboard')).widgets;
    const w = saved ? { kind: 'saved', ref: saved.id } : null;
    if (!w) { toast({ title: t('saveFirst') }); setSaving(true); return; }
    if (cur.some((x) => x.ref === w.ref)) { toast({ title: t('alreadyOnDashboard') }); return; }
    await api('/reports/dashboard', { method: 'PUT', json: { widgets: [...cur, { id: Math.random().toString(36).slice(2, 10), ...w, size: def.chart === 'kpi' ? 'sm' : 'md' }] } });
    qc.invalidateQueries({ queryKey: ['reports', 'dashboard'] });
    toast({ title: t('addedToDashboard') });
  };
  const exportCsv = () => {
    if (!res.data) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultCsv(res.data, label, title)); a.download = `${title.replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`; a.click();
  };
  const period = res.data?.period;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select className={sel} value={def.period.preset} onChange={(e) => setDef({ ...def, period: { preset: e.target.value } })} aria-label={t('period')}>
          {PERIODS.map((p) => <option key={p} value={p}>{t(`p_${p}`)}</option>)}
        </select>
        {def.period.preset === 'custom' && (
          <>
            <input type="date" className={sel} value={def.period.from ?? ''} onChange={(e) => setDef({ ...def, period: { ...def.period, from: e.target.value } })} />
            <input type="date" className={sel} value={def.period.to ?? ''} onChange={(e) => setDef({ ...def, period: { ...def.period, to: e.target.value } })} />
          </>
        )}
        <label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm">
          <input type="checkbox" className="accent-[var(--primary)]" checked={def.compare} disabled={def.period.preset === 'all'} onChange={(e) => setDef({ ...def, compare: e.target.checked })} /> {t('compare')}
        </label>
        <select className={sel} value={def.filters.owner ?? ''} onChange={(e) => setF('owner', e.target.value)} aria-label={t('owner')}>
          <option value="">{t('allUsers')}</option>{meta.data?.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        {src?.filters.includes('category') && !!meta.data?.categories.length && (
          <select className={sel} value={def.filters.category ?? ''} onChange={(e) => setF('category', e.target.value)} aria-label={t('category')}>
            <option value="">{t('allCategories')}</option>{meta.data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {src?.filters.includes('region') && !!meta.data?.regions.length && (
          <select className={sel} value={def.filters.region ?? ''} onChange={(e) => setF('region', e.target.value)} aria-label={t('region')}>
            <option value="">{t('allRegions')}</option>{meta.data.regions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <span className="flex-1" />
        <button onClick={() => setBuilding(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface" aria-label={t('customise')} title={t('customise')}><Settings2 size={16} /></button>
        <button onClick={() => setSaving(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface" aria-label={t('save')} title={t('save')}><Save size={16} /></button>
        <button onClick={addToDashboard} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface" aria-label={t('addToDashboard')} title={t('addToDashboard')}><LayoutDashboard size={16} /></button>
        <button onClick={exportCsv} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface" aria-label="CSV" title="CSV"><Download size={16} /></button>
        <button onClick={() => window.print()} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface" aria-label={t('print')} title={t('print')}><Printer size={16} /></button>
      </div>

      <section className="card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-bold">{title}</h2>
          <span className="text-sm text-muted">{pick(src?.measures[def.measure]?.label, locale)}{def.group !== 'none' ? ` · ${pick(src?.dims[def.group]?.label, locale)}` : ''}</span>
          {period && <span className="text-xs text-muted">{period.from ? new Date(period.from).toLocaleDateString(locale) : t('since')} – {new Date(new Date(period.to).getTime() - 1).toLocaleDateString(locale)}</span>}
        </div>
        {res.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-muted" /></div>
          : res.isError ? <p className="text-danger">{t('error')}</p>
            : res.data && (
              <div className="space-y-5">
                {def.chart !== 'kpi' && <ReportChart r={{ ...res.data, rows: [] }} chart="kpi" label={label} compact />}
                <ReportChart r={res.data} chart={def.chart} label={label} />
              </div>
            )}
      </section>
      {res.data && def.chart !== 'table' && res.data.rows.length > 0 && (
        <details className="card p-4 print:block" open={false}>
          <summary className="cursor-pointer text-sm font-semibold print:hidden">{t('tableView')}</summary>
          <div className="mt-3"><ReportTable r={res.data} label={label} /></div>
        </details>
      )}
      {res.data && <p className="text-right text-[11px] text-muted print:hidden">{t('generated', { d: new Date(res.data.generated_at).toLocaleTimeString(locale) })}</p>}
      {building && <BuilderDialog def={def} onApply={(d) => { setDef(d); setBuilding(false); }} onClose={() => setBuilding(false)} />}
      {saving && <SaveDialog def={def} saved={saved} defaultName={title} onClose={() => setSaving(false)} onSaved={(id) => { setSaving(false); onSaved?.(id); }} />}
    </div>
  );
}

/** Report builder: source, measure, grouping, chart, top N. */
export function BuilderDialog({ def, onApply, onClose }: { def: Definition; onApply: (d: Definition) => void; onClose: () => void }) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const meta = useReportsMeta();
  const [d, setD] = useState(def);
  const cat = meta.data?.catalogue ?? {};
  const src = cat[d.source];
  const setSource = (s: string) => setD({ ...d, source: s, measure: Object.keys(cat[s].measures)[0], group: 'none', filters: {} });
  const timeGroup = d.group !== 'none' && src?.dims[d.group]?.time;
  const charts: Chart[] = d.group === 'none' ? ['kpi'] : timeGroup ? ['column', 'line', 'table'] : ['bar', 'table'];
  const fix = (x: Definition) => ({ ...x, chart: (charts.includes(x.chart) ? x.chart : charts[0]) as Chart });
  const input = 'w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm';
  return (
    <Dialog title={t('customise')} onClose={onClose}>
      {!src ? <Loader2 className="mx-auto animate-spin text-muted" /> : (
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs text-muted">{t('source')}</span>
            <select className={input} value={d.source} onChange={(e) => setSource(e.target.value)}>{Object.entries(cat).map(([k, s]) => <option key={k} value={k}>{pick(s.label, locale)}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs text-muted">{t('measure')}</span>
            <select className={input} value={d.measure} onChange={(e) => setD({ ...d, measure: e.target.value })}>{Object.entries(src.measures).map(([k, m]) => <option key={k} value={k}>{pick(m.label, locale)}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs text-muted">{t('groupBy')}</span>
            <select className={input} value={d.group} onChange={(e) => setD({ ...d, group: e.target.value })}>
              <option value="none">{t('noGroup')}</option>{Object.entries(src.dims).map(([k, m]) => <option key={k} value={k}>{pick(m.label, locale)}</option>)}
            </select></label>
          <div><span className="mb-1 block text-xs text-muted">{t('chart')}</span>
            <div className="flex flex-wrap gap-1.5">
              {charts.map((c) => <button key={c} type="button" onClick={() => setD({ ...d, chart: c })} className={clsx('rounded-full border px-3 py-1.5 text-sm', fix(d).chart === c ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-border')}>{t(`ch_${c}`)}</button>)}
            </div></div>
          {d.group !== 'none' && !timeGroup && (
            <label className="block"><span className="mb-1 block text-xs text-muted">{t('topN')}</span>
              <input type="number" min={1} max={200} className={input} value={d.limit} onChange={(e) => setD({ ...d, limit: Math.max(1, Math.min(200, Number(e.target.value) || 20)) })} /></label>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('cancel')}</button>
            <button onClick={() => onApply(fix(d))} className="rounded-xl bg-primary px-5 py-2.5 font-semibold text-white">{t('apply')}</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Save as / update, share with a role or the organisation, e-mail schedule. */
export function SaveDialog({ def, saved, defaultName, onClose, onSaved }: { def: Definition; saved?: Saved; defaultName: string; onClose: () => void; onSaved: (id: string | null) => void }) {
  const t = useTranslations('reports');
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useReportsMeta();
  const [name, setName] = useState(saved?.name ?? defaultName);
  const [scope, setScope] = useState(saved?.scope ?? 'private');
  const [role, setRole] = useState(saved?.role_key ?? '');
  const [sched, setSched] = useState(saved?.schedule ?? null);
  const own = !saved || saved.mine || meta.data?.can.share;
  const body = (asNew: boolean) => ({ name: name.trim(), definition: def, scope, role_key: scope === 'role' ? role || meta.data?.roles[0]?.key : null, schedule: sched, asNew });
  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      const b = body(asNew);
      if (saved && !asNew) { await api(`/reports/saved/${saved.id}`, { method: 'PUT', json: b }); return saved.id; }
      return (await api<{ id: string }>('/reports/saved', { method: 'POST', json: b })).id;
    },
    onSuccess: (id) => { toast({ title: t('saved') }); qc.invalidateQueries({ queryKey: ['reports'] }); onSaved(id); },
    onError: (e) => toast({ title: t('saveError'), body: e instanceof ApiError ? e.code : undefined }),
  });
  const del = async () => {
    if (!saved || !(await appConfirm(t('deleteConfirm', { name: saved.name }), { danger: true }))) return;
    await api(`/reports/saved/${saved.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['reports'] }); onSaved(null);
  };
  const input = 'w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm';
  return (
    <Dialog title={saved ? t('saveTitleEdit') : t('saveTitle')} onClose={onClose}>
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs text-muted">{t('name')}</span><input className={input} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
        <div><span className="mb-1 block text-xs text-muted">{t('visibility')}</span>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
            {(['private', 'role', 'organization'] as const).map((s) => (
              <button key={s} type="button" disabled={s !== 'private' && !meta.data?.can.share} onClick={() => setScope(s)}
                className={clsx('rounded-lg py-2 text-sm font-medium disabled:opacity-40', scope === s ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t(`sc_${s}`)}</button>
            ))}
          </div>
          {scope === 'role' && <select className={clsx(input, 'mt-2')} value={role || meta.data?.roles[0]?.key} onChange={(e) => setRole(e.target.value)}>{meta.data?.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>}
        </div>
        <div className="rounded-2xl border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={!!sched}
            onChange={(e) => setSched(e.target.checked ? { freq: 'weekly', weekday: 1, hour: 8, recipients: meta.data ? [meta.data.me] : [] } : null)} /><CalendarClock size={15} /> {t('schedule')}</label>
          {sched && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <select className={input} value={sched.freq} onChange={(e) => setSched({ ...sched, freq: e.target.value as 'daily' })}>{['daily', 'weekly', 'monthly'].map((f) => <option key={f} value={f}>{t(`f_${f}`)}</option>)}</select>
                {sched.freq === 'weekly' && <select className={input} value={sched.weekday ?? 1} onChange={(e) => setSched({ ...sched, weekday: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{new Date(2024, 0, d).toLocaleDateString(undefined, { weekday: 'long' })}</option>)}</select>}
                {sched.freq === 'monthly' && <select className={input} value={sched.day ?? 1} onChange={(e) => setSched({ ...sched, day: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}</select>}
                <select className={input} value={sched.hour} onChange={(e) => setSched({ ...sched, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {meta.data?.users.map((u) => { const on = sched.recipients.includes(u.id); return (
                  <button key={u.id} type="button" onClick={() => setSched({ ...sched, recipients: on ? sched.recipients.filter((x) => x !== u.id) : [...sched.recipients, u.id] })}
                    className={clsx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>{u.full_name}</button>
                ); })}
              </div>
              <p className="text-xs text-muted">{t('scheduleHint')}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {saved && own && <button onClick={del} className="grid h-10 w-10 place-items-center rounded-xl text-danger hover:bg-danger-soft" aria-label={t('delete')}><Trash2 size={17} /></button>}
          <span className="flex-1" />
          {saved && <button disabled={!name.trim() || save.isPending} onClick={() => save.mutate(true)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">{t('saveAsNew')}</button>}
          <button disabled={!name.trim() || save.isPending || (sched !== null && !sched.recipients.length) || !own} onClick={() => save.mutate(false)}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">{save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {t('save')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** Home dashboard: the user's report widgets. */
export function DashboardWidgets() {
  const t = useTranslations('reports');
  const locale = useLocale();
  const qc = useQueryClient();
  const meta = useReportsMeta();
  const dash = useQuery({ queryKey: ['reports', 'dashboard'], queryFn: () => api<{ widgets: { id: string; kind: 'preset' | 'saved'; ref: string; size: 'sm' | 'md' | 'lg' }[] }>('/reports/dashboard') });
  const widgets = dash.data?.widgets ?? [];
  const remove = async (id: string) => {
    await api('/reports/dashboard', { method: 'PUT', json: { widgets: widgets.filter((w) => w.id !== id) } });
    qc.invalidateQueries({ queryKey: ['reports', 'dashboard'] });
  };
  const resize = async (id: string) => {
    const order = ['sm', 'md', 'lg'] as const;
    await api('/reports/dashboard', { method: 'PUT', json: { widgets: widgets.map((w) => (w.id === id ? { ...w, size: order[(order.indexOf(w.size) + 1) % 3] } : w)) } });
    qc.invalidateQueries({ queryKey: ['reports', 'dashboard'] });
  };
  if (!widgets.length || !meta.data) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t('myDashboard')}</h2><a href={`/${locale}/reports`} className="text-sm font-medium text-primary">{t('allReports')}</a></div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        {widgets.map((w) => {
          const p = w.kind === 'preset' ? meta.data!.presets.find((x) => x.key === w.ref) : null;
          const s = w.kind === 'saved' ? meta.data!.saved.find((x) => x.id === w.ref) : null;
          const def = p?.definition ?? s?.definition;
          if (!def) return null;
          return <Widget key={w.id} title={p ? pick(p.name, locale) : s!.name} def={def} size={w.size} href={`/${locale}/reports?${p ? `preset=${p.key}` : `saved=${s!.id}`}`} onRemove={() => remove(w.id)} onResize={() => resize(w.id)} />;
        })}
      </div>
    </section>
  );
}

function Widget({ title, def, size, href, onRemove, onResize }: { title: string; def: Definition; size: 'sm' | 'md' | 'lg'; href: string; onRemove: () => void; onResize: () => void }) {
  const t = useTranslations('reports');
  const res = useRunReport(def);
  const label = useValueLabel(def);
  return (
    <section className={clsx('card group p-4', size === 'sm' ? 'md:col-span-2' : size === 'md' ? 'md:col-span-3' : 'md:col-span-6')}>
      <header className="mb-2 flex items-center gap-2">
        <a href={href} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-primary">{title}</a>
        <button onClick={onResize} className="hidden h-6 rounded px-1.5 text-[11px] text-muted hover:bg-surface-2 group-hover:block">{t(`size_${size}`)}</button>
        <button onClick={onRemove} className="hidden text-muted hover:text-danger group-hover:block" aria-label={t('remove')}><X size={14} /></button>
      </header>
      {res.data ? <ReportChart r={res.data} chart={def.chart} label={label} compact /> : <div className="grid h-24 place-items-center"><Loader2 className="animate-spin text-muted" /></div>}
    </section>
  );
}

export { useMemo };
