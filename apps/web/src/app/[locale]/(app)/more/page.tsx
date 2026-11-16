'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Bell, BellOff, Download, Globe, LogOut, Moon, Send, Sun, Monitor } from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push';
import { Link, usePathname } from '@/i18n/navigation';
import { useMe } from '@/components/app-shell';
import { Avatar, PageHeader, SectionTitle, Segmented } from '@/components/ui';

type Notif = { items: { id: string; title: string; body: string | null; url: string | null; read_at: string | null; created_at: string }[]; unread: number };
type BeforeInstallPrompt = Event & { prompt: () => Promise<void> };

export default function MorePage() {
  const t = useTranslations('more');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [push, setPush] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [installEvt, setInstallEvt] = useState<BeforeInstallPrompt | null>(null);

  useEffect(() => {
    getPushState().then(setPush).catch(() => setPush('unsupported'));
    try { setTheme((localStorage.getItem('theme') as typeof theme) ?? 'system'); } catch {}
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as BeforeInstallPrompt); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const notif = useQuery({ queryKey: ['notifications'], queryFn: () => api<Notif>('/notifications') });
  const markRead = useMutation({
    mutationFn: () => api('/notifications/read', { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function applyTheme(v: typeof theme) {
    setTheme(v);
    try { localStorage.setItem('theme', v); } catch {}
    const dark = v === 'dark' || (v === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }

  async function onEnable() {
    setBusy(true);
    try { setPush(await enablePush()); } catch { setPush(await getPushState()); } finally { setBusy(false); }
  }
  async function onDisable() { setBusy(true); await disablePush(); setPush(await getPushState()); setBusy(false); }
  async function onTest() { await api('/push/test', { method: 'POST' }); setSent(true); setTimeout(() => setSent(false), 3000); }
  async function logout() { await api('/auth/logout', { method: 'POST' }); location.href = `/${locale}/login`; }

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />

      <section className="card flex items-center gap-3 p-4">
        <Avatar name={me?.user.full_name} size={48} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{me?.user.full_name}</div>
          <div className="truncate text-sm text-muted">{me?.user.email}</div>
          <div className="text-xs text-muted">{t('tenant')}: {me?.tenant?.name} · {me?.tenant?.role}</div>
        </div>
      </section>

      <section className="card p-4">
        <SectionTitle>{t('notifications')}</SectionTitle>
        {push === 'subscribed' ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm text-success"><Bell size={16} /> {t('pushEnabled')}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={onTest} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">
                <Send size={16} /> {sent ? t('testSent') : t('testPush')}
              </button>
              <button onClick={onDisable} disabled={busy} className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm"><BellOff size={16} /> {t('disablePush')}</button>
            </div>
          </div>
        ) : push === 'default' ? (
          <button onClick={onEnable} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-60">
            <Bell size={18} /> {t('enablePush')}
          </button>
        ) : push === 'denied' ? <p className="text-sm text-danger">{t('pushDenied')}</p>
          : push === 'ios-needs-install' ? <p className="text-sm text-muted">{t('iosHint')}</p>
          : push === 'unsupported' ? <p className="text-sm text-muted">{t('pushUnsupported')}</p> : null}
        {push !== 'subscribed' && push !== 'loading' && (
          <button onClick={onTest} className="mt-3 text-sm font-medium text-primary">{sent ? t('testSent') : t('testPush')} (in-app)</button>
        )}
      </section>

      <section className="card p-4">
        <SectionTitle action={!!notif.data?.unread && <button onClick={() => markRead.mutate()} className="text-sm font-medium text-primary">{t('markRead')}</button>}>
          {t('inbox')} {!!notif.data?.unread && <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs text-white">{notif.data.unread}</span>}
        </SectionTitle>
        {notif.data?.items.length ? (
          <ul className="divide-y divide-border">
            {notif.data.items.slice(0, 10).map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-2.5">
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary')} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="text-sm text-muted">{n.body}</div>}
                </div>
                <span className="shrink-0 text-xs text-muted">{relative(n.created_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">{t('noNotifications')}</p>}
      </section>

      <section className="card space-y-4 p-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Globe size={16} /> {t('language')}</div>
          <div className="flex gap-2">
            {(['el', 'en'] as const).map((l) => (
              <Link key={l} href={pathname} locale={l} className={clsx('rounded-full px-4 py-1.5 text-sm font-medium', locale === l ? 'bg-primary text-white' : 'border border-border text-muted')}>
                {l === 'el' ? 'Ελληνικά' : 'English'}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">{t('theme')}</div>
          <Segmented value={theme} onChange={applyTheme} options={[
            { value: 'light', label: <span className="flex items-center gap-1.5"><Sun size={15} />{t('light')}</span> },
            { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon size={15} />{t('dark')}</span> },
            { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor size={15} />{t('system')}</span> },
          ]} />
        </div>
        {installEvt && (
          <button onClick={() => installEvt.prompt()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-soft py-3 font-semibold text-primary">
            <Download size={18} /> {t('install')}
          </button>
        )}
      </section>

      <button onClick={logout} className="card flex w-full items-center justify-center gap-2 py-3 font-semibold text-danger"><LogOut size={18} /> {t('logout')}</button>
    </div>
  );
}
