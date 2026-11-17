'use client';
// Calendar → "Sync": connect Google Calendar / Microsoft 365 (two-way: activities out, busy times in),
// plus the read-only iCal link for any other calendar app.
import { useState } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, Copy, Link2, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { relative } from '@/lib/format';
import { appConfirm } from './confirm';
import { IconButton } from './ui';
import { useToast } from './providers';

type Provider = 'google' | 'microsoft';
type Conn = {
  id: string; provider: Provider; account_email: string | null; push_enabled: boolean; import_busy: boolean;
  status: 'active' | 'error' | 'revoked'; last_error: string | null; last_sync_at: string | null; pushed: number; busy: number;
};
type Data = { providers: Record<Provider, boolean>; connections: Conn[]; impersonating: boolean };

export function ProviderLogo({ p, size = 20 }: { p: Provider; size?: number }) {
  return p === 'google' ? (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" /><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" /><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" /></svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" /><rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" /><rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" /><rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" /></svg>
  );
}

export function CalendarSyncDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('calSync');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['calendar-sync'], queryFn: () => api<Data>('/calendar/sync'), refetchInterval: 10_000 });
  const ical = useQuery({ queryKey: ['crm-ical'], queryFn: () => api<{ url: string }>('/crm/ical') });
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['calendar-sync'] }); qc.invalidateQueries({ queryKey: ['calendar-busy'] }); };

  const connect = async (p: Provider) => {
    setBusy(p);
    try { const r = await api<{ url: string }>(`/calendar/oauth/${p}/start`, { method: 'POST', json: { locale } }); window.location.href = r.url; }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'not_configured' ? t('notConfigured') : t('error') }); setBusy(null); }
  };
  const patch = async (c: Conn, b: Partial<Pick<Conn, 'push_enabled' | 'import_busy'>>) => {
    setBusy(c.id);
    try { await api(`/calendar/connections/${c.id}`, { method: 'PATCH', json: b }); refresh(); } catch { toast({ title: t('error') }); }
    setBusy(null);
  };
  const sync = async (c: Conn) => {
    setBusy(`sync-${c.id}`);
    try { await api(`/calendar/connections/${c.id}/sync`, { method: 'POST' }); toast({ title: t('synced') }); refresh(); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'revoked' ? t('revoked') : t('error') }); }
    setBusy(null);
  };
  const remove = async (c: Conn) => {
    if (!(await appConfirm(t('confirmDisconnect', { provider: t(`p_${c.provider}`) }), { danger: true }))) return;
    setBusy(c.id);
    try { await api(`/calendar/connections/${c.id}`, { method: 'DELETE' }); refresh(); } catch { toast({ title: t('error') }); }
    setBusy(null);
  };

  const d = q.data;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-surface sheet-pb sm:rounded-3xl">
        <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-5 sm:px-6">
          <h2 className="text-lg font-bold">{t('title')}</h2>
          <IconButton label="close" onClick={onClose}><X size={20} /></IconButton>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5 sm:px-6">
          <p className="text-sm text-muted">{t('hint')}</p>
          {!d ? <Loader2 className="mx-auto animate-spin text-muted" /> : (
            <ul className="space-y-3">
              {(['google', 'microsoft'] as const).map((p) => {
                const c = d.connections.find((x) => x.provider === p);
                return (
                  <li key={p} className="rounded-2xl border border-border p-3.5">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2"><ProviderLogo p={p} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{t(`p_${p}`)}</div>
                        <div className="truncate text-xs text-muted">
                          {c ? (c.account_email ?? t('connected')) : d.providers[p] ? t('notConnected') : t('notConfigured')}
                        </div>
                      </div>
                      {!c ? (
                        <button type="button" onClick={() => connect(p)} disabled={!d.providers[p] || d.impersonating || busy === p}
                          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                          {busy === p ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} {t('connect')}
                        </button>
                      ) : (
                        <>
                          <IconButton label={t('syncNow')} onClick={() => sync(c)}>{busy === `sync-${c.id}` ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}</IconButton>
                          <IconButton label={t('disconnect')} onClick={() => remove(c)}><Trash2 size={18} className="text-danger" /></IconButton>
                        </>
                      )}
                    </div>
                    {c && (
                      <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                        {c.status !== 'active' && (
                          <p className="flex items-start gap-2 rounded-xl bg-danger-soft p-2.5 text-xs text-danger">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            <span>{t('revoked')} <button type="button" className="font-semibold underline" onClick={() => connect(p)}>{t('reconnect')}</button></span>
                          </p>
                        )}
                        <Toggle checked={c.push_enabled} disabled={busy === c.id} onChange={(v) => patch(c, { push_enabled: v })} label={t('push')} hint={t('pushHint', { n: c.pushed })} />
                        <Toggle checked={c.import_busy} disabled={busy === c.id} onChange={(v) => patch(c, { import_busy: v })} label={t('import')} hint={t('importHint', { n: c.busy })} />
                        <div className={clsx('text-xs', c.last_error ? 'text-danger' : 'text-muted')}>
                          {c.last_error ? `${t('lastError')}: ${c.last_error}` : c.last_sync_at ? `${t('lastSync')}: ${relative(c.last_sync_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}` : t('pending')}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {d && (!d.providers.google || !d.providers.microsoft) && <p className="text-xs text-muted">{t('adminHint')}</p>}
          {d?.impersonating && <p className="text-xs text-warning">{t('impersonating')}</p>}

          <div className="rounded-2xl border border-border p-3.5">
            <div className="font-semibold">{t('icalTitle')}</div>
            <p className="mb-2 text-xs text-muted">{t('icalHint')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-2 text-xs">{ical.data?.url ?? '…'}</code>
              <button type="button" disabled={!ical.data} onClick={async () => { await navigator.clipboard.writeText(ical.data!.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-soft px-3 py-2 text-sm font-semibold text-primary">
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t('copied') : t('copy')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-2.5">
      <input type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
      <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
    </label>
  );
}

export type BusyBlock = { id: string; title: string | null; starts_at: string; ends_at: string; all_day: boolean; provider: Provider };
