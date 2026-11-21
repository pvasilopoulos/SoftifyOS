'use client';
// Settings → ERP (SoftOne Soft1): connection, field mapping, value mapping, the two ERP lists, sync settings and log.
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle, ArrowDownUp, CheckCircle2, ChevronDown, Database, Eye, Info, Loader2, Plug, Plus, RefreshCw, Save, Search, Trash2, Wand2, XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ActivityStatus, ErpValue } from '@/lib/crm';
import { appConfirm } from './confirm';
import { useToast } from './providers';

type Fields = Record<'code' | 'series' | 'date' | 'start' | 'end' | 'customer' | 'branch' | 'requester' | 'owner' | 'subject' | 'remarks' | 'characterization' | 'status' | 'priority' | 'updated', string>;
type ListSrc = { object: string; code: string; name: string; active: string };
type Meta = {
  enabled: boolean; direction: 'both' | 'pull' | 'push'; conflict: 'newest' | 'erp' | 'softify'; interval_min: number; window_days: number;
  object: string; table: string; list: string; filter: string; reconcile_filter: string; fields: Fields; customer_match: 'external_id' | 'code';
  series_map: Record<string, string>; default_series: string; default_type: string; users_map: Record<string, string>; priority_map: Record<string, number>;
  lists: { characterization: ListSrc; status: ListSrc };
  last_pull_at?: string | null; last_push_at?: string | null; last_ok_at?: string | null; last_error?: string | null; connected?: { company: string; at: string } | null;
};
type Conn = { url: string; username: string; app_id: string; company: string; branch: string; module: string; refid: string; has_password: boolean };
type LogRow = { at: string; level: 'info' | 'warning' | 'error'; action: string; external_id: string | null; message: string };
type ErpData = {
  meta: Meta; connection: Conn | null; values: ErpValue[]; types: { key: string; name: string; active: boolean }[];
  users: { id: string; full_name: string; email: string }[]; stats: { pending: number; errors: number; skipped: number; synced: number };
  queued: string[]; log: LogRow[];
};
type Preview = { key: string; action: 'create' | 'update' | 'skip'; erp_code: string | null; subject: string; customer_id: string | null; customer_label: string | null; due_at: string | null; problems: string[] };

const FIELD_KEYS: (keyof Fields)[] = ['code', 'series', 'date', 'start', 'end', 'customer', 'branch', 'requester', 'owner', 'subject', 'remarks', 'characterization', 'status', 'priority', 'updated'];
const STATUSES: ActivityStatus[] = ['planned', 'in_progress', 'done', 'cancelled'];
const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';
const btn = 'flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium hover:border-primary disabled:opacity-60';
const btnPrimary = 'flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60';

