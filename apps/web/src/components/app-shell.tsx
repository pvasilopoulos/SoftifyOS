'use client';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Bell, LogOut, Building2, CalendarDays, ChartNoAxesColumn, FileText, Home, LayoutGrid, ListChecks,
  MapPin, MoreHorizontal, Package, Settings, Sparkles, Users, FolderOpen,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { api, type Me } from '@/lib/api';
import { Avatar } from './ui';
import { useLive } from './providers';
import { QuickSettings } from './quick-settings';
import { brandAsset, useBrand, useBrandHead } from '@/lib/brand';
import { TabContent, TabsProvider, useEmbedded } from './tabs';
import { LongPressSheet, QuickOpen, SplitPane, TabBar, TabsCountButton, TabSwitcher, useTabSwipe, useTabSync } from './tabs-ui';

/** Organisation logo + name (Settings → Branding). Public pages pass signedIn={false}. */
export function Logo({ dark = false, signedIn = true }: { dark?: boolean; signedIn?: boolean }) {
  const brand = useBrand(signedIn);
  const logo = brandAsset(brand, 'logo');
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className={clsx('h-9 max-w-[120px] shrink-0 object-contain', dark && 'rounded-lg bg-white p-1')} />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#7c63ff] to-[#4a2ee0] text-lg font-black text-white shadow-md">
          {(brand.name.trim()[0] ?? 'S').toUpperCase()}
        </span>
      )}
      <div className="min-w-0 leading-tight">
        <div className={clsx('truncate text-lg font-extrabold tracking-tight', dark ? 'text-white' : 'text-text')}>{brand.name}</div>
        {brand.tagline && <div className={clsx('truncate text-[11px]', dark ? 'text-white/60' : 'text-muted')}>{brand.tagline}</div>}
      </div>
    </div>
  );
}

const primary = [
  { href: '/', key: 'home', icon: Home },
  { href: '/customers', key: 'customers', icon: Users },
  { href: '/offers', key: 'offers', icon: FileText },
  { href: '/calendar', key: 'calendar', icon: CalendarDays },
] as const;

const secondary = [
  { href: '/more', key: 'crm', icon: Sparkles },
  { href: '/more', key: 'tasks', icon: ListChecks },
  { href: '/more', key: 'documents', icon: FolderOpen },
  { href: '/more', key: 'reports', icon: ChartNoAxesColumn },
  { href: '/more', key: 'groups', icon: Building2 },
  { href: '/more', key: 'branches', icon: MapPin },
  { href: '/more', key: 'products', icon: Package },
  { href: '/settings', key: 'admin', icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), staleTime: 5 * 60_000 });
}

/** The app frame. Inside the split-view frame (?embed=1) only the page itself is shown. */
export function AppShell({ children }: { children: ReactNode }) {
  const embedded = useEmbedded();
  const { data: me } = useMe();
  return (
    <TabsProvider userId={me?.user.id}>
      {embedded ? <main className="mx-auto w-full max-w-6xl px-4 py-4"><TabContent>{children}</TabContent></main> : <Shell>{children}</Shell>}
    </TabsProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  useBrandHead(useBrand());
  useTabSync();
  const swipe = useTabSwipe();
  const t = useTranslations('nav');
  const tm = useTranslations('more');
  const locale = useLocale();
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.href = `/${locale}/login`; };
  const pathname = usePathname();
  const { data: me } = useMe();
  const live = useLive();
  const { data: notif } = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number }>('/notifications'), refetchInterval: 120_000 });

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col bg-sidebar p-5 text-white lg:flex">
        <Logo dark />
        <nav className="mt-8 flex flex-col gap-1">
          {primary.map(({ href, key, icon: Icon }) => (
            <Link key={key} href={href} className={clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
              isActive(pathname, href) ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'text-white/75 hover:bg-white/5 hover:text-white')}>
              <Icon size={19} /> {t(key)}
            </Link>
          ))}
          <div className="my-3 h-px bg-white/10" />
          {secondary.map(({ href, key, icon: Icon }) => (
            <Link key={key} href={href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/65 transition hover:bg-white/5 hover:text-white">
              <Icon size={19} /> {t(key)}
            </Link>
          ))}
        </nav>
        <div className="mt-auto mb-3"><QuickSettings variant="dark" expanded /></div>
        <div className="flex items-center gap-1 rounded-xl bg-white/5 p-2">
          <Link href="/more" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 hover:bg-white/5">
            <span className="relative shrink-0">
              <Avatar name={me?.user.full_name} size={38} />
              <span title="Live" className={clsx('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-sidebar', live ? 'bg-emerald-400' : 'bg-white/30')} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight break-words">{me?.user.full_name ?? '…'}</div>
              <div className="mt-0.5 text-xs leading-tight text-white/60 break-words">{me?.tenant?.title ?? me?.tenant?.name}</div>
            </div>
          </Link>
          <button onClick={logout} title={tm('logout')} aria-label={tm('logout')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-red-300">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        {/* (swipe left / right here to change tab) */}
        <div className="flex items-center justify-between px-4 pt-3 safe-top lg:hidden" {...swipe}>
          <Logo />
          <div className="flex items-center gap-0.5">
            <TabsCountButton />
            <QuickSettings />
            <Link href="/more" aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-full">
              <Bell size={22} />
              {!!notif?.unread && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-bg" />}
            </Link>
          </div>
        </div>
        <TabBar />
        <SplitPane>
          <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-2 md:pt-4 lg:px-8 lg:pb-10 lg:pt-6"><TabContent>{children}</TabContent></main>
        </SplitPane>
        <TabSwitcher />
        <QuickOpen />
        <LongPressSheet />
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md safe-bottom lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {[...primary, { href: '/more', key: 'more', icon: MoreHorizontal } as const].map(({ href, key, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={key} href={href} className={clsx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', active ? 'text-primary' : 'text-muted')}>
                <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                {t(key)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export { LayoutGrid };
