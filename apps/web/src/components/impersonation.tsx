'use client';
// "Sign in as" (Settings → Users): an admin sees the app exactly as another user. While it lasts a bar on top
// says so and takes them back to their own account. The session ends by itself after 2 hours.
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, LogIn, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { appConfirm } from './confirm';
import { useToast } from './providers';
import { useMe } from './app-shell';

/** Full reload: every cached query (lists, tabs, permissions) belongs to the previous user. */
const reload = (locale: string) => { location.href = `/${locale}`; };

export function ImpersonateButton({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations('impersonation');
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!(await appConfirm(t('confirm', { name })))) return;
    setBusy(true);
    try { await api(`/settings/users/${userId}/impersonate`, { method: 'POST' }); reload(locale); }
    catch { toast({ title: t('error') }); setBusy(false); }
  };
  return (
    <button onClick={go} disabled={busy} title={t('signInAs', { name })} aria-label={t('signInAs', { name })}
      className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-primary-soft hover:text-primary disabled:opacity-50">
      {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
    </button>
  );
}

export function ImpersonationBar() {
  const t = useTranslations('impersonation');
  const locale = useLocale();
  const { data: me } = useMe();
  const [busy, setBusy] = useState(false);
  if (!me?.impersonator) return null;
  const stop = async () => {
    setBusy(true);
    await api('/auth/impersonate/stop', { method: 'POST' }).catch(() => {});
    reload(locale);
  };
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warning px-4 py-2 text-sm font-medium text-white safe-top">
      <span className="min-w-0 text-center">{t('banner', { name: me.user.full_name, admin: me.impersonator.full_name })}</span>
      <button onClick={stop} disabled={busy}
        className="flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1 font-semibold hover:bg-white/30 disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} {t('stop')}
      </button>
    </div>
  );
}
