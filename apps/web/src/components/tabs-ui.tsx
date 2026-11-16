'use client';
import { appPrompt } from './confirm';
// Tabs UI: desktop/tablet bar (pinned, groups, drag & drop, context menu), phone switcher (cards, swipe to close),
// quick open (Alt+T), long-press sheet, split view, tabs from other devices.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Building2, CalendarDays, Columns2, Contact, Copy, ExternalLink, FileText, FolderPlus, Home, Laptop, LayoutGrid, Link2,
  Loader2, MoreHorizontal, Pin, PinOff, Plus, Search, Settings, Smartphone, SplitSquareHorizontal, Users, X, type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { matchRank } from '@/lib/search';
import { GROUP_COLORS, LONG_PRESS_EVENT, useTabs, type Tab, type TabGroup } from './tabs';
import { useSavedViews } from './saved-views';
import { useToast } from './providers';

export const TAB_ICONS: Record<string, LucideIcon> = {
  home: Home, customers: Users, customer: Contact, offers: FileText, offer: FileText, calendar: CalendarDays,
  settings: Settings, more: MoreHorizontal, new: Plus, page: Building2,
};
const DOT: Record<string, string> = { primary: 'bg-primary', info: 'bg-info', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', muted: 'bg-muted' };
const SOFT: Record<string, string> = { primary: 'bg-primary-soft text-primary', info: 'bg-info-soft text-info', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', muted: 'bg-surface-2 text-muted' };
const TabIcon = ({ icon, size = 15, className }: { icon: string; size?: number; className?: string }) => {
  const I = TAB_ICONS[icon] ?? Building2;
  return <I size={size} className={className} />;
};

// ================================================================ context menu (desktop right-click / phone "…")
type MenuState = { x: number; y: number; tab?: Tab; group?: TabGroup } | null;

function Menu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const t = useTranslations('tabs');
  const ctx = useTabs()!;
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(menu.x, window.innerWidth - r.width - 8), top: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu]);
  if (!menu) return null;
  const s = ctx.state;
  const Item = ({ icon: I, children, onClick, danger }: { icon?: LucideIcon; children: ReactNode; onClick: () => void; danger?: boolean }) => (
    <button onClick={() => { onClose(); onClick(); }} className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2', danger && 'text-danger')}>
      {I ? <I size={15} className="shrink-0 text-muted" /> : <span className="w-[15px]" />}{children}
    </button>
  );
  const Sep = () => <div className="my-1 border-t border-border" />;
  const tab = menu.tab;
  const group = menu.group ?? (tab?.group ? s.groups.find((g) => g.id === tab.group) : undefined);
  const idx = tab ? s.tabs.findIndex((x) => x.id === tab.id) : -1;
  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div ref={ref} role="menu" style={pos ?? { left: menu.x, top: menu.y, visibility: 'hidden' }}
        className="fixed z-[61] w-60 rounded-2xl border border-border bg-surface p-1.5 shadow-2xl">
        {tab && (
          <>
            <Item icon={tab.pinned ? PinOff : Pin} onClick={() => ctx.pin(tab.id, !tab.pinned)}>{tab.pinned ? t('unpin') : t('pin')}</Item>
            <Item icon={Copy} onClick={() => ctx.duplicate(tab.id)}>{t('duplicate')}</Item>
            <Item icon={Link2} onClick={async () => { await navigator.clipboard.writeText(new URL(tab.url, location.origin).toString()); toast({ title: t('linkCopied') }); }}>{t('copyLink')}</Item>
            <Item icon={ExternalLink} onClick={() => window.open(tab.url, '_blank', 'noopener')}>{t('openInBrowserTab')}</Item>
            {tab.id !== s.activeId && <Item icon={SplitSquareHorizontal} onClick={() => ctx.openSplit(tab.id)}>{t('openSplit')}</Item>}
            <Sep />
            <Item icon={FolderPlus} onClick={() => ctx.newGroup(tab.id, tab.title.slice(0, 24))}>{t('newGroup')}</Item>
            {s.groups.filter((g) => g.id !== tab.group).map((g) => (
              <Item key={g.id} onClick={() => ctx.setGroup(tab.id, g.id)}><span className={clsx('mr-0.5 inline-block h-2.5 w-2.5 rounded-full', DOT[g.color])} />{t('addToGroup', { name: g.name })}</Item>
            ))}
            {tab.group && <Item onClick={() => ctx.setGroup(tab.id, null)}>{t('removeFromGroup')}</Item>}
            <Sep />
            <Item icon={X} onClick={() => ctx.close(tab.id)}>{t('close')}</Item>
            <Item onClick={() => ctx.closeMany(s.tabs.filter((x) => x.id !== tab.id && !x.pinned).map((x) => x.id))}>{t('closeOthers')}</Item>
            <Item onClick={() => ctx.closeMany(s.tabs.slice(idx + 1).filter((x) => !x.pinned).map((x) => x.id))}>{t('closeRight')}</Item>
          </>
        )}
        {!tab && group && (
          <>
            <div className="flex flex-wrap gap-1.5 px-2.5 py-2">
              {GROUP_COLORS.map((c) => (
                <button key={c} aria-label={c} onClick={() => ctx.updateGroup(group.id, { color: c })}
                  className={clsx('h-6 w-6 rounded-full ring-offset-2 ring-offset-surface', DOT[c], group.color === c && 'ring-2 ring-primary')} />
              ))}
            </div>
            <Item onClick={async () => { const n = (await appPrompt(t('groupName'), group.name))?.trim(); if (n) ctx.updateGroup(group.id, { name: n.slice(0, 30) }); }}>{t('renameGroup')}</Item>
            <Item onClick={() => ctx.updateGroup(group.id, { collapsed: !group.collapsed })}>{group.collapsed ? t('expandGroup') : t('collapseGroup')}</Item>
            <Item onClick={() => ctx.ungroup(group.id)}>{t('ungroup')}</Item>
            <Sep />
            <Item icon={X} danger onClick={() => ctx.closeGroup(group.id)}>{t('closeGroup')}</Item>
          </>
        )}
      </div>
    </>
  );
}