export function ErpSettingsSection() {
  const t = useTranslations('erp');
  const q = useQuery({ queryKey: ['settings', 'erp'], queryFn: () => api<ErpData>('/settings/erp'), refetchInterval: (x) => (x.state.data?.queued.length ? 2000 : 20_000) });
  if (q.isError) return <p className="text-sm text-muted">{t('noAccess')}</p>;
  if (!q.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  return <ErpBody key={JSON.stringify(q.data.meta.fields) + (q.data.connection?.url ?? '')} data={q.data} />;
}

function ErpBody({ data }: { data: ErpData }) {
  const t = useTranslations('erp');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const reload = () => qc.invalidateQueries({ queryKey: ['settings', 'erp'] });
  const [m, setM] = useState<Meta>(data.meta);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const patch = (p: Partial<Meta>) => { setM((x) => ({ ...x, ...p })); setDirty(true); };
  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—');

  const saveSettings = async (extra?: Partial<Meta>) => {
    setBusy('settings');
    const { last_pull_at: _a, last_push_at: _b, last_ok_at: _c, last_error: _d, connected: _e, ...body } = { ...m, ...extra } as Meta & Record<string, unknown>;
    delete (body as Record<string, unknown>).provider; delete (body as Record<string, unknown>).last_reconcile_at;
    try { await api('/settings/erp/settings', { method: 'PUT', json: body }); setDirty(false); if (extra) setM((x) => ({ ...x, ...extra })); toast({ title: t('saved') }); reload(); }
    catch { toast({ title: t('saveError') }); }
    setBusy(null);
  };
  const sync = async (what: 'pull' | 'push' | 'lists' | 'full') => {
    setBusy(`sync-${what}`);
    try { await api('/settings/erp/sync', { method: 'POST', json: { what } }); toast({ title: t('syncQueued') }); reload(); }
    catch { toast({ title: t('syncError') }); }
    setBusy(null);
  };

  const connected = !!data.connection;
  const state = !connected ? 'none' : !data.meta.enabled ? 'off' : data.meta.last_error ? 'error' : 'on';
  return (
    <div className="@container space-y-4">
      {/* ---------------------------------------------------------------- status */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5">
          <div className={clsx('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', {
            'bg-surface-2 text-muted': state === 'none' || state === 'off', 'bg-success-soft text-success': state === 'on', 'bg-danger-soft text-danger': state === 'error',
          })}><ArrowDownUp size={22} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight">{t(`state_${state}`)}</h2>
            <p className="text-sm text-muted">
              SoftOne Soft1{data.meta.connected?.company ? ` · ${data.meta.connected.company}` : ''}
              {connected && <> · {t('lastPull', { when: when(data.meta.last_pull_at) })}</>}
            </p>
          </div>
          {connected && (
            <div className="flex w-full flex-wrap items-center gap-2 @lg:w-auto">
              <label className="flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={m.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} /> {t('enabled')}
              </label>
              <button type="button" onClick={() => sync('full')} disabled={!!busy || data.queued.length > 0} className={clsx(btnPrimary, 'h-10 flex-1 @lg:flex-none')}>
                {data.queued.length ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {data.queued.length ? t('running') : t('syncNow')}
              </button>
            </div>
          )}
        </div>
        {data.meta.last_error && <p className="mx-4 mb-4 rounded-xl bg-danger-soft p-3 text-sm text-danger sm:mx-5 [overflow-wrap:anywhere]">{data.meta.last_error}</p>}
        {connected && (
          <dl className="grid grid-cols-2 border-t border-border @2xl:grid-cols-4">
            {([['synced', 'text-success'], ['pending', 'text-info'], ['errors', 'text-danger'], ['skipped', 'text-muted']] as const).map(([k, c], i) => (
              <div key={k} className={clsx('p-4 sm:px-5', i % 2 === 0 && 'border-r border-border', i < 2 && 'border-b border-border @2xl:border-b-0', i === 1 && '@2xl:border-r')}>
                <dt className="text-xs text-muted">{t(`st_${k}`)}</dt>
                <dd className={clsx('text-xl font-bold tabular', data.stats[k] > 0 && c)}>{data.stats[k].toLocaleString(locale)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <ConnectionCard conn={data.connection} onSaved={reload} />

      {connected && (
        <>
          <Card title={t('syncTitle')} hint={t('syncHint')} icon={<RefreshCw size={16} />}>
            <div className="grid gap-3 @xl:grid-cols-2">
              <Field label={t('direction')}>
                <select className={input} value={m.direction} onChange={(e) => patch({ direction: e.target.value as Meta['direction'] })}>
                  {(['both', 'pull', 'push'] as const).map((d) => <option key={d} value={d}>{t(`dir_${d}`)}</option>)}
                </select>
              </Field>
              <Field label={t('conflict')} help={t('conflictHelp')}>
                <select className={input} value={m.conflict} onChange={(e) => patch({ conflict: e.target.value as Meta['conflict'] })}>
                  {(['newest', 'erp', 'softify'] as const).map((d) => <option key={d} value={d}>{t(`conf_${d}`)}</option>)}
                </select>
              </Field>
              <Field label={t('interval')}><input type="number" min={1} max={1440} className={input} value={m.interval_min} onChange={(e) => patch({ interval_min: Number(e.target.value) })} /></Field>
              <Field label={t('window')} help={t('windowHelp')}><input type="number" min={7} max={3650} className={input} value={m.window_days} onChange={(e) => patch({ window_days: Number(e.target.value) })} /></Field>
            </div>
          </Card>

          <MappingCard m={m} patch={patch} />
          <ValuesCard m={m} patch={patch} types={data.types} users={data.users} />

          <div className="sticky bottom-3 z-10 flex justify-end">
            <button type="button" onClick={() => saveSettings()} disabled={!dirty || busy === 'settings'} className={clsx(btnPrimary, 'shadow-lg', !dirty && 'hidden')}>
              {busy === 'settings' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {t('saveSettings')}
            </button>
          </div>

          <ListsCard values={data.values} src={m.lists} types={data.types} onSrc={(lists) => patch({ lists })} onSync={() => sync('lists')} busy={busy === 'sync-lists'} onSaved={reload} />
          <PreviewCard />
          <LogCard log={data.log} />
        </>
      )}
      {!connected && <p className="flex items-start gap-2 rounded-xl bg-info-soft p-3 text-sm text-info"><Info size={16} className="mt-0.5 shrink-0" /> {t('startHint')}</p>}
    </div>
  );

}

// ---------------------------------------------------------------- building blocks
function Card({ title, hint, icon, children, action, defaultOpen = true }: { title: string; hint?: string; icon?: ReactNode; children: ReactNode; action?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
          {icon && <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">{icon}</span>}
          <span className="min-w-0">
            <span className="block text-base font-semibold">{title}</span>
            {hint && <span className="block text-sm text-muted">{hint}</span>}
          </span>
        </button>
        {action}
        <button type="button" onClick={() => setOpen(!open)} aria-label="toggle" className="mt-1 text-muted"><ChevronDown size={18} className={clsx('transition', open && 'rotate-180')} /></button>
      </div>
      {open && <div className="mt-4">{children}</div>}
    </section>
  );
}
function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-muted">{help}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- connection
function ConnectionCard({ conn, onSaved }: { conn: Conn | null; onSaved: () => void }) {
  const t = useTranslations('erp');
  const toast = useToast();
  const [v, setV] = useState({ url: conn?.url ?? '', username: conn?.username ?? '', password: '', app_id: conn?.app_id ?? '', company: conn?.company ?? '', branch: conn?.branch ?? '', module: conn?.module ?? '', refid: conn?.refid ?? '' });
  const [adv, setAdv] = useState(!!(conn?.company || conn?.branch));
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [res, setRes] = useState<{ ok: boolean; company?: string; error?: string; companies?: { company: string; company_name: string; branch: string; branch_name: string; module: string; refid: string }[] } | null>(null);
  const set = (k: keyof typeof v, x: string) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    setBusy('save');
    try { await api('/settings/erp/connection', { method: 'PUT', json: v }); toast({ title: t('saved') }); setV((o) => ({ ...o, password: '' })); onSaved(); }
    catch { toast({ title: t('saveError') }); }
    setBusy(null);
  };
  const test = async () => {
    setBusy('test'); setRes(null);
    try { setRes(await api('/settings/erp/test', { method: 'POST', json: v })); } catch { setRes({ ok: false, error: t('saveError') }); }
    setBusy(null);
  };
  const remove = async () => {
    if (!(await appConfirm(t('confirmRemove'), { danger: true }))) return;
    setBusy('remove'); await api('/settings/erp', { method: 'DELETE' }); setBusy(null); onSaved();
  };
  return (
    <Card title={t('connTitle')} hint={t('connHint')} icon={<Plug size={16} />} defaultOpen={!conn}>
      <div className="grid gap-3 @xl:grid-cols-2">
        <div className="@xl:col-span-2"><Field label={t('url')} help={t('urlHelp')}><input className={input} value={v.url} onChange={(e) => set('url', e.target.value)} placeholder="https://xxxxx.oncloud.gr" autoComplete="off" /></Field></div>
        <Field label={t('username')}><input className={input} value={v.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></Field>
        <Field label={t('password')}><input type="password" className={input} value={v.password} onChange={(e) => set('password', e.target.value)} placeholder={conn?.has_password ? t('passwordKept') : ''} autoComplete="new-password" /></Field>
        <Field label="AppId" help={t('appIdHelp')}><input className={input} value={v.app_id} onChange={(e) => set('app_id', e.target.value)} autoComplete="off" /></Field>
      </div>
      <button type="button" onClick={() => setAdv(!adv)} className="mt-3 flex items-center gap-1 text-sm font-medium text-primary"><ChevronDown size={15} className={clsx('transition', adv && 'rotate-180')} /> {t('advanced')}</button>
      {adv && (
        <div className="mt-3 grid grid-cols-2 gap-3 @xl:grid-cols-4">
          {(['company', 'branch', 'module', 'refid'] as const).map((k) => <Field key={k} label={t(k)}><input className={input} value={v[k]} onChange={(e) => set(k, e.target.value)} /></Field>)}
        </div>
      )}
      {res && (
        <div className={clsx('mt-3 rounded-xl p-3 text-sm', res.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
          {res.ok ? t('testOk', { company: res.company || '—' }) : res.error}
          {res.ok && res.companies && res.companies.length > 1 && (
            <ul className="mt-2 space-y-1 text-xs text-text">
              {res.companies.map((c) => (
                <li key={`${c.company}-${c.branch}-${c.refid}`}>
                  <button type="button" className="underline" onClick={() => { setV((o) => ({ ...o, company: c.company, branch: c.branch, module: c.module, refid: c.refid })); setAdv(true); }}>
                    {c.company_name || c.company} · {c.branch_name || c.branch}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {conn && <button type="button" onClick={remove} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft"><Trash2 size={15} /> {t('remove')}</button>}
        <span className="flex-1" />
        <button type="button" onClick={test} disabled={!!busy} className={btn}>{busy === 'test' ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />} {t('test')}</button>
        <button type="button" onClick={save} disabled={!!busy || !v.url || !v.username || !v.app_id || (!conn?.has_password && !v.password)} className={btnPrimary}>
          {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {t('saveConn')}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- field mapping
function MappingCard({ m, patch }: { m: Meta; patch: (p: Partial<Meta>) => void }) {
  const t = useTranslations('erp');
  const [fields, setFields] = useState<{ name: string; caption: string }[]>([]);
  const [busy, setBusy] = useState<'fields' | 'sample' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sample, setSample] = useState<{ key: string; raw: Record<string, unknown>; mapped: Preview & Record<string, unknown> } | null>(null);
  const discover = async () => {
    setBusy('fields'); setErr(null);
    const r = await api<{ ok: boolean; fields?: { name: string; caption: string }[]; error?: string }>(`/settings/erp/fields?object=${m.object}&table=${m.table}`).catch(() => ({ ok: false, error: t('saveError') }));
    if (r.ok && 'fields' in r && r.fields) setFields(r.fields); else setErr(r.error ?? null);
    setBusy(null);
  };
  const loadSample = async () => {
    setBusy('sample'); setErr(null);
    const r = await api<{ ok: boolean; key?: string; raw?: Record<string, unknown>; mapped?: Preview & Record<string, unknown>; error?: string }>('/settings/erp/sample').catch(() => ({ ok: false, error: t('saveError') }));
    if (r.ok && 'raw' in r && r.raw) setSample({ key: r.key!, raw: r.raw, mapped: r.mapped! }); else setErr(r.error ?? null);
    setBusy(null);
  };
  const setField = (k: keyof Fields, v: string) => patch({ fields: { ...m.fields, [k]: v.trim().toUpperCase() } });
  return (
    <Card title={t('mapTitle')} hint={t('mapHint')} icon={<Database size={16} />} defaultOpen={false}>
      <div className="grid gap-3 @xl:grid-cols-3">
        <Field label={t('object')}><input className={input} value={m.object} onChange={(e) => patch({ object: e.target.value.trim().toUpperCase() })} /></Field>
        <Field label={t('table')}><input className={input} value={m.table} onChange={(e) => patch({ table: e.target.value.trim().toUpperCase() })} /></Field>
        <Field label={t('list')} help={t('listHelp')}><input className={input} value={m.list} onChange={(e) => patch({ list: e.target.value })} /></Field>
        <div className="@xl:col-span-3"><Field label={t('filter')} help={t('filterHelp')}><input className={clsx(input, 'font-mono')} value={m.filter} onChange={(e) => patch({ filter: e.target.value })} /></Field></div>
        <div className="@xl:col-span-3"><Field label={t('reconcileFilter')} help={t('reconcileHelp')}><input className={clsx(input, 'font-mono')} value={m.reconcile_filter} onChange={(e) => patch({ reconcile_filter: e.target.value })} /></Field></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h4 className="flex-1 text-sm font-semibold">{t('fieldsTitle')}</h4>
        <button type="button" onClick={discover} disabled={!!busy} className={btn}>{busy === 'fields' ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} {t('discover')}</button>
        <button type="button" onClick={loadSample} disabled={!!busy} className={btn}>{busy === 'sample' ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} {t('sample')}</button>
      </div>
      {err && <p className="mt-2 rounded-xl bg-danger-soft p-2.5 text-sm text-danger">{err}</p>}
      {fields.length > 0 && <p className="mt-2 text-xs text-success">{t('discovered', { n: fields.length })}</p>}
      <datalist id="erp-fields">{fields.map((f) => <option key={f.name} value={f.name}>{f.caption}</option>)}</datalist>
      <div className="mt-3 grid gap-x-4 gap-y-2 @xl:grid-cols-2">
        {FIELD_KEYS.map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-36 shrink-0 text-sm">{t(`f_${k}`)}</span>
            <input list="erp-fields" className={clsx(input, 'font-mono')} value={m.fields[k]} placeholder={t('notMapped')} onChange={(e) => setField(k, e.target.value)} />
            {sample && m.fields[k] && <span className="hidden w-32 shrink-0 truncate text-xs text-muted @3xl:block" title={String(sample.raw[m.fields[k]] ?? '')}>{String(sample.raw[m.fields[k]] ?? '∅')}</span>}
          </div>
        ))}
      </div>
      {sample && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
          <div className="mb-2 font-semibold">{t('sampleOf', { key: sample.key })}</div>
          <dl className="grid gap-x-4 gap-y-1 @xl:grid-cols-2">
            {(['erp_code', 'subject', 'type', 'due_at', 'ends_at', 'customer_label', 'characterization', 'erp_status', 'priority'] as const).map((k) => (
              <div key={k} className="flex gap-2"><dt className="w-32 shrink-0 text-muted">{t(`s_${k}`)}</dt><dd className="min-w-0 truncate">{String(sample.mapped[k] ?? '—')}</dd></div>
            ))}
          </dl>
          {sample.mapped.problems?.length > 0 && <p className="mt-2 text-warning">{sample.mapped.problems.join(' · ')}</p>}
          {!sample.mapped.customer_id && <p className="mt-2 text-danger">{t('sampleNoCustomer')}</p>}
        </div>
      )}
      <div className="mt-4 grid gap-3 @xl:grid-cols-2">
        <Field label={t('customerMatch')} help={t('customerMatchHelp')}>
          <select className={input} value={m.customer_match} onChange={(e) => patch({ customer_match: e.target.value as Meta['customer_match'] })}>
            <option value="external_id">{t('cm_external_id')}</option><option value="code">{t('cm_code')}</option>
          </select>
        </Field>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- series / users / priority
function MapRows({ rows, onChange, left, right, rightOptions }: {
  rows: [string, string][]; onChange: (r: [string, string][]) => void; left: string; right: string; rightOptions: { value: string; label: string }[];
}) {
  const t = useTranslations('erp');
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_2rem] gap-2 text-xs text-muted"><span>{left}</span><span>{right}</span><span /></div>
      {rows.map(([a, b], i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_2rem] gap-2">
          <input className={clsx(input, 'font-mono')} value={a} onChange={(e) => onChange(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <select className={input} value={b} onChange={(e) => onChange(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}>
            <option value="">—</option>
            {rightOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t('removeRow')} className="grid place-items-center rounded-lg text-danger hover:bg-danger-soft"><Trash2 size={15} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, ['', '']])} className="flex items-center gap-1 text-sm font-medium text-primary"><Plus size={15} /> {t('addRow')}</button>
    </div>
  );
}

function ValuesCard({ m, patch, types, users }: { m: Meta; patch: (p: Partial<Meta>) => void; types: ErpData['types']; users: ErpData['users'] }) {
  const t = useTranslations('erp');
  const tc = useTranslations('crm');
  // Rows are edited locally (empty codes allowed while typing) and written back without the empty ones
  const [series, setSeries] = useState<[string, string][]>(() => Object.entries(m.series_map));
  const [people, setPeople] = useState<[string, string][]>(() => Object.entries(m.users_map));
  const toObj = (r: [string, string][]) => Object.fromEntries(r.filter(([a, b]) => a.trim() && b).map(([a, b]) => [a.trim(), b]));
  const prioOf = (p: number) => Object.entries(m.priority_map).find(([, v]) => v === p)?.[0] ?? '';
  const setPrio = (p: number, code: string) => {
    const next = Object.fromEntries(Object.entries(m.priority_map).filter(([, v]) => v !== p));
    if (code.trim()) next[code.trim()] = p;
    patch({ priority_map: next });
  };
  const typeOpts = types.filter((x) => x.active).map((x) => ({ value: x.key, label: x.name }));
  return (
    <Card title={t('valuesTitle')} hint={t('valuesHint')} icon={<Wand2 size={16} />} defaultOpen={false}>
      <div className="grid gap-6 @3xl:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t('seriesTitle')}</h4>
          <MapRows rows={series} left={t('erpSeries')} right={t('activityType')} rightOptions={typeOpts}
            onChange={(r) => { setSeries(r); patch({ series_map: toObj(r) }); }} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label={t('defaultType')} help={t('defaultTypeHelp')}>
              <select className={input} value={m.default_type} onChange={(e) => patch({ default_type: e.target.value })}>{typeOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </Field>
            <Field label={t('defaultSeries')} help={t('defaultSeriesHelp')}><input className={clsx(input, 'font-mono')} value={m.default_series} onChange={(e) => patch({ default_series: e.target.value.trim() })} /></Field>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t('usersTitle')}</h4>
          <MapRows rows={people} left={t('erpUser')} right={t('softifyUser')} rightOptions={users.map((u) => ({ value: u.id, label: u.full_name }))}
            onChange={(r) => { setPeople(r); patch({ users_map: toObj(r) }); }} />
          <p className="mt-2 text-xs text-muted">{t('usersHelp')}</p>
          <h4 className="mb-2 mt-5 text-sm font-semibold">{t('priorityTitle')}</h4>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((p) => <Field key={p} label={tc(`prio_${p}`)}><input className={clsx(input, 'font-mono')} value={prioOf(p)} onChange={(e) => setPrio(p, e.target.value)} placeholder={t('erpValue')} /></Field>)}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- the two ERP lists
function ListsCard({ values, src, types, onSrc, onSync, busy, onSaved }: {
  values: ErpValue[]; src: Meta['lists']; types: ErpData['types']; onSrc: (l: Meta['lists']) => void; onSync: () => void; busy: boolean; onSaved: () => void;
}) {
  const t = useTranslations('erp');
  const tc = useTranslations('crm');
  const toast = useToast();
  const [kind, setKind] = useState<'characterization' | 'status'>('characterization');
  const [rows, setRows] = useState<ErpValue[]>(() => values.filter((v) => v.kind === kind));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSrc, setShowSrc] = useState(false);
  useEffect(() => { setRows(values.filter((v) => v.kind === kind)); setDirty(false); }, [values, kind]);
  const upd = (i: number, p: Partial<ErpValue>) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x))); setDirty(true); };
  const save = async () => {
    setSaving(true);
    try {
      await api(`/settings/erp/values/${kind}`, { method: 'PUT', json: rows.filter((r) => r.code.trim() && r.name.trim()).map(({ code, name, active, maps_to, types: ty, sort }) => ({ code: code.trim(), name: name.trim(), active, maps_to, types: ty?.length ? ty : null, sort })) });
      toast({ title: t('saved') }); setDirty(false); onSaved();
    } catch { toast({ title: t('saveError') }); }
    setSaving(false);
  };
  const preset = async () => { await api('/settings/erp/values/preset', { method: 'POST' }); toast({ title: t('presetLoaded') }); onSaved(); };
  const s = src[kind];
  return (
    <Card title={t('listsTitle')} hint={t('listsHint')} icon={<Database size={16} />}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {(['characterization', 'status'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={clsx('rounded-lg px-3 py-1 font-medium', kind === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
              {t(`list_${k}`)} <span className="text-xs opacity-70">{values.filter((v) => v.kind === k).length}</span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {!values.length && <button type="button" onClick={preset} className={btn}><Wand2 size={15} /> {t('preset')}</button>}
        <button type="button" onClick={() => setShowSrc(!showSrc)} className={btn}><Search size={15} /> {t('fromSoft1')}</button>
      </div>
      {showSrc && (
        <div className="mb-3 rounded-xl bg-surface-2 p-3">
          <p className="mb-2 text-xs text-muted">{t('listSrcHelp')}</p>
          <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
            {(['object', 'code', 'name', 'active'] as const).map((k) => (
              <Field key={k} label={t(`ls_${k}`)}><input className={clsx(input, 'font-mono')} value={s[k]} onChange={(e) => onSrc({ ...src, [kind]: { ...s, [k]: e.target.value.trim().toUpperCase() } })} /></Field>
            ))}
          </div>
          <button type="button" onClick={onSync} disabled={busy || !s.object} className={clsx(btn, 'mt-2')}>{busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {t('readLists')}</button>
          <p className="mt-1 text-xs text-muted">{t('readListsHelp')}</p>
        </div>
      )}
      {kind === 'status' && <p className="mb-2 text-xs text-muted">{t('statusHelp')}</p>}
      {kind === 'characterization' && <p className="mb-2 text-xs text-muted">{t('charHelp')}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="w-20 py-1.5 font-medium">{t('code')}</th><th className="py-1.5 font-medium">{t('name')}</th><th className="w-16 py-1.5 text-center font-medium">{t('active')}</th><th className="w-44 py-1.5 font-medium">{t('mapsTo')}</th>{kind === 'characterization' && <th className="w-40 py-1.5 font-medium">{t('forTypes')}</th>}<th className="w-8" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className={clsx(!r.active && 'opacity-60')}>
                <td className="py-1.5 pr-2"><input className={clsx(input, 'py-1.5 font-mono')} value={r.code} onChange={(e) => upd(i, { code: e.target.value })} /></td>
                <td className="py-1.5 pr-2"><input className={clsx(input, 'py-1.5')} value={r.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                <td className="py-1.5 text-center"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={r.active} onChange={(e) => upd(i, { active: e.target.checked })} aria-label={t('active')} /></td>
                <td className="py-1.5 pr-2">
                  <select className={clsx(input, 'py-1.5')} value={r.maps_to ?? ''} onChange={(e) => upd(i, { maps_to: (e.target.value || null) as ActivityStatus | null })}>
                    <option value="">{kind === 'status' ? '—' : t('noChange')}</option>
                    {STATUSES.map((st) => <option key={st} value={st}>{tc(`st_${st}`)}</option>)}
                  </select>
                </td>
                {kind === 'characterization' && (
                  <td className="py-1.5 pr-2">
                    <select multiple className={clsx(input, 'h-9 py-1 text-xs')} value={r.types ?? []} title={t('forTypesHelp')}
                      onChange={(e) => upd(i, { types: [...e.target.selectedOptions].map((o) => o.value) })}>
                      {types.filter((x) => x.active).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                    </select>
                  </td>
                )}
                <td className="py-1.5"><button type="button" onClick={() => { setRows((x) => x.filter((_, j) => j !== i)); setDirty(true); }} aria-label={t('removeRow')} className="grid h-8 w-8 place-items-center rounded-lg text-danger hover:bg-danger-soft"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="py-4 text-center text-sm text-muted">{t('listEmpty')}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setRows((r) => [...r, { kind, code: '', name: '', active: true, maps_to: null, types: null, sort: (r.at(-1)?.sort ?? 0) + 1 }]); setDirty(true); }} className="flex items-center gap-1 text-sm font-medium text-primary"><Plus size={15} /> {t('addValue')}</button>
        <span className="flex-1" />
        <button type="button" onClick={save} disabled={!dirty || saving} className={btnPrimary}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {t('saveList')}</button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- dry run
function PreviewCard() {
  const t = useTranslations('erp');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; error?: string; seen?: number; preview?: Preview[] } | null>(null);
  const run = async () => { setBusy(true); setRes(await api<typeof res>('/settings/erp/preview', { method: 'POST' }).catch(() => ({ ok: false, error: t('saveError') }))); setBusy(false); };
  return (
    <Card title={t('previewTitle')} hint={t('previewHint')} icon={<Eye size={16} />} defaultOpen={false}
      action={<button type="button" onClick={run} disabled={busy} className={btn}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} {t('runPreview')}</button>}>
      {!res ? <p className="text-sm text-muted">{t('previewEmpty')}</p> : !res.ok ? <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{res.error}</p> : (
        <>
          <p className="mb-2 text-sm text-muted">{t('previewSeen', { n: res.seen ?? 0, shown: res.preview?.length ?? 0 })}</p>
          <ul className="divide-y divide-border text-sm">
            {res.preview?.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                <span className={clsx('w-20 shrink-0 rounded-md px-2 py-0.5 text-center text-xs font-semibold', p.action === 'create' ? 'bg-success-soft text-success' : p.action === 'update' ? 'bg-info-soft text-info' : 'bg-warning-soft text-warning')}>{t(`act_${p.action}`)}</span>
                <span className="w-28 shrink-0 font-mono text-xs">{p.erp_code ?? p.key}</span>
                <span className="min-w-0 flex-1 truncate">{p.subject}</span>
                <span className="text-xs text-muted">{p.due_at ? new Date(p.due_at).toLocaleDateString(locale) : ''}</span>
                {(p.problems.length > 0 || !p.customer_id) && <span className="w-full text-xs text-warning">{!p.customer_id ? t('noCustomer', { c: p.customer_label ?? '—' }) : p.problems.join(' · ')}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- log
function LogCard({ log }: { log: LogRow[] }) {
  const t = useTranslations('erp');
  const locale = useLocale();
  const [level, setLevel] = useState<'all' | 'warning' | 'error'>('all');
  const rows = log.filter((l) => level === 'all' || (level === 'warning' ? l.level !== 'info' : l.level === 'error'));
  return (
    <Card title={t('logTitle')} hint={t('logHint')} icon={<Info size={16} />} defaultOpen={false}>
      <div className="mb-2 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm w-fit">
        {(['all', 'warning', 'error'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setLevel(k)} aria-pressed={level === k} className={clsx('rounded-lg px-3 py-1 font-medium', level === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t(`lv_${k}`)}</button>
        ))}
      </div>
      {!rows.length ? <p className="py-4 text-center text-sm text-muted">{t('logEmpty')}</p> : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto text-sm">
          {rows.map((l, i) => (
            <li key={i} className="flex gap-2 py-2">
              {l.level === 'error' ? <XCircle size={16} className="mt-0.5 shrink-0 text-danger" /> : l.level === 'warning' ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />}
              <div className="min-w-0 flex-1">
                <div className="[overflow-wrap:anywhere]">{l.message}</div>
                <div className="text-xs text-muted">{new Date(l.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' })} · {l.action}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
