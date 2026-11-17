'use client';
import { appConfirm } from './confirm';
// Settings → Integrations: overview, API keys, webhooks, request log, documentation.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Activity, AlertTriangle, Ban, BookOpen, Check, CheckCircle2, ChevronDown, Clock, Copy, ExternalLink, Eye, EyeOff, Gauge, Globe,
  KeyRound, ListTree, Loader2, Pause, PenLine, Play, Plus, RefreshCw, RotateCw, Search, Send, ShieldCheck, Trash2, Webhook, XCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { date, relative, time } from '@/lib/format';
import { Card } from './settings-sections';
import { Dialog } from './customer-dialogs';
import { useToast } from './providers';

const primaryBtn = 'flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60';
const ghostBtn = 'flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 font-medium disabled:opacity-60';
const smallBtn = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-60';
const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary';
const chip = 'rounded-full px-2 py-0.5 text-xs font-medium';

type Level = 'none' | 'read' | 'write';
type Resource = 'customers' | 'branches' | 'spaces' | 'lists' | 'activities' | 'documents';
const RESOURCES: Resource[] = ['customers', 'branches', 'spaces', 'lists', 'activities', 'documents'];
type Perms = Record<Resource, Level>;
type ApiKey = {
  id: string; name: string; prefix: string; permissions: Perms; expires_at: string | null; allowed_ips: string[]; rotated_from: string | null;
  rotated_from_name: string | null; created_at: string; last_used_at: string | null; requests: string; revoked_at: string | null;
  created_by_name: string | null; req_24h: number; err_24h: number;
};
type Hook = {
  id: string; name: string; url: string; events: string[]; active: boolean; created_at: string; last_success_at: string | null;
  last_failure_at: string | null; consecutive_failures: number; created_by_name: string | null; sent_24h: number; failed_24h: number; pending: number;
};
type Delivery = { id: string; event: string; status: 'pending' | 'success' | 'failed'; attempts: number; response_code: number | null; response_ms: number | null; error: string | null; created_at: string; delivered_at: string | null; payload: unknown };
type LogRow = { id: string; method: string; path: string; status: number; duration_ms: number; ip: string | null; items: number | null; created: number | null; updated: number | null; failed: number | null; error: string | null; created_at: string; key_id: string | null; key_name: string | null };
type LogDetail = LogRow & { errors: { external_id: string; error: string; detail?: unknown }[] | null; key_prefix: string | null };
type Stats = {
  totals: { requests: number; errors: number; p95_ms: number; avg_ms: number; created: number; updated: number; failed: number };
  series: { at: string; requests: number; errors: number }[];
  topErrors: { error: string; n: number }[];
  byKey: { key_id: string | null; name: string | null; requests: number; errors: number }[];
  webhooks: { success: number; failed: number; pending: number };
};
type Page<T> = { items: T[]; nextCursor: string | null };

const TABS = [
  { key: 'overview', icon: Gauge },
  { key: 'keys', icon: KeyRound },
  { key: 'webhooks', icon: Webhook },
  { key: 'logs', icon: ListTree },
  { key: 'docs', icon: BookOpen },
] as const;
type Tab = (typeof TABS)[number]['key'];

function useRel() {
  const locale = useLocale();
  const ta = useTranslations('activity');
  return (d: string) => `${relative(d, locale, { today: ta('today'), yesterday: ta('yesterday') })}`;
}