// ================================================================ desktop / tablet bar
export function TabBar() {
  const t = useTranslations('tabs');
  const ctx = useTabs();
  const [menu, setMenu] = useState<MenuState>(null);
  const drag = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [ctx?.state.activeId]);
  if (!ctx?.ready) return null;
  const s = ctx.state;
  const group = (id: string | null) => (id ? s.groups.find((g) => g.id === id) : undefined);

  return (
    <div className="sticky top-0 z-30 hidden border-b border-border bg-bg/90 backdrop-blur-md md:block">
      <div className="flex items-end gap-1 px-2 pt-1.5 lg:px-4">
        <div className="no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {s.tabs.map((tab, i) => {
            const g = group(tab.group);
            const firstOfGroup = g && s.tabs[i - 1]?.group !== g.id;
            const hidden = g?.collapsed && tab.id !== s.activeId;
            const active = tab.id === s.activeId;
            return (
              <div key={tab.id} className="flex shrink-0 items-end">
                {firstOfGroup && (
                  <button onClick={() => ctx.updateGroup(g.id, { collapsed: !g.collapsed })} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, group: g }); }}
                    title={g.collapsed ? t('expandGroup') : t('collapseGroup')}
                    className={clsx('mb-1.5 mr-1 flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold', SOFT[g.color])}>
                    <span className={clsx('h-2 w-2 rounded-full', DOT[g.color])} />
                    <span className="max-w-28 truncate">{g.name}</span>
                    {g.collapsed && <span className="opacity-70">{s.tabs.filter((x) => x.group === g.id).length}</span>}
                  </button>
                )}
                {!hidden && (
                  <div ref={active ? activeRef : undefined} role="tab" aria-selected={active} draggable title={tab.title}
                    onDragStart={(e) => { drag.current = i; e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)}
                    onDrop={(e) => { e.preventDefault(); if (drag.current !== null) ctx.move(drag.current, i); drag.current = null; setOver(null); }}
                    onDragEnd={() => { drag.current = null; setOver(null); }}
                    onClick={() => ctx.activate(tab.id)}
                    onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); ctx.close(tab.id); } }}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, tab }); }}
                    className={clsx('group relative flex h-9 cursor-pointer select-none items-center gap-2 rounded-t-xl border border-b-0 text-sm transition',
                      tab.pinned ? 'w-10 justify-center px-0' : 'w-40 px-3 lg:w-48',
                      active ? 'border-border bg-surface font-medium text-text shadow-[0_-1px_4px_rgb(0_0_0/0.04)]' : 'border-transparent text-muted hover:bg-surface-2 hover:text-text',
                      over === i && 'ring-2 ring-primary/40')}>
                    {g && <span className={clsx('absolute inset-x-2 top-0 h-0.5 rounded-full', DOT[g.color])} />}
                    <TabIcon icon={tab.icon} className={clsx('shrink-0', active && 'text-primary')} />
                    {!tab.pinned && <span className="min-w-0 flex-1 truncate">{tab.title}</span>}
                    {!tab.pinned && (
                      <span className="relative grid h-5 w-5 shrink-0 place-items-center">
                        {tab.dirty && <span className="h-2 w-2 rounded-full bg-warning group-hover:hidden" title={t('unsaved')} />}
                        <button aria-label={t('close')} onClick={(e) => { e.stopPropagation(); ctx.close(tab.id); }}
                          className={clsx('absolute inset-0 grid place-items-center rounded-md hover:bg-surface-2', tab.dirty ? 'hidden group-hover:grid' : active ? 'grid' : 'hidden group-hover:grid')}>
                          <X size={13} />
                        </button>
                      </span>
                    )}
                    {tab.pinned && tab.dirty && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning" />}
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={() => ctx.setQuickOpen(true)} aria-label={t('newTab')} title={`${t('newTab')} (Alt+T)`}
            className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"><Plus size={16} /></button>
        </div>
        <div className="mb-1 flex shrink-0 items-center gap-0.5">
          {s.split
            ? <button onClick={ctx.closeSplit} title={t('closeSplit')} className="grid h-7 w-7 place-items-center rounded-lg text-primary hover:bg-surface-2"><Columns2 size={16} /></button>
            : s.tabs.length > 1 && <button onClick={() => ctx.openSplit(s.tabs.find((x) => x.id !== s.activeId)!.id)} title={t('openSplit')} className="hidden h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text xl:grid"><Columns2 size={16} /></button>}
          <button onClick={() => ctx.setSwitcher(true)} title={`${t('allTabs')} (Alt+K)`} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"><LayoutGrid size={16} /></button>
        </div>
      </div>
      <Menu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

// ================================================================ phone: count button + swipe on the top bar
export function TabsCountButton() {
  const t = useTranslations('tabs');
  const ctx = useTabs();
  if (!ctx?.ready) return null;
  const n = ctx.state.tabs.length;
  const dirty = ctx.state.tabs.some((x) => x.dirty);
  return (
    <button onClick={() => ctx.setSwitcher(true)} aria-label={t('allTabs')} className="relative grid h-10 w-10 place-items-center rounded-full md:hidden">
      <span className="grid h-6 min-w-6 place-items-center rounded-md border-2 border-current px-1 text-[11px] font-bold tabular">{n > 99 ? '∞' : n}</span>
      {dirty && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-bg" />}
    </button>
  );
}

/** Horizontal swipe on an element (the phone top bar) switches to the previous / next tab. */
export function useTabSwipe() {
  const ctx = useTabs();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => { const p = e.touches[0]; start.current = { x: p.clientX, y: p.clientY, t: Date.now() }; },
    onTouchEnd: (e: React.TouchEvent) => {
      const s0 = start.current; start.current = null;
      if (!s0 || !ctx || ctx.state.tabs.length < 2) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - s0.x, dy = p.clientY - s0.y;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 40 && Date.now() - s0.t < 600) ctx.next(dx < 0 ? 1 : -1);
    },
  };
}

