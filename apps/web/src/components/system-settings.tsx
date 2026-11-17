'use client';
// Settings → System health and Settings → Backups (installation-wide, platform administrators only).
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle, Archive, CalendarDays, CheckCircle2, ChevronDown, Clock, Cloud, Copy, Download, HardDrive, Layers, Loader2, Lock, Play, RefreshCw, ShieldAlert, ShieldCheck, Trash2, XCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { relative } from '@/lib/format';
import { appConfirm } from './confirm';
import { Card } from './settings-sections';
import { useToast } from './providers';

type Check = { ok: boolean; [k: string]: unknown };
type Health = {
  ok: boolean; checks: Record<string, Check>;
  app: { version: string; node: string; uptime_s: number; env: string; memory_mb: number; host: string; load: number[]; cpus: number; free_mem_mb: number; total_mem_mb: number };
  db: { size: number; version: string; connections: number; max_connections: number };
  tables: { name: string; rows: number; bytes: number }[];
  counts: { tenants: number; users: number; active_today: number };
  jobs: { kind: string; pending: number; retrying: number; last_error: string | null }[];
  live: { tenants: number; connections: number };
  config: Record<string, boolean | number>;
};
type ErrorRow = { fingerprint: string; source: 'api' | 'worker' | 'web'; message: string; stack: string | null; context: Record<string, unknown> | null; count: number; first_seen: string; last_seen: string; resolved_at: string | null };

export const bytes = (n: number, locale: string) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
};
const dur = (s: number) => (s < 3600 ? `${Math.floor(s / 60)}′` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}′` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`);

