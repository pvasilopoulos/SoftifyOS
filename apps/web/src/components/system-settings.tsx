'use client';
// Settings → System health and Settings → Backups (installation-wide, platform administrators only).
import { useState } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle, Archive, CheckCircle2, ChevronDown, Cloud, Copy, Download, HardDrive, Loader2, Lock, Play, RefreshCw, ShieldCheck, Trash2, XCircle,
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
type Backup = { name: string; kind: 'daily' | 'weekly' | 'monthly'; created_at: string; size: number; files: string[]; encrypted: boolean };
type Backups = {
  configured: boolean; dir: string; encrypted: boolean; remote: string | null; keep_days: number; running: boolean; error?: string;
  last_run: { running: boolean; started_at: string; finished_at?: string; ok?: boolean; output?: string } | null;
  last: { ok: boolean; started_at: string; finished_at: string; message: string } | null;
  verify: { ok: boolean; verified_at: string; backup: string; tenants: number; customers: number; offers: number; files: number } | null;
  items: Backup[];
};

export function BackupsSection() {
  const t = useTranslations('backups');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system', 'backups'], queryFn: () => api<Backups>('/system/backups'), refetchInterval: (x) => (x.state.data?.running ? 3000 : 30_000) });
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isError) return <p className="text-sm text-muted">{t('noAccess')}</p>;
  if (!q.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const d = q.data;
  const rel = (iso: string) => relative(iso, locale, { today: ta('today'), yesterday: ta('yesterday') });
  const fmtDate = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const lastAgeH = d.last ? (Date.now() - new Date(d.last.finished_at).getTime()) / 3600e3 : null;

  const run = async () => {
    setBusy('run');
    try { await api('/system/backups/run', { method: 'POST' }); toast({ title: t('started') }); qc.invalidateQueries({ queryKey: ['system', 'backups'] }); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'already_running' ? t('alreadyRunning') : t('error') }); }
    setBusy(null);
  };
  const remove = async (b: Backup) => {
    if (!(await appConfirm(t('confirmDelete', { name: fmtDate(b.created_at) }), { danger: true }))) return;
    setBusy(b.name);
    try { await api(`/system/backups/${b.name}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['system', 'backups'] }); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'last_backup' ? t('lastOne') : t('error') }); }
    setBusy(null);
  };

  if (!d.configured) {
    return (
      <Card title={t('title')} description={t('notConfigured')}>
        <p className="text-sm text-muted">{t('notConfiguredHint')}</p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={clsx('card p-4', d.last && !d.last.ok ? 'border-danger/40' : lastAgeH !== null && lastAgeH > 26 ? 'border-warning/40' : '')}>
          <div className="flex items-center gap-2 text-xs text-muted"><Archive size={14} /> {t('lastBackup')}</div>
          {d.last ? (
            <>
              <div className="mt-1 flex items-center gap-1.5 font-bold">{d.last.ok ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-danger" />} {rel(d.last.finished_at)}</div>
              <div className="truncate text-xs text-muted">{d.last.ok ? d.last.message : d.last.message}</div>
            </>
          ) : <div className="mt-1 font-bold text-warning">{t('never')}</div>}
        </div>
        <div className={clsx('card p-4', d.verify && !d.verify.ok && 'border-danger/40')}>
          <div className="flex items-center gap-2 text-xs text-muted"><ShieldCheck size={14} /> {t('lastVerify')}</div>
          {d.verify ? (
            <>
              <div className="mt-1 flex items-center gap-1.5 font-bold">{d.verify.ok ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-danger" />} {rel(d.verify.verified_at)}</div>
              <div className="truncate text-xs text-muted">{t('verifyDetail', { t: d.verify.tenants, c: d.verify.customers.toLocaleString(locale), o: d.verify.offers.toLocaleString(locale), f: d.verify.files })}</div>
            </>
          ) : <div className="mt-1 text-sm text-muted">{t('verifyNever')}</div>}
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-xs text-muted"><HardDrive size={14} /> {t('protection')}</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            <li className="flex items-center gap-1.5">{d.encrypted ? <Lock size={14} className="text-success" /> : <AlertTriangle size={14} className="text-warning" />} {d.encrypted ? t('encrypted') : t('notEncrypted')}</li>
            <li className="flex items-center gap-1.5">{d.remote ? <Cloud size={14} className="text-success" /> : <AlertTriangle size={14} className="text-warning" />} {d.remote ? t('offsite', { remote: d.remote }) : t('noOffsite')}</li>
          </ul>
        </div>
      </div>

      <Card title={t('title')} description={t('hint', { days: d.keep_days })}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={run} disabled={d.running || !!busy}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {d.running || busy === 'run' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {d.running ? t('running') : t('runNow')}
          </button>
          <span className="text-xs text-muted">{t('dir')}: <code>{d.dir}</code></span>
        </div>
        {d.last_run && !d.last_run.running && d.last_run.ok === false && (
          <pre className="mb-3 max-h-40 overflow-auto rounded-xl bg-danger-soft p-3 text-[11px] text-danger">{d.last_run.output || t('error')}</pre>
        )}
        {d.error && <p className="mb-3 text-sm text-danger">{t('dirError')}</p>}
        {!d.items.length ? <p className="text-sm text-muted">{t('empty')}</p> : (
          <ul className="divide-y divide-border">
            {d.items.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className={clsx('w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold', b.kind === 'daily' ? 'bg-surface-2 text-muted' : b.kind === 'weekly' ? 'bg-info-soft text-info' : 'bg-primary-soft text-primary')}>{t(`k_${b.kind}`)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{fmtDate(b.created_at)}</span>
                  <span className="ml-2 text-xs text-muted">{bytes(b.size, locale)}{b.encrypted && ' · 🔒'}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {b.files.filter((f) => f !== 'SHA256SUMS').map((f) => (
                    <a key={f} href={`/api/system/backups/${b.name}/${f}`} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2" title={t('download')}>
                      <Download size={12} /> {f.startsWith('db') ? t('fileDb') : t('fileDocs')}
                    </a>
                  ))}
                  <button type="button" onClick={() => remove(b)} disabled={busy === b.name} aria-label={t('delete')} className="grid h-7 w-7 place-items-center rounded-lg text-danger hover:bg-danger-soft">
                    {busy === b.name ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('restoreTitle')} description={t('restoreHint')}>
        <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 text-xs">{`sudo bash /opt/softifyos/deploy/restore.sh --verify ${d.items[0]?.name ?? '<backup>'}
sudo bash /opt/softifyos/deploy/restore.sh ${d.items[0]?.name ?? '<backup>'}`}</pre>
        <p className="mt-2 text-xs text-muted">{t('restoreWhy')}</p>
      </Card>
    </div>
  );
}