// ================================================================ switcher (phone grid; also "all tabs" on desktop)
function SwipeCard({ tab, active, group, onOpen, onClose, onMenu }: { tab: Tab; active: boolean; group?: TabGroup; onOpen: () => void; onClose: () => void; onMenu: (e: React.MouseEvent | React.TouchEvent) => void }) {
  const t = useTranslations('tabs');
  const locale = useLocale();
  const ta = useTranslations('activity');
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const path = tab.url.replace(/^\/(el|en)/, '').split('?')[0] || '/';
  return (
    <div className="relative" style={{ transform: `translateX(${dx}px)`, opacity: 1 - Math.min(Math.abs(dx) / 220, 0.7), transition: start.current === null ? 'transform .2s, opacity .2s' : 'none' }}
      onTouchStart={(e) => { start.current = e.touches[0].clientX; }}
      onTouchMove={(e) => { if (start.current !== null) setDx(Math.min(0, e.touches[0].clientX - start.current)); }}
      onTouchEnd={() => { start.current = null; if (dx < -110) onClose(); else setDx(0); }}>
      <button onClick={onOpen} onContextMenu={(e) => { e.preventDefault(); onMenu(e); }}
        className={clsx('card flex h-32 w-full flex-col overflow-hidden text-left transition', active && 'ring-2 ring-primary')}>
        <div className={clsx('flex items-center gap-2 px-3 py-2', group ? SOFT[group.color] : 'bg-surface-2 text-muted')}>
          <TabIcon icon={tab.icon} size={14} />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{group?.name ?? path}</span>
          {tab.pinned && <Pin size={12} />}
        </div>
        <div className="flex flex-1 flex-col justify-between p-3">
          <span className="line-clamp-2 text-sm font-semibold leading-snug">{tab.title}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            {tab.dirty && <span className="rounded-full bg-warning-soft px-1.5 font-medium text-warning">{t('unsaved')}</span>}
            {relative(new Date(tab.lastActive).toISOString(), locale, { today: ta('today'), yesterday: ta('yesterday') })}
          </span>
        </div>
      </button>
      <button onClick={onClose} aria-label={t('close')} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-surface/90 text-muted shadow hover:text-danger"><X size={14} /></button>
    </div>
  );
}