function Dot({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle2 size={18} className="shrink-0 text-success" aria-label="OK" /> : <XCircle size={18} className="shrink-0 text-danger" aria-label="Problem" />;
}

// ============================================================ System health
export function SystemHealthSection() {
  const t = useTranslations('system');
  const locale = useLocale();
  const q = useQuery({ queryKey: ['system', 'health'], queryFn: () => api<Health>('/system/health'), refetchInterval: 15_000 });
  if (q.isError) return <p className="text-sm text-muted">{t('noAccess')}</p>;
  if (!q.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const h = q.data;
  const detail = (k: string, c: Check) => {
    if (k === 'database') return t('dbMs', { ms: c.ms as number });
    if (k === 'worker') return c.last_beat_s === null ? t('workerNever') : t('workerBeat', { s: c.last_beat_s as number });
    if (k === 'queue') return t('queueDetail', { n: c.pending as number, s: c.oldest_s as number });
    if (k === 'errors') return t('errorsHour', { n: c.last_hour as number });
    if (k === 'backup') return c.last ? t('backupAge', { h: c.age_h as number }) : t('backupNone');
    return '';
  };
  const url = typeof window !== 'undefined' ? `${location.origin}/api/health` : '/api/health';

  return (
    <div className="space-y-4">
      <div className={clsx('card flex items-center gap-3 p-4', h.ok ? 'border-success/40' : 'border-danger/40')}>
        {h.ok ? <ShieldCheck size={28} className="text-success" /> : <AlertTriangle size={28} className="text-danger" />}
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold">{h.ok ? t('allOk') : t('needsAttention')}</div>
          <div className="text-xs text-muted">{t('autoRefresh')} · {h.app.host} · {h.app.env}</div>
        </div>
        <button type="button" onClick={() => q.refetch()} aria-label={t('refresh')} className="grid h-9 w-9 place-items-center rounded-xl border border-border">
          <RefreshCw size={16} className={clsx(q.isFetching && 'animate-spin')} />
        </button>
      </div>

      <Card title={t('checks')} description={t('checksHint')}>
        <ul className="divide-y divide-border">
          {Object.entries(h.checks).map(([k, c]) => (
            <li key={k} className="flex items-center gap-3 py-2.5 text-sm">
              <Dot ok={c.ok} />
              <span className="w-28 shrink-0 font-medium">{t(`c_${k}` as never)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{detail(k, c)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 p-2.5 text-xs">
          <span className="text-muted">{t('uptimeUrl')}</span>
          <code className="min-w-0 flex-1 truncate">{url}</code>
          <button type="button" onClick={() => navigator.clipboard.writeText(url)} aria-label={t('copy')} className="shrink-0 text-primary"><Copy size={14} /></button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('server')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Stat k={t('version')} v={`${h.app.version} · Node ${h.app.node}`} />
            <Stat k={t('uptime')} v={dur(h.app.uptime_s)} />
            <Stat k={t('load')} v={`${h.app.load.join(' / ')} (${h.app.cpus} CPU)`} />
            <Stat k={t('memory')} v={`${h.app.memory_mb} MB · ${t('free')} ${Math.round(h.app.free_mem_mb / 1024 * 10) / 10}/${Math.round(h.app.total_mem_mb / 1024)} GB`} />
            <Stat k={t('organisations')} v={h.counts.tenants.toLocaleString(locale)} />
            <Stat k={t('users')} v={`${h.counts.users.toLocaleString(locale)} · ${t('activeToday', { n: h.counts.active_today })}`} />
            <Stat k={t('live')} v={t('liveDetail', { c: h.live.connections, t: h.live.tenants })} />
          </dl>
        </Card>
        <Card title={t('database')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Stat k={t('dbSize')} v={bytes(h.db.size, locale)} />
            <Stat k={t('connections')} v={`${h.db.connections} / ${h.db.max_connections}`} />
            <Stat k={t('version')} v={h.db.version} />
          </dl>
          <table className="mt-3 w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1 font-medium">{t('table')}</th><th className="py-1 text-right font-medium">{t('rows')}</th><th className="py-1 text-right font-medium">{t('size')}</th></tr></thead>
            <tbody className="divide-y divide-border">
              {h.tables.map((x) => <tr key={x.name}><td className="py-1 font-mono">{x.name}</td><td className="py-1 text-right tabular">{x.rows.toLocaleString(locale)}</td><td className="py-1 text-right tabular">{bytes(x.bytes, locale)}</td></tr>)}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={t('jobs')} description={t('jobsHint')}>
        {!h.jobs.length ? <p className="text-sm text-muted">{t('noJobs')}</p> : (
          <ul className="divide-y divide-border text-sm">
            {h.jobs.map((j) => (
              <li key={j.kind} className="py-2">
                <div className="flex items-center gap-2"><span className="font-mono">{j.kind}</span><span className="flex-1" /><span className="tabular">{j.pending}</span>{j.retrying > 0 && <span className="text-xs text-warning">{t('retrying', { n: j.retrying })}</span>}</div>
                {j.last_error && <div className="truncate text-xs text-danger">{j.last_error}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ErrorsCard />

      <Card title={t('config')} description={t('configHint')}>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {Object.entries(h.config).map(([k, v]) => (
            <li key={k} className="flex items-center gap-2">
              {k === 'platform_admins' ? <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">{v as number}</span> : <Dot ok={!!v} />}
              <span>{t(`cfg_${k}` as never)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="truncate font-medium">{v}</dd></div>;
}

function ErrorsCard() {
  const t = useTranslations('system');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['system', 'errors', status], queryFn: () => api<ErrorRow[]>(`/system/errors?status=${status}`), refetchInterval: 30_000 });
  const resolve = async (body: { fingerprint?: string; all?: boolean }) => {
    await api('/system/errors/resolve', { method: 'POST', json: body });
    qc.invalidateQueries({ queryKey: ['system'] });
  };
  const rows = q.data ?? [];
  return (
    <Card title={t('errors')} description={t('errorsHint')}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {(['open', 'resolved'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
              className={clsx('rounded-lg px-3 py-1 font-medium', status === s ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t(`err_${s}`)}</button>
          ))}
        </div>
        <span className="flex-1" />
        {status === 'open' && rows.length > 0 && <button type="button" onClick={() => resolve({ all: true })} className="text-sm font-medium text-primary">{t('resolveAll')}</button>}
      </div>
      {!rows.length ? <p className="flex items-center gap-2 text-sm text-muted"><CheckCircle2 size={16} className="text-success" /> {status === 'open' ? t('noErrors') : t('noResolved')}</p> : (
        <ul className="divide-y divide-border">
          {rows.map((e) => (
            <li key={e.fingerprint} className="py-2.5 text-sm">
              <div className="flex items-start gap-2">
                <span className={clsx('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', e.source === 'web' ? 'bg-info-soft text-info' : e.source === 'worker' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')}>{e.source}</span>
                <button type="button" onClick={() => setOpen(open === e.fingerprint ? null : e.fingerprint)} className="min-w-0 flex-1 text-left">
                  <div className="font-medium [overflow-wrap:anywhere]">{e.message}</div>
                  <div className="text-xs text-muted">×{e.count} · {relative(e.last_seen, locale, { today: ta('today'), yesterday: ta('yesterday') })}{e.context?.route ? ` · ${String(e.context.route)}` : e.context?.url ? ` · ${String(e.context.url)}` : ''}</div>
                </button>
                <ChevronDown size={16} className={clsx('mt-1 shrink-0 text-muted transition', open === e.fingerprint && 'rotate-180')} />
                {!e.resolved_at && <button type="button" onClick={() => resolve({ fingerprint: e.fingerprint })} className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-medium">{t('resolve')}</button>}
              </div>
              {open === e.fingerprint && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-surface-2 p-3 text-[11px] leading-relaxed">{[e.stack ?? e.message, e.context ? `\n${JSON.stringify(e.context, null, 2)}` : ''].join('')}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ============================================================ Backups
type Backup = {
  name: string; kind: 'daily' | 'weekly' | 'monthly'; created_at: string; size: number; db_bytes: number; files_bytes: number; files: string[];
  encrypted: boolean; checksums: boolean; duration_s: number | null; documents: number | null; offsite: boolean | null; pg_version: string | null; trigger: 'schedule' | 'manual' | null;
};
type Backups = {
  configured: boolean; dir: string; encrypted: boolean; remote: string | null; keep_days: number; running: boolean; error?: string;
  retention: { daily: number; weekly: number; monthly: number };
  schedule: { next_backup_at: string; next_verify_at: string };
  disk: { free: number; total: number } | null; total_bytes: number;
  last_run: { running: boolean; started_at: string; finished_at?: string; ok?: boolean; output?: string } | null;
  last: { ok: boolean; started_at: string; finished_at: string; message: string } | null;
  verify: { ok: boolean; verified_at: string; backup: string; tenants: number; customers: number; offers: number; files: number } | null;
  items: Backup[];
};
type CheckResult = { ok: boolean; files: { file: string; ok: boolean }[]; checked_at: string };
type Kind = 'all' | Backup['kind'];

const secs = (s: number) => (s < 60 ? `${s}″` : `${Math.floor(s / 60)}′ ${String(s % 60).padStart(2, '0')}″`);
const until = (iso: string) => dur(Math.max(60, (new Date(iso).getTime() - Date.now()) / 1000));

export function BackupsSection() {
  const t = useTranslations('backups');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system', 'backups'], queryFn: () => api<Backups>('/system/backups'), refetchInterval: (x) => (x.state.data?.running ? 3000 : 30_000) });
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [checks, setChecks] = useState<Record<string, CheckResult | 'busy' | 'error'>>({});
  const [, tick] = useState(0);
  useEffect(() => { // live elapsed time while a backup runs
    if (!q.data?.running) return;
    const i = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [q.data?.running]);

  if (q.isError) return <p className="text-sm text-muted">{t('noAccess')}</p>;
  if (!q.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const d = q.data;
  if (!d.configured) {
    return (
      <Card title={t('title')} description={t('notConfigured')}>
        <p className="text-sm text-muted">{t('notConfiguredHint')}</p>
      </Card>
    );
  }

  const rel = (iso: string) => relative(iso, locale, { today: ta('today'), yesterday: ta('yesterday') });
  const fmtDate = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const b = (n: number) => bytes(n, locale);
  const daily = d.items.filter((i) => i.kind === 'daily');
  const latest = daily[0] ?? d.items[0] ?? null;
  const prev = daily[1] ?? null;
  const lastAgeH = d.last ? (Date.now() - new Date(d.last.finished_at).getTime()) / 3600e3 : null;
  const failed = !!d.last && !d.last.ok;
  const stale = lastAgeH !== null && lastAgeH > 26;
  const verifyAgeD = d.verify ? (Date.now() - new Date(d.verify.verified_at).getTime()) / 864e5 : null;
  const diskOk = !d.disk || !latest || (d.disk.free > latest.size * 5 && d.disk.free / d.disk.total > 0.1);
  const protection = [
    { key: 'schedule', ok: !!d.last && !failed && !stale, text: t('pSchedule'), hint: failed ? t('pScheduleFailed') : t('pScheduleHint') },
    { key: 'encryption', ok: d.encrypted, text: d.encrypted ? t('encrypted') : t('notEncrypted'), hint: t('pEncryptHint') },
    { key: 'offsite', ok: !!d.remote, text: d.remote ? t('offsite', { remote: d.remote }) : t('noOffsite'), hint: t('pOffsiteHint') },
    { key: 'verify', ok: !!d.verify?.ok && verifyAgeD !== null && verifyAgeD < 8, text: t('pVerify'), hint: d.verify && !d.verify.ok ? t('pVerifyFailed') : t('pVerifyHint') },
    { key: 'disk', ok: diskOk, text: t('pDisk'), hint: t('pDiskHint') },
  ];
  const score = protection.filter((p) => p.ok).length;
  const state = d.running ? 'running' : failed ? 'failed' : !d.last && !latest ? 'none' : stale ? 'stale' : score < protection.length ? 'partial' : 'ok';
  const tone = state === 'ok' ? 'success' : state === 'running' ? 'primary' : state === 'partial' ? 'warning' : 'danger';
  const elapsed = d.running && d.last_run?.started_at ? Math.round((Date.now() - new Date(d.last_run.started_at).getTime()) / 1000) : null;

  const counts = { all: d.items.length, daily: daily.length, weekly: d.items.filter((i) => i.kind === 'weekly').length, monthly: d.items.filter((i) => i.kind === 'monthly').length };
  const list = d.items.filter((i) => kind === 'all' || i.kind === kind);
  const shown = showAll ? list : list.slice(0, 8);
  const selected = d.items.find((i) => i.name === open) ?? latest;

  const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast({ title: t('copied') }); };
  const run = async () => {
    setBusy('run');
    try { await api('/system/backups/run', { method: 'POST' }); toast({ title: t('started') }); qc.invalidateQueries({ queryKey: ['system', 'backups'] }); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'already_running' ? t('alreadyRunning') : t('error') }); }
    setBusy(null);
  };
  const remove = async (x: Backup) => {
    if (!(await appConfirm(t('confirmDelete', { name: fmtDate(x.created_at) }), { danger: true }))) return;
    setBusy(x.name);
    try { await api(`/system/backups/${x.name}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['system', 'backups'] }); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'last_backup' ? t('lastOne') : t('error') }); }
    setBusy(null);
  };
  const check = async (x: Backup) => {
    setChecks((c) => ({ ...c, [x.name]: 'busy' }));
    try { const r = await api<CheckResult>(`/system/backups/${x.name}/check`, { method: 'POST' }); setChecks((c) => ({ ...c, [x.name]: r })); }
    catch { setChecks((c) => ({ ...c, [x.name]: 'error' })); }
  };

  return (
    <div className="@container space-y-4">
      {/* ---------------------------------------------------------------- status */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5">
          <div className={clsx('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', {
            'bg-success-soft text-success': tone === 'success', 'bg-primary-soft text-primary': tone === 'primary',
            'bg-warning-soft text-warning': tone === 'warning', 'bg-danger-soft text-danger': tone === 'danger',
          })}>
            {state === 'running' ? <Loader2 size={24} className="animate-spin" /> : state === 'ok' ? <ShieldCheck size={24} /> : state === 'partial' ? <ShieldAlert size={24} /> : <AlertTriangle size={24} />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight">{t(`state_${state}`)}</h2>
            <p className="text-sm text-muted">
              {state === 'running' ? t('runningFor', { t: secs(elapsed ?? 0) })
                : d.last ? t('lastLine', { when: rel(d.last.finished_at), size: latest ? b(latest.size) : '–' })
                  : t('never')}
              {state !== 'running' && <> · {t('scoreLine', { n: score, of: protection.length })}</>}
            </p>
          </div>
          <div className="flex w-full items-center gap-2 @lg:w-auto">
            <button type="button" onClick={() => q.refetch()} aria-label={t('refresh')} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border hover:bg-surface-2">
              <RefreshCw size={16} className={clsx(q.isFetching && 'animate-spin')} />
            </button>
            <button type="button" onClick={run} disabled={d.running || !!busy}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60 @lg:flex-none">
              {d.running || busy === 'run' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {d.running ? t('running') : t('runNow')}
            </button>
          </div>
        </div>
        {d.running && <div className="h-1 overflow-hidden bg-primary-soft"><div className="h-full w-1/3 animate-[backup-progress_1.6s_ease-in-out_infinite] rounded-full bg-primary" /></div>}
        {!d.running && d.last_run?.ok === false && (
          <pre className="mx-4 mb-4 max-h-40 overflow-auto rounded-xl bg-danger-soft p-3 text-[11px] text-danger sm:mx-5">{d.last_run.output || t('error')}</pre>
        )}
        {d.error && <p className="mx-4 mb-4 text-sm text-danger sm:mx-5">{t('dirError')}</p>}

        <dl className="grid grid-cols-2 border-t border-border @2xl:grid-cols-4">
          <Kpi icon={<Archive size={14} />} label={t('kLatest')}
            value={latest ? b(latest.size) : '–'}
            sub={latest ? [latest.duration_s !== null && t('took', { t: secs(latest.duration_s) }), prev && delta(latest.size, prev.size, locale)].filter(Boolean).join(' · ') || rel(latest.created_at) : t('never')} />
          <Kpi icon={<Clock size={14} />} label={t('kNext')}
            value={new Date(d.schedule.next_backup_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
            sub={t('inTime', { t: until(d.schedule.next_backup_at) })} />
          <Kpi icon={<Layers size={14} />} label={t('kCount')} value={String(counts.all)}
            sub={t('countDetail', { d: counts.daily, w: counts.weekly, m: counts.monthly })} />
          <Kpi icon={<HardDrive size={14} />} label={t('kSpace')} value={b(d.total_bytes)}
            sub={d.disk ? t('diskFree', { free: b(d.disk.free) }) : t('diskUnknown')}
            bar={d.disk ? 1 - d.disk.free / d.disk.total : undefined} barWarn={!diskOk} />
        </dl>
      </section>

      {/* ---------------------------------------------------------------- trend + protection */}
      <div className="grid gap-4 @3xl:grid-cols-5">
        <div className="@3xl:col-span-3"><SizeChart items={daily.slice(0, 14).reverse()} /></div>
        <section className="card p-4 sm:p-5 @3xl:col-span-2">
          <div className="mb-3 flex items-center gap-3">
            <h3 className="flex-1 text-base font-semibold">{t('protection')}</h3>
            <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold tabular', score === protection.length ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>{score}/{protection.length}</span>
          </div>
          <ul className="space-y-2.5">
            {protection.map((p) => (
              <li key={p.key} className="flex gap-2.5 text-sm">
                {p.ok ? <CheckCircle2 size={17} className="mt-px shrink-0 text-success" /> : <AlertTriangle size={17} className="mt-px shrink-0 text-warning" />}
                <div className="min-w-0">
                  <div className="font-medium">{p.text}</div>
                  {p.key === 'verify' && d.verify && <div className="text-xs text-muted">{rel(d.verify.verified_at)} · {t('verifyDetail', { t: d.verify.tenants, c: d.verify.customers.toLocaleString(locale), o: d.verify.offers.toLocaleString(locale), f: d.verify.files })}</div>}
                  {p.key === 'verify' && <div className="text-xs text-muted">{t('nextVerify', { when: new Date(d.schedule.next_verify_at).toLocaleString(locale, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) })}</div>}
                  {p.key === 'schedule' && <div className="text-xs text-muted">{t('retention', { d: d.retention.daily, w: d.retention.weekly, m: d.retention.monthly })}</div>}
                  {!p.ok && <div className="text-xs text-muted [overflow-wrap:anywhere]">{p.hint}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ---------------------------------------------------------------- list */}
      <section className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="flex-1 text-base font-semibold">{t('title')}</h3>
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 text-sm">
            {(['all', 'daily', 'weekly', 'monthly'] as const).map((k) => (
              <button key={k} type="button" onClick={() => { setKind(k); setShowAll(false); }} aria-pressed={kind === k}
                className={clsx('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1 font-medium', kind === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
                {t(`f_${k}`)} <span className="text-xs tabular opacity-70">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>
        {!list.length ? <p className="py-6 text-center text-sm text-muted">{t('empty')}</p> : (
          <ul className="divide-y divide-border">
            {shown.map((x) => {
              const isOpen = open === x.name;
              const c = checks[x.name];
              return (
                <li key={x.name}>
                  <div className="flex items-center gap-3 py-2.5">
                    <button type="button" onClick={() => setOpen(isOpen ? null : x.name)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', x.kind === 'daily' ? 'bg-surface-2 text-muted' : x.kind === 'weekly' ? 'bg-info-soft text-info' : 'bg-primary-soft text-primary')}>
                        {x.kind === 'daily' ? <Archive size={16} /> : x.kind === 'weekly' ? <CalendarDays size={16} /> : <Layers size={16} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{fmtDate(x.created_at)}</span>
                          {x.kind !== 'daily' && <span className={clsx('hidden shrink-0 rounded-full px-2 py-px text-[10px] font-semibold sm:inline', x.kind === 'weekly' ? 'bg-info-soft text-info' : 'bg-primary-soft text-primary')}>{t(`k_${x.kind}`)}</span>}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-muted">
                          <span className="tabular">{b(x.size)}</span>
                          {x.encrypted && <Lock size={11} aria-label={t('encrypted')} />}
                          {x.offsite && <Cloud size={11} aria-label={t('offsiteShort')} />}
                          {x.trigger === 'manual' && <span>· {t('manual')}</span>}
                          {c && c !== 'busy' && c !== 'error' && (c.ok ? <span className="flex items-center gap-0.5 text-success">· <ShieldCheck size={11} /> {t('intact')}</span> : <span className="text-danger">· {t('damaged')}</span>)}
                        </span>
                      </span>
                      <SplitBar db={x.db_bytes} docs={x.files_bytes} className="hidden w-28 @xl:flex" />
                      <ChevronDown size={16} className={clsx('shrink-0 text-muted transition', isOpen && 'rotate-180')} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="mb-3 space-y-3 rounded-2xl bg-surface-2 p-3 sm:p-4">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm @xl:grid-cols-4">
                        <Stat k={t('fileDb')} v={b(x.db_bytes)} />
                        <Stat k={t('fileDocs')} v={x.documents !== null ? `${b(x.files_bytes)} · ${t('docsCount', { n: x.documents })}` : b(x.files_bytes)} />
                        <Stat k={t('duration')} v={x.duration_s !== null ? secs(x.duration_s) : '–'} />
                        <Stat k={t('source')} v={x.trigger ? t(x.trigger === 'manual' ? 'manual' : 'scheduled') : '–'} />
                        <Stat k={t('encryption')} v={x.encrypted ? 'AES-256' : t('none')} />
                        <Stat k={t('offsiteShort')} v={x.offsite === null ? '–' : x.offsite ? t('yes') : t('no')} />
                        <Stat k="PostgreSQL" v={x.pg_version ?? '–'} />
                        <Stat k={t('folder')} v={x.name} />
                      </dl>
                      {c && c !== 'busy' && (
                        <div className={clsx('rounded-xl p-2.5 text-sm', c !== 'error' && c.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
                          {c === 'error' ? t('checkError') : c.ok ? t('checkOk', { n: c.files.length }) : t('checkBad', { files: c.files.filter((f) => !f.ok).map((f) => f.file).join(', ') })}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {x.files.filter((f) => f !== 'SHA256SUMS').map((f) => (
                          <a key={f} href={`/api/system/backups/${x.name}/${f}`} className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:border-primary">
                            <Download size={13} /> {f.startsWith('db') ? t('fileDb') : t('fileDocs')}
                          </a>
                        ))}
                        {x.checksums && (
                          <button type="button" onClick={() => check(x)} disabled={c === 'busy'} className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:border-primary disabled:opacity-60">
                            {c === 'busy' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} {t('check')}
                          </button>
                        )}
                        <span className="flex-1" />
                        <button type="button" onClick={() => remove(x)} disabled={busy === x.name} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft">
                          {busy === x.name ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {t('delete')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {list.length > shown.length && (
          <button type="button" onClick={() => setShowAll(true)} className="mt-2 w-full rounded-xl py-2 text-sm font-medium text-primary hover:bg-primary-soft">{t('showAll', { n: list.length })}</button>
        )}
      </section>

      {/* ---------------------------------------------------------------- restore */}
      <section className="card p-4 sm:p-5">
        <h3 className="text-base font-semibold">{t('restoreTitle')}</h3>
        <p className="mt-0.5 text-sm text-muted">{t('restoreHint')} {selected && t('restoreFor', { name: fmtDate(selected.created_at) })}</p>
        <ol className="mt-4 space-y-3">
          {[
            { n: 1, title: t('r1'), text: t('r1Hint'), cmd: `sudo bash /opt/softifyos/deploy/restore.sh --verify ${selected?.name ?? '<backup>'}` },
            { n: 2, title: t('r2'), text: t('r2Hint'), cmd: `sudo bash /opt/softifyos/deploy/restore.sh ${selected?.name ?? '<backup>'}`, danger: true },
            { n: 3, title: t('r3'), text: t('r3Hint'), cmd: 'curl -s https://app.softify.gr/api/health' },
          ].map((s) => (
            <li key={s.n} className="flex gap-3">
              <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', s.danger ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary')}>{s.n}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-muted">{s.text}</div>
                <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-surface-2 py-2 pl-3 pr-2">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs">{s.cmd}</code>
                  <button type="button" onClick={() => copy(s.cmd)} aria-label={t('copy')} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-primary hover:bg-surface"><Copy size={14} /></button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function delta(cur: number, prev: number, locale: string) {
  if (!prev) return '';
  const p = ((cur - prev) / prev) * 100;
  return `${p >= 0 ? '+' : ''}${p.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

function Kpi({ icon, label, value, sub, bar, barWarn }: { icon: ReactNode; label: string; value: string; sub: string; bar?: number; barWarn?: boolean }) {
  return (
    <div className="min-w-0 border-border p-4 sm:px-5 [&:nth-child(odd)]:border-r @2xl:[&:not(:last-child)]:border-r [&:nth-child(-n+2)]:border-b @2xl:[&:nth-child(-n+2)]:border-b-0">
      <dt className="flex items-center gap-1.5 text-xs text-muted">{icon} {label}</dt>
      <dd className="mt-1 truncate text-xl font-bold tabular">{value}</dd>
      <dd className="truncate text-xs text-muted">{sub}</dd>
      {bar !== undefined && (
        <dd className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(bar * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={clsx('h-full rounded-full', barWarn ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(2, bar * 100)}%` }} />
        </dd>
      )}
    </div>
  );
}

/** Database vs documents share of one backup. */
function SplitBar({ db, docs, className }: { db: number; docs: number; className?: string }) {
  const total = db + docs || 1;
  return (
    <span className={clsx('h-1.5 shrink-0 gap-0.5 overflow-hidden rounded-full', className)} aria-hidden>
      <span className="h-full rounded-full bg-primary" style={{ width: `${(db / total) * 100}%` }} />
      <span className="h-full flex-1 rounded-full bg-info" />
    </span>
  );
}

/** Size of the last daily backups: database + documents, stacked. */
function SizeChart({ items }: { items: Backup[] }) {
  const t = useTranslations('backups');
  const locale = useLocale();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => i.size));
  const cur = items[hover ?? items.length - 1];
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return (
    <section className="card h-full p-4 sm:p-5">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="flex-1 text-base font-semibold">{t('trend')}</h3>
        <span className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2.5 w-2.5 rounded-sm bg-primary" /> {t('fileDb')}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2.5 w-2.5 rounded-sm bg-info" /> {t('fileDocs')}</span>
      </div>
      <p className="mb-4 h-5 truncate text-sm" aria-live="polite">
        {cur ? <><span className="font-semibold">{day(cur.created_at)}</span><span className="text-muted"> · {bytes(cur.size, locale)} · {t('fileDb')} {bytes(cur.db_bytes, locale)} · {t('fileDocs')} {bytes(cur.files_bytes, locale)}</span></> : <span className="text-muted">{t('empty')}</span>}
      </p>
      <div className="flex h-36 items-end gap-0.5 border-b border-border" onMouseLeave={() => setHover(null)}>
        {items.map((x, i) => (
          <div key={x.name} tabIndex={0} role="img" aria-label={`${day(x.created_at)}: ${bytes(x.size, locale)}`}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            className="group flex h-full min-w-0 flex-1 cursor-default flex-col justify-end outline-none">
            <div className={clsx('mx-auto flex w-full max-w-7 flex-col gap-0.5 transition-opacity', hover !== null && hover !== i && 'opacity-40')} style={{ height: `${(x.size / max) * 100}%` }}>
              <div className="min-h-px rounded-t bg-info" style={{ flexGrow: x.files_bytes || 0.0001 }} />
              <div className="min-h-px bg-primary" style={{ flexGrow: x.db_bytes || 0.0001 }} />
            </div>
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <div className="mt-1.5 flex justify-between text-[11px] text-muted tabular">
          <span>{day(items[0].created_at)}</span><span>{day(items[items.length - 1].created_at)}</span>
        </div>
      )}
    </section>
  );
}