export function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-[#17142b] p-3 pr-12 text-xs leading-relaxed text-[#e9e6f5]"><code>{children}</code></pre>
      <button type="button" onClick={async () => { await navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        aria-label="copy" className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" className="inline-flex gap-1 rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={clsx('rounded-lg font-medium transition', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ======================================================================== shell
export function IntegrationsSection() {
  const t = useTranslations('integ');
  const ts = useTranslations('settings');
  const [tab, setTab] = useState<Tab>('overview');
  // Admin check (403 for non-admins)
  const keys = useQuery({ queryKey: ['settings', 'api-keys'], queryFn: () => api<ApiKey[]>('/settings/api-keys'), retry: false });
  if (keys.error instanceof ApiError && keys.error.status === 403) {
    return <div className="flex items-center gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info"><ShieldCheck size={16} /> {ts('adminOnly')}</div>;
  }
  return (
    <div className="space-y-4">
      <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
        <div role="tablist" className="flex min-w-max gap-1 rounded-2xl bg-surface-2 p-1">
          {TABS.map(({ key, icon: Icon }) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={clsx('flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition',
                tab === key ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
              <Icon size={16} /> {t(`tab_${key}`)}
            </button>
          ))}
        </div>
      </div>
      {tab === 'overview' && <OverviewTab onGo={setTab} />}
      {tab === 'keys' && <KeysTab />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'docs' && <DocsTab />}
    </div>
  );
}

// ======================================================================== overview
function OverviewTab({ onGo }: { onGo: (t: Tab) => void }) {
  const t = useTranslations('integ');
  const locale = useLocale();
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'integ-stats', range], refetchInterval: 30_000,
    queryFn: () => api<Stats>(`/settings/integrations/stats?range=${range}`),
  });
  const nf = new Intl.NumberFormat(locale);
  const tot = data?.totals;
  const errRate = tot && tot.requests ? (tot.errors / tot.requests) * 100 : 0;
  const max = Math.max(1, ...(data?.series.map((s) => s.requests) ?? [1]));
  const label = (at: string) => (range === '24h' ? time(at, locale) : date(at, locale, { day: 'numeric', month: 'short' }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted">{t('overviewTitle')}</h3>
        <Segmented value={range} onChange={setRange} size="sm" options={[{ value: '24h', label: t('r24h') }, { value: '7d', label: t('r7d') }, { value: '30d', label: t('r30d') }]} />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon={Activity} label={t('kRequests')} value={tot ? nf.format(tot.requests) : '—'} />
        <Kpi icon={AlertTriangle} label={t('kErrorRate')} value={tot ? `${errRate.toFixed(errRate < 10 ? 1 : 0)}%` : '—'}
          tone={errRate >= 5 ? 'danger' : errRate > 0 ? 'warning' : 'success'} sub={tot ? t('kErrors', { count: tot.errors }) : undefined} />
        <Kpi icon={Clock} label={t('kP95')} value={tot ? `${nf.format(tot.p95_ms)} ms` : '—'} sub={tot ? t('kAvg', { ms: tot.avg_ms }) : undefined} />
        <Kpi icon={RefreshCw} label={t('kRecords')} value={tot ? nf.format(tot.created + tot.updated) : '—'}
          sub={tot ? t('kRecordsSub', { created: nf.format(tot.created), updated: nf.format(tot.updated), failed: nf.format(tot.failed) }) : undefined} />
      </div>

      <Card title={t('chartTitle')}>
        {isLoading ? <div className="skeleton h-40" /> : (
          <>
            <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={t('chartTitle')}>
              {data?.series.map((s) => (
                <div key={s.at} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-md" style={{ height: `${(s.requests / max) * 100}%`, minHeight: s.requests ? 3 : 0 }}>
                    <div className="w-full bg-danger" style={{ height: `${s.requests ? (s.errors / s.requests) * 100 : 0}%` }} />
                    <div className="w-full flex-1 bg-primary/80 group-hover:bg-primary" />
                  </div>
                  {!s.requests && <div className="h-[2px] w-full rounded bg-border" />}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#17142b] px-2 py-1 text-xs text-white group-hover:block">
                    {label(s.at)} · {nf.format(s.requests)}{s.errors ? ` · ${t('kErrors', { count: s.errors })}` : ''}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>{data?.series[0] && label(data.series[0].at)}</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" />{t('legendOk')}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-danger" />{t('legendErr')}</span>
              </span>
              <span>{data?.series.at(-1) && label(data.series.at(-1)!.at)}</span>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('byKey')}>
          {!data?.byKey.length ? <p className="text-sm text-muted">{t('noTraffic')}</p> : (
            <ul className="space-y-2.5">
              {data.byKey.map((k) => (
                <li key={k.key_id ?? 'none'}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{k.name ?? t('deletedKey')}</span>
                    <span className="tabular shrink-0 text-muted">{nf.format(k.requests)}{k.errors ? <span className="text-danger"> · {k.errors}</span> : null}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(k.requests / (data.byKey[0]?.requests || 1)) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('topErrors')} action={<button onClick={() => onGo('logs')} className="text-sm font-medium text-primary">{t('seeLog')}</button>}>
          {!data?.topErrors.length ? (
            <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 size={16} /> {t('noErrors')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.topErrors.map((e) => (
                <li key={e.error} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <code className="truncate rounded bg-danger-soft px-1.5 py-0.5 text-xs text-danger">{e.error}</code>
                  <span className="tabular text-muted">{nf.format(e.n)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
            <MiniStat label={t('whSent')} value={nf.format(data?.webhooks.success ?? 0)} tone="success" />
            <MiniStat label={t('whFailed')} value={nf.format(data?.webhooks.failed ?? 0)} tone={data?.webhooks.failed ? 'danger' : undefined} />
            <MiniStat label={t('whPending')} value={nf.format(data?.webhooks.pending ?? 0)} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: typeof Activity; label: string; value: string; sub?: string; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Icon size={14} className={clsx(tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-primary')} />{label}
      </div>
      <div className={clsx('tabular mt-1 text-xl font-bold', tone === 'danger' && 'text-danger')}>{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <div>
      <div className={clsx('tabular text-lg font-bold', tone === 'success' && 'text-success', tone === 'danger' && 'text-danger')}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

// ======================================================================== API keys
function keyState(k: ApiKey): 'revoked' | 'expired' | 'expiring' | 'active' {
  if (k.revoked_at) return 'revoked';
  if (k.expires_at) {
    const left = new Date(k.expires_at).getTime() - Date.now();
    if (left <= 0) return 'expired';
    if (left < 7 * 86_400_000) return 'expiring';
  }
  return 'active';
}

function KeysTab() {
  const t = useTranslations('integ');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const locale = useLocale();
  const rel = useRel();
  const keys = useQuery({ queryKey: ['settings', 'api-keys'], queryFn: () => api<ApiKey[]>('/settings/api-keys') });
  const [editing, setEditing] = useState<ApiKey | 'new' | null>(null);
  const [rotating, setRotating] = useState<ApiKey | null>(null);
  const [shown, setShown] = useState<{ title: string; key: string } | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'api-keys'] });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/settings/api-keys/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: () => toast({ title: ts('error') }) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/settings/api-keys/${id}/permanent`, { method: 'DELETE' }), onSuccess: refresh, onError: () => toast({ title: ts('error') }) });
  const all = keys.data ?? [];
  const revokedCount = all.filter((k) => k.revoked_at).length;
  const list = showRevoked ? all : all.filter((k) => !k.revoked_at);
  const lvl = (l: Level) => t(`lvl_${l}`);

  return (
    <>
      <Card title={t('keysTitle')} description={t('keysHint')}
        action={<button onClick={() => setEditing('new')} className={primaryBtn}><Plus size={17} /> <span className="hidden sm:inline">{t('newKey')}</span></button>}>
        {keys.isLoading ? <div className="skeleton h-20" /> : !list.length ? <p className="text-sm text-muted">{t('noKeys')}</p> : (
          <ul className="divide-y divide-border">
            {list.map((k) => {
              const st = keyState(k);
              return (
                <li key={k.id} className={clsx('py-4 first:pt-0 last:pb-0', (st === 'revoked' || st === 'expired') && 'opacity-60')}>
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><KeyRound size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        <span className="break-all">{k.name}</span>
                        {st === 'revoked' && <span className={clsx(chip, 'bg-danger-soft text-danger')}>{t('stRevoked')}</span>}
                        {st === 'expired' && <span className={clsx(chip, 'bg-danger-soft text-danger')}>{t('stExpired')}</span>}
                        {st === 'expiring' && <span className={clsx(chip, 'bg-warning-soft text-warning')}>{t('stExpiring', { when: date(k.expires_at!, locale) })}</span>}
                        {st === 'active' && <span className={clsx(chip, 'bg-success-soft text-success')}>{t('stActive')}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {RESOURCES.map((r) => (
                          <span key={r} className={clsx(chip, 'border', (k.permissions[r] ?? 'none') === 'write' ? 'border-warning/30 bg-warning-soft text-warning'
                            : (k.permissions[r] ?? 'none') === 'read' ? 'border-info/30 bg-info-soft text-info' : 'border-border text-muted line-through')}>
                            {t(`res_${r}`)}: {lvl(k.permissions[r] ?? 'none')}
                          </span>
                        ))}
                        {k.allowed_ips.length > 0 && <span className={clsx(chip, 'flex items-center gap-1 border border-border text-muted')}><Globe size={11} />{t('ipCount', { count: k.allowed_ips.length })}</span>}
                        {k.expires_at && st === 'active' && <span className={clsx(chip, 'flex items-center gap-1 border border-border text-muted')}><Clock size={11} />{t('expiresOn', { when: date(k.expires_at, locale) })}</span>}
                      </div>
                      <div className="mt-1.5 text-xs text-muted">
                        <code>sos_{k.prefix}_••••</code> · {t('lastUsed')}: {k.last_used_at ? rel(k.last_used_at) : t('never')}
                        {' · '}{t('req24', { count: k.req_24h })}{k.err_24h > 0 && <span className="text-danger"> ({t('kErrors', { count: k.err_24h })})</span>}
                        {k.rotated_from_name && ` · ${t('rotatedFrom')}`}{k.created_by_name && ` · ${k.created_by_name}`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 pl-[52px]">
                    {!k.revoked_at && <button onClick={() => setEditing(k)} className={smallBtn}><PenLine size={15} /> {t('edit')}</button>}
                    {!k.revoked_at && <button onClick={() => setRotating(k)} className={smallBtn}><RotateCw size={15} /> {t('rotate')}</button>}
                    {!k.revoked_at && (
                      <button onClick={async () => { if (await appConfirm(t('confirmRevoke', { name: k.name }))) revoke.mutate(k.id); }}
                        className={clsx(smallBtn, 'text-danger hover:bg-danger-soft')}><Ban size={15} /> {t('revoke')}</button>
                    )}
                    <button onClick={async () => { if (await appConfirm(t('confirmDelete', { name: k.name }))) remove.mutate(k.id); }}
                      className={clsx(smallBtn, 'text-danger hover:bg-danger-soft')}><Trash2 size={15} /> {t('delete')}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {revokedCount > 0 && (
          <button onClick={() => setShowRevoked(!showRevoked)} className="mt-4 flex items-center gap-1.5 text-sm font-medium text-muted hover:text-text">
            <ChevronDown size={16} className={clsx('transition', showRevoked && 'rotate-180')} />
            {showRevoked ? t('hideRevoked') : t('showRevoked', { count: revokedCount })}
          </button>
        )}
      </Card>

      {editing && (
        <KeyDialog k={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(key) => { setEditing(null); refresh(); if (key) setShown({ title: t('keyCreated'), key }); else toast({ title: ts('saved') }); }} />
      )}
      {rotating && (
        <RotateDialog k={rotating} onClose={() => setRotating(null)} onRotated={(key) => { setRotating(null); refresh(); setShown({ title: t('keyRotated'), key }); }} />
      )}
      {shown && (
        <Dialog title={shown.title} onClose={() => setShown(null)}>
          <p className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{t('copyNow')}</p>
          <Code>{shown.key}</Code>
          <div className="mt-5 flex justify-end border-t border-border pt-4"><button onClick={() => setShown(null)} className={primaryBtn}>{t('copied')}</button></div>
        </Dialog>
      )}
    </>
  );
}

const EXPIRY = ['never', '30', '90', '365', 'custom'] as const;

function KeyDialog({ k, onClose, onSaved }: { k: ApiKey | null; onClose: () => void; onSaved: (key: string | null) => void }) {
  const t = useTranslations('integ');
  const ts = useTranslations('settings');
  const [name, setName] = useState(k?.name ?? '');
  // Older keys have no 'lists' entry: treat it as no access
  const [perms, setPerms] = useState<Perms>(k ? { ...k.permissions, lists: k.permissions.lists ?? 'none', activities: k.permissions.activities ?? 'none', documents: k.permissions.documents ?? 'none' } : { customers: 'write', branches: 'write', spaces: 'write', lists: 'read', activities: 'write', documents: 'read' });
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]>(k?.expires_at ? 'custom' : 'never');
  const [customDate, setCustomDate] = useState(k?.expires_at ? k.expires_at.slice(0, 10) : '');
  const [ips, setIps] = useState((k?.allowed_ips ?? []).join('\n'));
  const [error, setError] = useState<string | null>(null);
  const expiresAt = expiry === 'never' ? null : expiry === 'custom' ? (customDate ? new Date(`${customDate}T23:59:59`).toISOString() : null)
    : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString();
  const ipList = ips.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const noPerm = RESOURCES.every((r) => perms[r] === 'none');
  const save = useMutation({
    mutationFn: () => {
      const json = { name, permissions: perms, expires_at: expiresAt, allowed_ips: ipList };
      return k ? api(`/settings/api-keys/${k.id}`, { method: 'PUT', json }).then(() => null)
        : api<{ key: string }>('/settings/api-keys', { method: 'POST', json }).then((r) => r.key);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError
      ? (e.code === 'validation' && /invalid_ip/.test(JSON.stringify(e.body ?? '')) ? t('errIp') : e.code === 'expiry_in_past' ? t('errExpiry') : e.code)
      : ts('error')),
  });
  const presets: [string, Perms][] = [
    [t('presetFull'), { customers: 'write', branches: 'write', spaces: 'write', lists: 'write', activities: 'write', documents: 'read' }],
    [t('presetRead'), { customers: 'read', branches: 'read', spaces: 'read', lists: 'read', activities: 'read', documents: 'read' }],
    [t('presetCustomers'), { customers: 'write', branches: 'none', spaces: 'none', lists: 'read', activities: 'none', documents: 'none' }],
  ];
  return (
    <Dialog title={k ? t('editKey') : t('newKey')} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-5">
        <div>
          <label htmlFor="key-name" className="mb-1.5 block text-sm font-medium">{t('keyName')}</label>
          <input id="key-name" required minLength={2} maxLength={80} autoFocus={!k} className={input} placeholder="ERP sync" value={name} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1.5 text-xs text-muted">{t('keyNameHint')}</p>
        </div>

        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium">{t('permissions')}</legend>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {presets.map(([label, p]) => (
              <button key={label} type="button" onClick={() => setPerms(p)}
                className={clsx(chip, 'border py-1', JSON.stringify(p) === JSON.stringify(perms) ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-text')}>{label}</button>
            ))}
          </div>
          <div className="divide-y divide-border rounded-2xl border border-border">
            {RESOURCES.map((r) => (
              <div key={r} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="text-sm font-medium">{t(`res_${r}`)}</span>
                <Segmented size="sm" value={perms[r]} onChange={(v) => setPerms({ ...perms, [r]: v })}
                  options={(['none', 'read', 'write'] as Level[]).map((l) => ({ value: l, label: t(`lvl_${l}`) }))} />
              </div>
            ))}
          </div>
          {noPerm && <p className="mt-1.5 text-xs text-danger">{t('errNoPerm')}</p>}
        </fieldset>

        <div>
          <span className="mb-1.5 block text-sm font-medium">{t('expiry')}</span>
          <div className="flex flex-wrap gap-1.5">
            {EXPIRY.map((x) => (
              <button key={x} type="button" onClick={() => setExpiry(x)}
                className={clsx('rounded-xl border px-3 py-1.5 text-sm font-medium', expiry === x ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-text')}>
                {t(`exp_${x}`)}
              </button>
            ))}
          </div>
          {expiry === 'custom' && (
            <input type="date" required min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} className={clsx(input, 'mt-2')} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
          )}
          <p className="mt-1.5 text-xs text-muted">{t('expiryHint')}</p>
        </div>

        <div>
          <label htmlFor="key-ips" className="mb-1.5 block text-sm font-medium">{t('ips')}</label>
          <textarea id="key-ips" rows={3} className={clsx(input, 'font-mono text-sm')} placeholder={'203.0.113.10\n10.20.0.0/16'} value={ips} onChange={(e) => setIps(e.target.value)} />
          <p className="mt-1.5 text-xs text-muted">{t('ipsHint')}</p>
        </div>

        {!k && (
          <div className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" /><span>{t('shownOnce')}</span>
          </div>
        )}
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
          <button disabled={save.isPending || name.trim().length < 2 || noPerm} className={primaryBtn}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : k ? <Check size={16} /> : <KeyRound size={16} />} {k ? ts('save') : t('create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RotateDialog({ k, onClose, onRotated }: { k: ApiKey; onClose: () => void; onRotated: (key: string) => void }) {
  const t = useTranslations('integ');
  const ts = useTranslations('settings');
  const [grace, setGrace] = useState(24);
  const rot = useMutation({
    mutationFn: () => api<{ key: string }>(`/settings/api-keys/${k.id}/rotate`, { method: 'POST', json: { grace_hours: grace } }),
    onSuccess: (r) => onRotated(r.key),
  });
  return (
    <Dialog title={t('rotateTitle', { name: k.name })} onClose={onClose}>
      <p className="text-sm text-muted">{t('rotateIntro')}</p>
      <div className="mt-4 space-y-2" role="radiogroup">
        {[0, 1, 24, 168].map((h) => (
          <button key={h} type="button" role="radio" aria-checked={grace === h} onClick={() => setGrace(h)}
            className={clsx('flex w-full items-center gap-3 rounded-2xl border p-3 text-left', grace === h ? 'border-primary bg-primary-soft/50 ring-1 ring-primary/30' : 'border-border hover:bg-surface-2')}>
            <span className={clsx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', grace === h ? 'border-primary bg-primary text-white' : 'border-border')}>{grace === h && <Check size={12} />}</span>
            <span className="text-sm font-medium">{t(`grace_${h}`)}</span>
          </button>
        ))}
      </div>
      {rot.error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{ts('error')}</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
        <button onClick={() => rot.mutate()} disabled={rot.isPending} className={primaryBtn}>
          {rot.isPending ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />} {t('rotate')}
        </button>
      </div>
    </Dialog>
  );
}

// ======================================================================== webhooks
function WebhooksTab() {
  const t = useTranslations('integ');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const rel = useRel();
  const hooks = useQuery({ queryKey: ['settings', 'webhooks'], queryFn: () => api<{ events: string[]; items: Hook[] }>('/settings/webhooks'), refetchInterval: 15_000 });
  const [editing, setEditing] = useState<Hook | 'new' | null>(null);
  const [deliveriesOf, setDeliveriesOf] = useState<Hook | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'webhooks'] });
  const onErr = () => toast({ title: ts('error') });
  const toggle = useMutation({
    mutationFn: (h: Hook) => api(`/settings/webhooks/${h.id}`, { method: 'PUT', json: { name: h.name, url: h.url, events: h.events, active: !h.active } }),
    onSuccess: refresh, onError: onErr,
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/settings/webhooks/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: onErr });
  const reveal = useMutation({ mutationFn: (h: Hook) => api<{ secret: string }>(`/settings/webhooks/${h.id}/secret`).then((r) => ({ h, s: r.secret })), onSuccess: ({ h, s }) => setSecret({ title: t('secretOf', { name: h.name }), value: s }), onError: onErr });
  const rotate = useMutation({ mutationFn: (h: Hook) => api<{ secret: string }>(`/settings/webhooks/${h.id}/rotate-secret`, { method: 'POST' }).then((r) => ({ h, s: r.secret })), onSuccess: ({ h, s }) => setSecret({ title: t('secretRotated', { name: h.name }), value: s }), onError: onErr });
  const test = async (h: Hook) => {
    setTesting(h.id);
    try {
      const r = await api<{ ok: boolean; status: number | null; ms: number; error: string | null }>(`/settings/webhooks/${h.id}/test`, { method: 'POST' });
      toast({ title: r.ok ? t('testOk', { status: r.status ?? 0, ms: r.ms }) : t('testFail'), body: r.ok ? undefined : (r.error ?? `HTTP ${r.status}`) });
      refresh();
    } catch { onErr(); } finally { setTesting(null); }
  };

  return (
    <>
      <Card title={t('whTitle')} description={t('whHint')}
        action={<button onClick={() => setEditing('new')} className={primaryBtn}><Plus size={17} /> <span className="hidden sm:inline">{t('newWebhook')}</span></button>}>
        {hooks.isLoading ? <div className="skeleton h-20" /> : !hooks.data?.items.length ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <Webhook className="mx-auto text-muted" />
            <p className="mt-2 text-sm text-muted">{t('noWebhooks')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {hooks.data.items.map((h) => {
              const disabledAuto = !h.active && h.consecutive_failures >= 50;
              return (
                <li key={h.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', h.active ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted')}><Webhook size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        {h.name}
                        {h.active ? <span className={clsx(chip, 'bg-success-soft text-success')}>{t('whActive')}</span>
                          : <span className={clsx(chip, 'bg-danger-soft text-danger')}>{disabledAuto ? t('whAutoOff') : t('whPaused')}</span>}
                      </div>
                      <div className="truncate font-mono text-xs text-muted">{h.url}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {h.events.slice(0, 6).map((e) => <span key={e} className={clsx(chip, 'bg-surface-2 font-mono text-muted')}>{e}</span>)}
                        {h.events.length > 6 && <span className={clsx(chip, 'bg-surface-2 text-muted')}>+{h.events.length - 6}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span className="text-success">{t('sent24', { count: h.sent_24h })}</span>
                        {h.failed_24h > 0 && <span className="text-danger">{t('failed24', { count: h.failed_24h })}</span>}
                        {h.pending > 0 && <span className="text-warning">{t('pendingN', { count: h.pending })}</span>}
                        {h.last_success_at && <span>{t('lastOk')}: {rel(h.last_success_at)}</span>}
                        {h.last_failure_at && <span>{t('lastFail')}: {rel(h.last_failure_at)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 pl-[52px]">
                    <button onClick={() => test(h)} disabled={testing === h.id} className={smallBtn}>{testing === h.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {t('test')}</button>
                    <button onClick={() => setDeliveriesOf(h)} className={smallBtn}><ListTree size={15} /> {t('deliveries')}</button>
                    <button onClick={() => setEditing(h)} className={smallBtn}><PenLine size={15} /> {t('edit')}</button>
                    <button onClick={() => toggle.mutate(h)} className={smallBtn}>{h.active ? <><Pause size={15} /> {t('pause')}</> : <><Play size={15} /> {t('resume')}</>}</button>
                    <button onClick={() => reveal.mutate(h)} className={smallBtn}><Eye size={15} /> {t('secret')}</button>
                    <button onClick={async () => { if (await appConfirm(t('confirmRotateSecret'))) rotate.mutate(h); }} className={smallBtn}><RotateCw size={15} /> {t('rotateSecret')}</button>
                    <button onClick={async () => { if (await appConfirm(t('confirmDeleteWebhook', { name: h.name }))) del.mutate(h.id); }} className={clsx(smallBtn, 'text-danger hover:bg-danger-soft')}><Trash2 size={15} /> {t('delete')}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editing && hooks.data && (
        <WebhookDialog hook={editing === 'new' ? null : editing} events={hooks.data.events} onClose={() => setEditing(null)}
          onSaved={(s) => { setEditing(null); refresh(); if (s) setSecret({ title: t('webhookCreated'), value: s }); else toast({ title: ts('saved') }); }} />
      )}
      {deliveriesOf && <DeliveriesDialog hook={deliveriesOf} onClose={() => setDeliveriesOf(null)} />}
      {secret && (
        <Dialog title={secret.title} onClose={() => setSecret(null)}>
          <p className="mb-3 text-sm text-muted">{t('secretHint')}</p>
          <Code>{secret.value}</Code>
          <div className="mt-5 flex justify-end border-t border-border pt-4"><button onClick={() => setSecret(null)} className={primaryBtn}>{t('close')}</button></div>
        </Dialog>
      )}
    </>
  );
}

function WebhookDialog({ hook, events, onClose, onSaved }: { hook: Hook | null; events: string[]; onClose: () => void; onSaved: (secret: string | null) => void }) {
  const t = useTranslations('integ');
  const ts = useTranslations('settings');
  const [name, setName] = useState(hook?.name ?? '');
  const [url, setUrl] = useState(hook?.url ?? 'https://');
  const [sel, setSel] = useState<Set<string>>(new Set(hook?.events ?? ['customer.*', 'branch.*', 'space.*']));
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const e of events) { const k = e.split('.')[0]; g.set(k, [...(g.get(k) ?? []), e]); }
    return [...g.entries()];
  }, [events]);
  const all = sel.has('*');
  const has = (e: string) => all || sel.has(e) || sel.has(`${e.split('.')[0]}.*`);
  const toggleEvent = (e: string) => {
    const n = new Set(sel); const [grp] = e.split('.');
    if (n.has('*')) { n.delete('*'); events.forEach((x) => n.add(x)); }
    if (n.has(`${grp}.*`)) { n.delete(`${grp}.*`); events.filter((x) => x.startsWith(`${grp}.`)).forEach((x) => n.add(x)); }
    if (n.has(e)) n.delete(e); else n.add(e);
    // Collapse a full group into "group.*"
    const groupEvents = events.filter((x) => x.startsWith(`${grp}.`));
    if (groupEvents.every((x) => n.has(x))) { groupEvents.forEach((x) => n.delete(x)); n.add(`${grp}.*`); }
    setSel(n);
  };
  const toggleGroup = (grp: string) => {
    const n = new Set(sel);
    if (n.has('*')) { n.delete('*'); groups.forEach(([g]) => g !== grp && n.add(`${g}.*`)); setSel(n); return; }
    if (n.has(`${grp}.*`)) n.delete(`${grp}.*`);
    else { events.filter((x) => x.startsWith(`${grp}.`)).forEach((x) => n.delete(x)); n.add(`${grp}.*`); }
    setSel(n);
  };
  const save = useMutation({
    mutationFn: () => {
      const json = { name, url, events: [...sel], active: hook?.active ?? true };
      return hook ? api(`/settings/webhooks/${hook.id}`, { method: 'PUT', json }).then(() => null)
        : api<{ secret: string }>('/settings/webhooks', { method: 'POST', json }).then((r) => r.secret);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? (e.code === 'validation' ? t('errWebhook') : e.code) : ts('error')),
  });
  return (
    <Dialog title={hook ? t('editWebhook') : t('newWebhook')} onClose={onClose}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div>
          <label htmlFor="wh-name" className="mb-1.5 block text-sm font-medium">{t('whName')}</label>
          <input id="wh-name" required minLength={2} maxLength={80} className={input} placeholder="ERP" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="wh-url" className="mb-1.5 block text-sm font-medium">{t('whUrl')}</label>
          <input id="wh-url" required type="url" className={clsx(input, 'font-mono text-sm')} placeholder="https://erp.example.com/softify/webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
          <p className="mt-1.5 text-xs text-muted">{t('whUrlHint')}</p>
        </div>
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium">
            {t('whEvents')}
            <button type="button" onClick={() => setSel(all ? new Set() : new Set(['*']))} className="text-xs font-medium text-primary">{all ? t('none') : t('allEvents')}</button>
          </legend>
          <div className="space-y-2">
            {groups.map(([grp, evs]) => {
              const full = all || sel.has(`${grp}.*`);
              return (
                <div key={grp} className="rounded-2xl border border-border p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={full} onChange={() => toggleGroup(grp)} />
                    {t(`grp_${grp}`)} <span className="font-mono text-xs font-normal text-muted">{grp}.*</span>
                  </label>
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                    {evs.map((e) => (
                      <button key={e} type="button" onClick={() => toggleEvent(e)}
                        className={clsx(chip, 'border py-1 font-mono', has(e) ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted')}>{e.split('.')[1]}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {sel.size === 0 && <p className="mt-1.5 text-xs text-danger">{t('errNoEvents')}</p>}
        </fieldset>
        {!hook && (
          <div className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" /><span>{t('whSignedHint')}</span>
          </div>
        )}
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
          <button disabled={save.isPending || name.trim().length < 2 || sel.size === 0} className={primaryBtn}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {hook ? ts('save') : t('create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function StatusIcon({ s }: { s: Delivery['status'] }) {
  return s === 'success' ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : s === 'failed' ? <XCircle size={16} className="shrink-0 text-danger" /> : <Clock size={16} className="shrink-0 text-warning" />;
}

function DeliveriesDialog({ hook, onClose }: { hook: Hook; onClose: () => void }) {
  const t = useTranslations('integ');
  const locale = useLocale();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'all' | 'success' | 'failed' | 'pending'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['settings', 'deliveries', hook.id, status], initialPageParam: null as string | null, refetchInterval: 5000,
    queryFn: ({ pageParam }) => api<Page<Delivery>>(`/settings/webhooks/${hook.id}/deliveries?status=${status}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const redeliver = useMutation({
    mutationFn: (id: string) => api(`/settings/webhook-deliveries/${id}/redeliver`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'deliveries', hook.id] }),
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Dialog title={t('deliveriesOf', { name: hook.name })} onClose={onClose}>
      <div className="mb-3 overflow-x-auto"><Segmented size="sm" value={status} onChange={setStatus}
        options={(['all', 'success', 'failed', 'pending'] as const).map((s) => ({ value: s, label: t(`ds_${s}`) }))} /></div>
      {q.isLoading ? <div className="skeleton h-24" /> : !rows.length ? <p className="py-6 text-center text-sm text-muted">{t('noDeliveries')}</p> : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rows.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => setOpen(open === d.id ? null : d.id)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2">
                <StatusIcon s={d.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm">{d.event}</span>
                  <span className="block text-xs text-muted">
                    {date(d.created_at, locale, { day: 'numeric', month: 'short' })} {time(d.created_at, locale)}
                    {d.response_code ? ` · HTTP ${d.response_code}` : ''}{d.response_ms != null ? ` · ${d.response_ms} ms` : ''}
                    {d.attempts > 1 ? ` · ${t('attempts', { count: d.attempts })}` : ''}
                  </span>
                </span>
                <ChevronDown size={16} className={clsx('shrink-0 text-muted transition', open === d.id && 'rotate-180')} />
              </button>
              {open === d.id && (
                <div className="space-y-2 border-t border-border bg-surface-2/50 px-3 py-3">
                  {d.error && <p className="rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{d.error}</p>}
                  <Code>{JSON.stringify({ id: d.id, ...(d.payload as object) }, null, 2)}</Code>
                  {d.status !== 'pending' && d.event !== 'ping' && (
                    <button onClick={() => redeliver.mutate(d.id)} disabled={redeliver.isPending} className={smallBtn}><RefreshCw size={15} /> {t('redeliver')}</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={clsx(ghostBtn, 'mt-3 w-full')}>{t('more')}</button>}
    </Dialog>
  );
}

// ======================================================================== request log
function LogsTab() {
  const t = useTranslations('integ');
  const locale = useLocale();
  const [status, setStatus] = useState<'all' | 'errors' | 'success'>('all');
  const [keyId, setKeyId] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(h); }, [search]);
  const keys = useQuery({ queryKey: ['settings', 'api-keys'], queryFn: () => api<ApiKey[]>('/settings/api-keys') });
  const params = new URLSearchParams({ status, ...(keyId && { key_id: keyId }), ...(method && { method }), ...(q && { q }) });
  const query = useInfiniteQuery({
    queryKey: ['settings', 'api-log', params.toString()], initialPageParam: null as string | null, refetchInterval: 15_000,
    queryFn: ({ pageParam }) => api<Page<LogRow>>(`/settings/integrations/requests?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const methodTone = (m: string) => (m === 'GET' ? 'bg-info-soft text-info' : m === 'DELETE' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning');

  return (
    <>
      <Card title={t('logTitle')} description={t('logHint')}>
        <div className="mb-4 space-y-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className={clsx(input, 'pl-9')} placeholder={t('searchPath')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: 'all', label: t('fAll') }, { value: 'errors', label: t('fErrors') }, { value: 'success', label: t('fSuccess') }]} />
            <select className={clsx(input, 'w-auto py-1.5 text-sm')} value={keyId} onChange={(e) => setKeyId(e.target.value)} aria-label={t('fKey')}>
              <option value="">{t('fAllKeys')}</option>
              {keys.data?.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <select className={clsx(input, 'w-auto py-1.5 text-sm')} value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t('fMethod')}>
              <option value="">{t('fAllMethods')}</option>
              {['GET', 'PUT', 'POST', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
        {query.isLoading ? <div className="skeleton h-40" /> : !rows.length ? <p className="py-6 text-center text-sm text-muted">{t('noRequests')}</p> : (
          <ul className="-mx-2 divide-y divide-border">
            {rows.map((r) => {
              const bad = r.status >= 400 || (r.failed ?? 0) > 0;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setDetail(r.id)} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2.5 text-left hover:bg-surface-2">
                    <span className={clsx(chip, 'w-16 shrink-0 text-center font-mono', methodTone(r.method))}>{r.method}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm">{r.path.replace(/^\/api/, '')}</span>
                      <span className="block truncate text-xs text-muted">
                        {date(r.created_at, locale, { day: 'numeric', month: 'short' })} {time(r.created_at, locale)} · {r.key_name ?? t('deletedKey')} · {r.duration_ms} ms
                        {r.items != null && ` · ${t('itemsSummary', { items: r.items, created: r.created ?? 0, updated: r.updated ?? 0 })}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className={clsx(chip, 'tabular', r.status >= 400 ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success')}>{r.status}</span>
                      {bad && (r.error || r.failed) ? <span className="max-w-28 truncate text-[11px] text-danger">{r.error ?? t('failedN', { count: r.failed ?? 0 })}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {query.hasNextPage && <button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} className={clsx(ghostBtn, 'mt-3 w-full')}>{t('more')}</button>}
        <p className="mt-3 text-xs text-muted">{t('retention')}</p>
      </Card>
      {detail && <RequestDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('integ');
  const locale = useLocale();
  const { data } = useQuery({ queryKey: ['settings', 'api-log-item', id], queryFn: () => api<LogDetail>(`/settings/integrations/requests/${id}`) });
  const rows: [string, ReactNode][] = data ? [
    [t('dWhen'), `${date(data.created_at, locale)} ${time(data.created_at, locale)}`],
    [t('dKey'), data.key_name ? `${data.key_name} (sos_${data.key_prefix}_…)` : t('deletedKey')],
    [t('dStatus'), <span key="s" className={clsx(chip, data.status >= 400 ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success')}>{data.status}{data.error ? ` · ${data.error}` : ''}</span>],
    [t('dDuration'), `${data.duration_ms} ms`],
    [t('dIp'), data.ip ?? '—'],
    ...(data.items != null ? [[t('dRecords'), t('dRecordsVal', { items: data.items, created: data.created ?? 0, updated: data.updated ?? 0, failed: data.failed ?? 0 })] as [string, ReactNode]] : []),
  ] : [];
  return (
    <Dialog title={data ? `${data.method} ${data.path.replace(/^\/api/, '')}` : '…'} onClose={onClose}>
      {!data ? <div className="skeleton h-32" /> : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
          </dl>
          {data.errors?.length ? (
            <div className="mt-5">
              <h4 className="mb-2 text-sm font-semibold">{t('dErrors')}</h4>
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {data.errors.map((e, i) => (
                  <li key={i} className="px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><code className="font-mono">{e.external_id || '—'}</code><span className={clsx(chip, 'bg-danger-soft text-danger')}>{e.error}</span></div>
                    {e.detail != null && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted">{typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, null, 1)}</pre>}
                  </li>
                ))}
              </ul>
              {(data.failed ?? 0) > data.errors.length && <p className="mt-2 text-xs text-muted">{t('dMoreErrors', { count: (data.failed ?? 0) - data.errors.length })}</p>}
            </div>
          ) : null}
        </>
      )}
    </Dialog>
  );
}

// ======================================================================== docs
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs text-white">{n}</span>{title}</div>
      {children}
    </div>
  );
}

function DocsTab() {
  const t = useTranslations('settings.integrations');
  const ti = useTranslations('integ');
  // Set after mount so server and client render the same HTML (no hydration mismatch)
  const [origin, setOrigin] = useState('https://app.softify.gr');
  useEffect(() => setOrigin(window.location.origin), []);
  const example = {
    ping: `curl ${origin}/api/v1/ping \\\n  -H "Authorization: Bearer $SOFTIFY_KEY"`,
    customers: `curl -X POST ${origin}/api/v1/customers/batch \\
  -H "Authorization: Bearer $SOFTIFY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"items":[
    {"external_id":"ERP-G-1","kind":"group","name":"ACME Group","geo_zone":"Αττική"},
    {"external_id":"ERP-1001","name":"ACME Retail Α.Ε.","vat":"094014201",
     "parent_external_id":"ERP-G-1","account_manager_email":"sales@example.com",
     "address":{"street":"Σταδίου 1","city":"Αθήνα","postal":"10562","region":"Αττικής"}}
  ]}'`,
    branches: `curl -X POST ${origin}/api/v1/branches/batch \\
  -H "Authorization: Bearer $SOFTIFY_KEY" -H "Content-Type: application/json" \\
  -d '{"items":[{"external_id":"ERP-ST-55","customer_external_id":"ERP-1001",
    "name":"Κατάστημα Σταδίου","city":"Αθήνα","region":"Αττικής","geo_zone":"Αττική",
    "fee_schedule":"Βασικό αμοιβολόγιο","tour":"Εξόρμηση Αττικής",
    "ongoing_status":"Σε εξέλιξη","seasonality":"all_year"}]}'`,
    spaces: `curl -X POST ${origin}/api/v1/spaces/batch \\
  -H "Authorization: Bearer $SOFTIFY_KEY" -H "Content-Type: application/json" \\
  -d '{"items":[{"external_id":"ERP-SP-9","branch_external_id":"ERP-ST-55",
    "name":"Εκθεσιακός χώρος","kind":"retail","area_sqm":220}]}'`,
    sync: `curl "${origin}/api/v1/customers?updated_since=2026-11-01T00:00:00Z&limit=500" \\
  -H "Authorization: Bearer $SOFTIFY_KEY"`,
    lists: `# Read a list
curl ${origin}/api/v1/lists/payment_terms -H "Authorization: Bearer $SOFTIFY_KEY"

# Create / update / rename values (records follow a rename)
curl -X PUT ${origin}/api/v1/lists/payment_terms/values \\
  -H "Authorization: Bearer $SOFTIFY_KEY" -H "Content-Type: application/json" \\
  -d '{"values":[
    {"name":"Πίστωση 120 ημερών","sort":8},
    {"name":"Μετρητά με την παράδοση","rename_from":"Μετρητά"},
    {"name":"Κάρτα","active":false}
  ]}'`,
    verify: `// Node.js: verify X-Softify-Signature (use the raw request body)
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // max 5 min old
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}`,
    payload: `POST https://erp.example.com/softify/webhook
X-Softify-Event: customer.updated
X-Softify-Delivery: 0193…
X-Softify-Signature: t=1763300000,v1=5f2c…

{"id":"0193…","event":"customer.updated","occurred_at":"2026-11-16T10:00:00Z",
 "source":{"type":"user","user_id":"…"},
 "changed_fields":["status","address.city","custom.size"],
 "data":{"id":"0193…","external_id":"ERP-1001","code":"CUST-000123","kind":"company",
   "name":"ACME Retail Α.Ε.","vat":"094019245","status":"active","category":"Retail",
   "parent_id":null,"parent_external_id":null,"account_manager_email":"maria@acme.gr",
   "email":"info@acme.gr","phone":"2101234567",
   "address":{"street":"Σταδίου 10","city":"Αθήνα","postal":"10564","region":"Αττικής","country":"GR"},
   "geo_zone":"Αττική","payment_terms":"Πίστωση 60 ημερών","discount":5,"annual_value":150000,
   "custom":{"size":"M"},"branches_count":3,"created_at":"…","updated_at":"…"}}`,
    byId: `# The record of a webhook by its id (also for records created in the app, without external_id)
curl -H "Authorization: Bearer $KEY" \\
  https://app.example.com/api/v1/customers/by-id/0193…    # also /branches/by-id/…, /spaces/by-id/…`,
  };
  return (
    <div className="space-y-4">
      <Card title={t('guideTitle')} description={t('guideHint')}>
        <div className="space-y-4 text-sm">
          <Step n={1} title={t('step1')}><Code>{example.ping}</Code></Step>
          <Step n={2} title={t('step2')}><Code>{example.customers}</Code></Step>
          <Step n={3} title={t('step3')}><Code>{example.branches}</Code></Step>
          <Step n={4} title={t('step4')}><Code>{example.spaces}</Code></Step>
          <Step n={5} title={t('step5')}><Code>{example.sync}</Code></Step>
          <Step n={6} title={ti('docLists')}><Code>{example.lists}</Code></Step>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>{t('rule1')}</li><li>{t('rule2')}</li><li>{t('rule3')}</li><li>{t('rule4')}</li><li>{t('rule5')}</li>
            <li>{ti('rule6')}</li><li>{ti('rule7')}</li><li>{ti('rule8')}</li>
          </ul>
          <a href="/api/v1/openapi.json" target="_blank" rel="noopener" className={clsx(ghostBtn, 'w-full sm:w-auto')}><ExternalLink size={16} /> {t('openapi')}</a>
        </div>
      </Card>
      <Card title={ti('docWhTitle')} description={ti('docWhHint')}>
        <div className="space-y-4 text-sm">
          <Step n={1} title={ti('docWh1')}><Code>{example.payload}</Code></Step>
          <Step n={2} title={ti('docWh2')}><Code>{example.verify}</Code></Step>
          <Step n={3} title={ti('docWh3')}><Code>{example.byId}</Code></Step>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>{ti('whRule1')}</li><li>{ti('whRule2')}</li><li>{ti('whRule3')}</li><li>{ti('whRule4')}</li><li>{ti('whRule5')}</li><li>{ti('whRule6')}</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

// Keep the unused-icon list honest for tree-shaking
void EyeOff;