export function TabSwitcher() {
  const t = useTranslations('tabs');
  const ctx = useTabs();
  const [menu, setMenu] = useState<MenuState>(null);
  const [q, setQ] = useState('');
  useEffect(() => { if (!ctx?.switcher) setQ(''); }, [ctx?.switcher]);
  if (!ctx?.switcher) return null;
  const s = ctx.state;
  const close = () => ctx.setSwitcher(false);
  const shown = s.tabs.filter((x) => !q || matchRank(`${x.title} ${x.url}`, q) !== null);
  const grouped = [...s.groups.map((g) => ({ g, tabs: shown.filter((x) => x.group === g.id) })), { g: undefined, tabs: shown.filter((x) => !x.group) }].filter((x) => x.tabs.length);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-label={t('allTabs')}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 safe-top">
        <h2 className="flex-1 text-lg font-bold">{t('tabsCount', { count: s.tabs.length })}</h2>
        <button onClick={() => { close(); ctx.setQuickOpen(true); }} className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-semibold text-white"><Plus size={16} /> {t('newTab')}</button>
        <button onClick={close} className="rounded-full px-3 py-2 text-sm font-semibold text-primary">{t('done')}</button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <label className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search size={16} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchTabs')} className="w-full bg-transparent py-2.5 text-sm outline-none" />
        </label>
        <div className="space-y-5">
          {grouped.map(({ g, tabs }) => (
            <section key={g?.id ?? 'none'}>
              {g && (
                <button onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, group: g })} className={clsx('mb-2 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', SOFT[g.color])}>
                  <span className={clsx('h-2 w-2 rounded-full', DOT[g.color])} />{g.name} · {tabs.length}
                </button>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {tabs.map((tab) => (
                  <SwipeCard key={tab.id} tab={tab} active={tab.id === s.activeId} group={g}
                    onOpen={() => { ctx.activate(tab.id); close(); }} onClose={() => ctx.close(tab.id)}
                    onMenu={(e) => { const p = 'touches' in e ? e.touches[0] : e; setMenu({ x: p.clientX, y: p.clientY, tab }); }} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <OtherDevices onOpen={(url) => { ctx.openTab(url); close(); }} />
        <p className="mt-6 text-center text-xs text-muted">{t('switcherHint')}</p>
      </div>
      <div className="flex justify-center border-t border-border p-3 sheet-pb">
        <button onClick={() => ctx.closeMany(s.tabs.filter((x) => !x.pinned).map((x) => x.id))} className="rounded-xl px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft">{t('closeAll')}</button>
      </div>
      <Menu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

// ================================================================ tabs from other devices (sync)
type DeviceTabs = { device_id: string; device_label: string; updated_at: string; tabs: { url: string; title: string; icon: string }[] };
function OtherDevices({ onOpen }: { onOpen: (url: string) => void }) {
  const t = useTranslations('tabs');
  const locale = useLocale();
  const ta = useTranslations('activity');
  const { data } = useQuery({ queryKey: ['tabs', 'devices'], queryFn: () => api<DeviceTabs[]>(`/me/tabs/devices?device=${deviceId()}`), staleTime: 30_000 });
  if (!data?.length) return null;
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('otherDevices')}</h3>
      <div className="space-y-3">
        {data.map((d) => (
          <div key={d.device_id} className="card p-3">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              {/iphone|android|mobile/i.test(d.device_label) ? <Smartphone size={15} className="text-muted" /> : <Laptop size={15} className="text-muted" />}
              {d.device_label}
              <span className="text-xs font-normal text-muted">· {relative(d.updated_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}</span>
            </div>
            <ul className="divide-y divide-border">
              {d.tabs.map((x, i) => (
                <li key={i}><button onClick={() => onOpen(x.url)} className="flex w-full items-center gap-2 py-1.5 text-left text-sm hover:text-primary">
                  <TabIcon icon={x.icon} size={14} className="shrink-0 text-muted" /><span className="truncate">{x.title}</span>
                </button></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function deviceId() {
  try {
    let id = localStorage.getItem('sos.device');
    if (!id) { id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem('sos.device', id); }
    return id;
  } catch { return 'unknown'; }
}
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : 'Android tablet') : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const pwa = window.matchMedia('(display-mode: standalone)').matches ? ' · App' : '';
  return `${os}${br ? ` · ${br}` : ''}${pwa}`;
}

/** Publishes this device's tabs (debounced) so other devices can open them. */
export function useTabSync() {
  const ctx = useTabs();
  const payload = useMemo(() => (ctx?.ready ? JSON.stringify(ctx.state.tabs.map((x) => ({ url: x.url, title: x.title, icon: x.icon }))) : null), [ctx?.ready, ctx?.state.tabs]);
  useEffect(() => {
    if (!payload || ctx?.embedded) return;
    const h = setTimeout(() => {
      api('/me/tabs', { method: 'PUT', json: { device_id: deviceId(), device_label: deviceLabel(), tabs: JSON.parse(payload) } }).catch(() => {});
    }, 2500);
    return () => clearTimeout(h);
  }, [payload, ctx?.embedded]);
}

// ================================================================ quick open (new tab)
type QuickItem = { key: string; title: string; hint?: string; icon: string; url: string };
export function QuickOpen() {
  const t = useTranslations('tabs');
  const tn = useTranslations('nav');
  const ctx = useTabs();
  const views = useSavedViews();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [dq, setDq] = useState('');
  useEffect(() => { const h = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(h); }, [q]);
  useEffect(() => { if (ctx?.quickOpen) { setQ(''); setSel(0); } }, [ctx?.quickOpen]);
  const customers = useQuery({
    queryKey: ['quick-open', 'customers', dq], enabled: !!ctx?.quickOpen && dq.length >= 2,
    queryFn: () => api<{ items: { id: string; name: string; code: string; address_city: string | null }[] }>(`/customers?limit=6&q=${encodeURIComponent(dq)}`),
  });
  const pages: QuickItem[] = [
    { key: 'home', title: tn('home'), icon: 'home', url: '/' },
    { key: 'customers', title: tn('customers'), icon: 'customers', url: '/customers' },
    { key: 'offers', title: tn('offers'), icon: 'offers', url: '/offers' },
    { key: 'calendar', title: tn('calendar'), icon: 'calendar', url: '/calendar' },
    { key: 'new-customer', title: t('newCustomer'), icon: 'new', url: '/customers/new' },
    { key: 'new-offer', title: t('newOffer'), icon: 'new', url: '/offers/new' },
    { key: 'settings', title: tn('admin'), icon: 'settings', url: '/settings' },
    { key: 'more', title: tn('more'), icon: 'more', url: '/more' },
  ];
  const viewItems: QuickItem[] = (views.data?.views ?? []).filter((v) => v.applies).map((v) => ({ key: `v${v.id}`, title: v.name, hint: t('savedView'), icon: 'customers', url: `/customers?v=${v.id}` }));
  const match = (x: QuickItem) => !q.trim() || matchRank(`${x.title} ${x.hint ?? ''}`, q) !== null;
  const sections: { title: string; items: QuickItem[] }[] = [
    { title: t('pages'), items: pages.filter(match) },
    { title: t('savedViews'), items: viewItems.filter(match).slice(0, q ? 8 : 5) },
    { title: tn('customers'), items: (customers.data?.items ?? []).map((c) => ({ key: c.id, title: c.name, hint: [c.code, c.address_city].filter(Boolean).join(' · '), icon: 'customer', url: `/customers/${c.id}` })) },
  ].filter((x) => x.items.length);
  const flat = sections.flatMap((x) => x.items);
  if (!ctx?.quickOpen) return null;
  const go = (it: QuickItem, background = false) => { ctx.openTab(it.url, { background }); if (!background) ctx.setQuickOpen(false); };
  let n = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 sm:pt-[10vh]" onClick={() => ctx.setQuickOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('newTab')}
        className="flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-3xl">
        <div className="flex items-center gap-2 border-b border-border px-4 safe-top">
          <Search size={18} className="text-muted" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder={t('quickOpenPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(x + 1, flat.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
              else if (e.key === 'Enter' && flat[sel]) { e.preventDefault(); go(flat[sel], e.altKey); }
              else if (e.key === 'Escape') ctx.setQuickOpen(false);
            }}
            className="w-full bg-transparent py-4 outline-none" />
          {customers.isFetching && <Loader2 size={16} className="animate-spin text-muted" />}
          <button onClick={() => ctx.setQuickOpen(false)} aria-label={t('close')} className="grid h-8 w-8 place-items-center rounded-lg text-muted sm:hidden"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {sections.map((sec) => (
            <div key={sec.title} className="mb-2">
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">{sec.title}</div>
              {sec.items.map((it) => {
                n++;
                const i = n;
                return (
                  <button key={it.key} onClick={() => go(it)} onMouseEnter={() => setSel(i)}
                    className={clsx('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left', sel === i && 'bg-surface-2')}>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><TabIcon icon={it.icon} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{it.title}</span>{it.hint && <span className="block truncate text-xs text-muted">{it.hint}</span>}</span>
                    <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); go(it, true); }} title={t('openInBackground')}
                      className="hidden rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface sm:inline">{t('background')}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {!sections.length && <p className="p-6 text-center text-sm text-muted">{t('noResults')}</p>}
          <OtherDevices onOpen={(url) => { ctx.openTab(url); ctx.setQuickOpen(false); }} />
        </div>
        <div className="hidden border-t border-border px-4 py-2 text-[11px] text-muted sm:block">{t('quickOpenHint')}</div>
      </div>
    </div>
  );
}

// ================================================================ long-press sheet (phones)
export function LongPressSheet() {
  const t = useTranslations('tabs');
  const ctx = useTabs();
  const [link, setLink] = useState<{ url: string; text: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setLink((e as CustomEvent<{ url: string; text: string }>).detail);
    window.addEventListener(LONG_PRESS_EVENT, on);
    return () => window.removeEventListener(LONG_PRESS_EVENT, on);
  }, []);
  if (!link || !ctx) return null;
  const close = () => setLink(null);
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/40" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} className="w-full rounded-t-3xl bg-surface p-3 sheet-pb">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
        <div className="truncate px-3 pb-2 text-sm font-semibold">{link.text || link.url}</div>
        {[
          { label: t('openInNewTab'), action: () => ctx.openTab(link.url) },
          { label: t('openInBackground'), action: () => ctx.openTab(link.url, { background: true }) },
          { label: t('open'), action: () => { location.href = link.url; } },
        ].map((x) => (
          <button key={x.label} onClick={() => { close(); x.action(); }} className="block w-full rounded-xl px-3 py-3 text-left font-medium hover:bg-surface-2">{x.label}</button>
        ))}
        <button onClick={close} className="mt-1 block w-full rounded-xl bg-surface-2 px-3 py-3 font-semibold">{t('cancel')}</button>
      </div>
    </div>
  );
}

// ================================================================ split view (xl screens)
export function SplitPane({ children }: { children: ReactNode }) {
  const t = useTranslations('tabs');
  const ctx = useTabs();
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1280px)');
    const on = () => setWide(m.matches); on();
    m.addEventListener('change', on); return () => m.removeEventListener('change', on);
  }, []);
  const split = ctx?.ready ? ctx.state.split : null;
  const other = split ? ctx!.state.tabs.find((x) => x.id === split.id) : null;
  useEffect(() => {
    if (!dragging || !ctx) return;
    const move = (e: PointerEvent) => { const r = box.current!.getBoundingClientRect(); ctx.setSplitRatio((e.clientX - r.left) / r.width); };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging, ctx]);
  if (!split || !other || !wide) return <>{children}</>;
  const src = `${other.url}${other.url.includes('?') ? '&' : '?'}embed=1`;
  return (
    <div ref={box} className={clsx('flex min-h-[calc(100dvh-3rem)] items-stretch', dragging && 'select-none')}>
      <div className="min-w-0 overflow-auto" style={{ width: `${split.ratio * 100}%` }}>{children}</div>
      <div onPointerDown={() => setDragging(true)} className="group relative w-2 shrink-0 cursor-col-resize" role="separator" aria-orientation="vertical">
        <div className="mx-auto h-full w-px bg-border group-hover:bg-primary" />
      </div>
      <div className="sticky top-12 flex h-[calc(100dvh-3rem)] min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-sm">
          <TabIcon icon={other.icon} className="text-primary" />
          <span className="min-w-0 flex-1 truncate font-medium">{other.title}</span>
          <button onClick={() => ctx!.activate(other.id)} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text">{t('focus')}</button>
          <button onClick={ctx!.closeSplit} aria-label={t('closeSplit')} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2"><X size={15} /></button>
        </div>
        {dragging && <div className="absolute inset-0 z-10" />}
        <iframe key={other.id} src={src} title={other.title} className="w-full flex-1 bg-bg" />
      </div>
    </div>
  );
}
