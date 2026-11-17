'use client';
import { appConfirm } from './confirm';
// In-app tabs: several pages open at once, each with its own state (filters, view, scroll, form drafts).
// Next renders one route at a time, so a tab is a URL + its own storage namespace (lib/tab-store): switching
// remounts the page under the tab's namespace and it restores itself. Only the active tab is live.
import {
  createContext, Fragment, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { copyTabState, dropTabState, getCurrentTab, pruneTabState, setCurrentTab, tabStore } from '@/lib/tab-store';
import { useToast } from './providers';

export type Tab = { id: string; url: string; title: string; icon: string; pinned: boolean; group: string | null; dirty?: boolean; lastActive: number; scrollY?: number;
  titlePath?: string /* the page a custom title belongs to */ };
export type TabGroup = { id: string; name: string; color: string; collapsed: boolean };
type TabsState = { tabs: Tab[]; groups: TabGroup[]; activeId: string; split: { id: string; ratio: number } | null };

export const GROUP_COLORS = ['primary', 'info', 'success', 'warning', 'danger', 'muted'] as const;
const MAX_MOBILE_TABS = 10;
const STORE_KEY = 'sos.tabs.v1';
/** One state per browser window/tab (kept across reloads via sessionStorage), so two windows never overwrite each other. */
function windowId() {
  try {
    let id = sessionStorage.getItem('sos.window');
    if (!id) { id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; sessionStorage.setItem('sos.window', id); }
    return id;
  } catch { return 'w0'; }
}
type Saved = TabsState & { savedAt?: number };
const WINDOW_TTL = 30 * 86_400_000;
/** All saved windows of this user (dropping ones unused for 30 days). */
function savedWindows(userId: string): [string, Saved][] {
  const out: [string, Saved][] = [];
  try {
    const prefix = `${STORE_KEY}.${userId}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix) || k.endsWith('.last')) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? 'null') as Saved | null;
      if (!v || (v.savedAt && Date.now() - v.savedAt > WINDOW_TTL)) { localStorage.removeItem(k); continue; }
      out.push([k, v]);
    }
  } catch { /* ignore */ }
  return out;
}
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
const strip = (url: string) => url.replace(/[?&]embed=1/, '').replace(/\?$/, '');
/** Detail pages are "records": opening one that is already open focuses that tab. */
const isRecord = (url: string) => /\/(customers|offers)\/[0-9a-f-]{36}(\/edit)?(\?|$)/.test(url);

/** Embedded = rendered inside the split-view frame: no shell, no tab state of its own. */
const subscribeNoop = () => () => {};
export function useEmbedded() {
  return useSyncExternalStore(subscribeNoop, () => new URLSearchParams(window.location.search).has('embed'), () => false);
}

// ---------------------------------------------------------------- titles & icons from the URL
export function useUrlLabel() {
  const t = useTranslations('nav');
  const tt = useTranslations('tabs');
  return useCallback((url: string): { title: string; icon: string } => {
    const path = url.replace(/^\/(el|en)/, '').split('?')[0] || '/';
    if (path === '/') return { title: t('home'), icon: 'home' };
    if (path === '/customers') return { title: t('customers'), icon: 'customers' };
    if (path === '/customers/new') return { title: tt('newCustomer'), icon: 'new' };
    if (/^\/customers\/[^/]+\/edit/.test(path)) return { title: tt('editCustomer'), icon: 'customer' };
    if (path.startsWith('/customers/')) return { title: tt('customer'), icon: 'customer' };
    if (path === '/offers') return { title: t('offers'), icon: 'offers' };
    if (path === '/offers/new') return { title: tt('newOffer'), icon: 'new' };
    if (path.startsWith('/offers/')) return { title: tt('offer'), icon: 'offer' };
    if (path.startsWith('/calendar')) return { title: t('calendar'), icon: 'calendar' };
    if (path.startsWith('/settings')) return { title: t('admin'), icon: 'settings' };
    if (path.startsWith('/more')) return { title: t('more'), icon: 'more' };
    return { title: 'SoftifyOS', icon: 'page' };
  }, [t, tt]);
}

// ---------------------------------------------------------------- context
type Ctx = {
  ready: boolean; embedded: boolean; state: TabsState; renderKey: string; pendingId: string | null;
  openTab: (url: string, opts?: { background?: boolean; from?: string }) => void;
  activate: (id: string) => void; close: (id: string) => void; closeMany: (ids: string[]) => void;
  pin: (id: string, pinned: boolean) => void; move: (from: number, to: number) => void; duplicate: (id: string) => void;
  setGroup: (id: string, group: string | null) => void; newGroup: (id: string, name: string) => void;
  updateGroup: (gid: string, patch: Partial<TabGroup>) => void; closeGroup: (gid: string) => void; ungroup: (gid: string) => void;
  openSplit: (id: string) => void; closeSplit: () => void; setSplitRatio: (r: number) => void;
  setTitle: (id: string, title: string) => void; setDirty: (id: string, dirty: boolean) => void;
  quickOpen: boolean; setQuickOpen: (v: boolean) => void; switcher: boolean; setSwitcher: (v: boolean) => void;
  next: (dir: 1 | -1) => void;
};
const TabsCtx = createContext<Ctx | null>(null);
export const useTabs = () => useContext(TabsCtx);

function UrlWatcher({ onChange }: { onChange: (url: string) => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => { onChange(`${pathname}${search.toString() ? `?${search}` : ''}`); }, [pathname, search, onChange]);
  return null;
}

export function TabsProvider({ userId, children }: { userId: string | undefined; children: ReactNode }) {
  const embedded = useEmbedded();
  const router = useRouter();
  const locale = useLocale();
  const labelNow = useUrlLabel();
  const labelRef = useRef(labelNow);
  labelRef.current = labelNow;
  const label = useCallback((url: string) => labelRef.current(url), []);
  const toast = useToast();
  const tt = useTranslations('tabs');
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<TabsState>({ tabs: [], groups: [], activeId: '', split: null });
  const [renderKey, setRenderKey] = useState('default');
  const [quickOpen, setQuickOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const urlRef = useRef('');
  const pending = useRef<{ id: string; url: string } | null>(null);
  const [pendingId, setPendingIdState] = useState<string | null>(null);
  const setPending = (p: { id: string; url: string } | null) => { pending.current = p; setPendingIdState(p?.id ?? null); };
  const stateRef = useRef(state);
  stateRef.current = state;
  // The page about to render reads/writes its tab's own storage
  setCurrentTab(embedded ? 'embed' : renderKey);

  // ---- load (per user, per browser) ----
  useEffect(() => {
    if (embedded || !userId) return;
    const url = `${window.location.pathname}${window.location.search}`;
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(`${STORE_KEY}.${userId}.${windowId()}`) ?? 'null');
      if (!saved) {
        // New window: continue the last session as a copy (own tab ids, copied per-tab state)
        // (first version kept one shared state per user: use it once, then drop it)
        const legacyKey = `${STORE_KEY}.${userId}`;
        const last = JSON.parse(localStorage.getItem(`${STORE_KEY}.${userId}.last`) ?? localStorage.getItem(legacyKey) ?? 'null') as Saved | null;
        localStorage.removeItem(legacyKey);
        if (last?.tabs?.length) {
          const ids = new Map(last.tabs.map((x) => [x.id, newId()]));
          last.tabs.forEach((x) => copyTabState(x.id, ids.get(x.id)!));
          saved = { ...last, tabs: last.tabs.map((x) => ({ ...x, id: ids.get(x.id)! })), activeId: ids.get(last.activeId) ?? '', split: null };
        }
      }
    } catch { /* ignore */ }
    let s: TabsState = saved?.tabs?.length ? saved : { tabs: [], groups: [], activeId: '', split: null };
    s = { ...s, groups: s.groups ?? [], split: s.split ?? null };
    const active = s.tabs.find((x) => x.id === s.activeId);
    if (!active || strip(active.url) !== strip(url)) {
      const same = s.tabs.find((x) => strip(x.url) === strip(url));
      if (same) s = { ...s, activeId: same.id };
      else {
        // A link / reload to a page that is not open yet: open it as a new tab
        const tab: Tab = { id: newId(), url, ...label(url), pinned: false, group: null, lastActive: Date.now() };
        s = { ...s, tabs: [...s.tabs, tab], activeId: tab.id };
      }
    }
    // keep per-tab state of every window's tabs; drop only orphans
    pruneTabState(new Set([...s.tabs.map((x) => x.id), ...savedWindows(userId).flatMap(([, w]) => w.tabs.map((x) => x.id))]));
    setState(s);
    setRenderKey(s.activeId);
    urlRef.current = url;
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, embedded]);

  // ---- save ----
  useEffect(() => {
    if (!ready || embedded || !userId) return;
    try {
      const json = JSON.stringify({ ...state, savedAt: Date.now() });
      localStorage.setItem(`${STORE_KEY}.${userId}.${windowId()}`, json);
      localStorage.setItem(`${STORE_KEY}.${userId}.last`, json);
    } catch { /* ignore */ }
  }, [state, ready, embedded, userId]);

  // ---- follow navigation inside the active tab ----
  const onUrl = useCallback((url: string) => {
    urlRef.current = url;
    if (embedded) return;
    const p = pending.current;
    if (p && strip(p.url) === strip(url)) { setPending(null); setRenderKey(p.id); return; }
    if (p) return; // still on the way to the tab being activated
    setState((s) => {
      const cur = s.tabs.find((x) => x.id === s.activeId);
      if (!cur || cur.url === url) return s;
      return {
        ...s, tabs: s.tabs.map((x) => {
          if (x.id !== s.activeId || x.url === url) return x;
          const path = url.split('?')[0];
          const samePage = x.url.split('?')[0] === path;
          // keep a title the new page already set (pages set it before this runs)
          const keepTitle = samePage || x.titlePath === path;
          return { ...x, url, ...(keepTitle ? { icon: label(url).icon } : label(url)), dirty: samePage ? x.dirty : false };
        }),
      };
    });
  }, [embedded, label]);

  // ---- scroll: remember on leave, restore on return ----
  const saveScroll = () => {
    const id = stateRef.current.activeId;
    const y = window.scrollY;
    setState((s) => ({ ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, scrollY: y } : x)) }));
  };
  useEffect(() => {
    if (!ready) return;
    const y = stateRef.current.tabs.find((x) => x.id === renderKey)?.scrollY ?? 0;
    // lists load their data first; try a few times
    const timers = [0, 120, 400, 900].map((ms) => setTimeout(() => window.scrollTo({ top: y }), ms));
    return () => timers.forEach(clearTimeout);
  }, [renderKey, ready]);

  // ---- actions ----
  const activate = useCallback((id: string) => {
    const s = stateRef.current;
    const tab = s.tabs.find((x) => x.id === id);
    if (!tab || id === s.activeId && renderKey === id) return;
    saveScroll();
    setState((st) => ({ ...st, activeId: id, tabs: st.tabs.map((x) => (x.id === id ? { ...x, lastActive: Date.now() } : x)) }));
    if (strip(tab.url) === strip(urlRef.current)) { setPending(null); setRenderKey(id); }
    else { setPending({ id, url: tab.url }); router.push(tab.url); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, router]);

  const openTab = useCallback((rawUrl: string, opts: { background?: boolean; from?: string } = {}) => {
    const url = rawUrl.startsWith('/el') || rawUrl.startsWith('/en') ? rawUrl : `/${locale}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    const s = stateRef.current;
    if (isRecord(url)) {
      const open = s.tabs.find((x) => strip(x.url).split('?')[0] === strip(url).split('?')[0]);
      if (open) { if (!opts.background) activate(open.id); else toast({ title: tt('alreadyOpen') }); return; }
    }
    const from = s.tabs.find((x) => x.id === (opts.from ?? s.activeId));
    const tab: Tab = { id: newId(), url, ...label(url), pinned: false, group: from?.group ?? null, lastActive: Date.now() };
    let tabs = [...s.tabs];
    // new tab goes right after the one it was opened from (like a browser)
    const at = from ? tabs.indexOf(from) + 1 : tabs.length;
    tabs.splice(at, 0, tab);
    if (isMobile() && tabs.length > MAX_MOBILE_TABS) {
      const victim = [...tabs].filter((x) => !x.pinned && !x.dirty && x.id !== s.activeId && x.id !== tab.id).sort((a, b) => a.lastActive - b.lastActive)[0];
      if (victim) { tabs = tabs.filter((x) => x.id !== victim.id); dropTabState(victim.id); toast({ title: tt('autoClosed', { title: victim.title }) }); }
    }
    setState((st) => ({ ...st, tabs }));
    if (!opts.background) {
      saveScroll();
      setState((st) => ({ ...st, activeId: tab.id }));
      setPending({ id: tab.id, url });
      router.push(url);
    } else toast({ title: tt('openedInBackground', { title: tab.title }) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, label, activate, router, toast, tt]);

  const closeMany = useCallback(async (ids: string[]) => {
    const s = stateRef.current;
    const closing = s.tabs.filter((x) => ids.includes(x.id));
    if (closing.some((x) => x.dirty) && !await appConfirm(tt('confirmCloseDirty', { count: closing.filter((x) => x.dirty).length }))) return;
    let rest = s.tabs.filter((x) => !ids.includes(x.id));
    closing.forEach((x) => dropTabState(x.id));
    if (!rest.length) rest = [{ id: newId(), url: `/${locale}`, ...label(`/${locale}`), pinned: false, group: null, lastActive: Date.now() }];
    const split = s.split && ids.includes(s.split.id) ? null : s.split;
    const groups = s.groups.filter((g) => rest.some((x) => x.group === g.id));
    if (ids.includes(s.activeId)) {
      const idx = s.tabs.findIndex((x) => x.id === s.activeId);
      const nextTab = rest[Math.min(idx, rest.length - 1)] ?? rest[0];
      setState({ ...s, tabs: rest, groups, split, activeId: nextTab.id });
      if (strip(nextTab.url) === strip(urlRef.current)) setRenderKey(nextTab.id);
      else { setPending({ id: nextTab.id, url: nextTab.url }); router.push(nextTab.url); }
    } else setState({ ...s, tabs: rest, groups, split });
  }, [locale, label, router, tt]);

  const value = useMemo<Ctx>(() => ({
    ready, embedded, state, renderKey, pendingId, openTab, activate, closeMany,
    close: (id) => closeMany([id]),
    pin: (id, pinned) => setState((s) => {
      const tabs = s.tabs.map((x) => (x.id === id ? { ...x, pinned } : x));
      // pinned tabs first, keeping their relative order
      return { ...s, tabs: [...tabs.filter((x) => x.pinned), ...tabs.filter((x) => !x.pinned)] };
    }),
    move: (from, to) => setState((s) => {
      if (from === to || to < 0 || to >= s.tabs.length) return s;
      const tabs = [...s.tabs]; const [x] = tabs.splice(from, 1); tabs.splice(to, 0, x);
      return { ...s, tabs: [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)] };
    }),
    duplicate: (id) => {
      const s = stateRef.current; const src = s.tabs.find((x) => x.id === id); if (!src) return;
      const copy: Tab = { ...src, id: newId(), pinned: false, dirty: false, lastActive: Date.now() };
      copyTabState(id, copy.id); tabStore.removeItem('__never__');
      setState((st) => { const tabs = [...st.tabs]; tabs.splice(tabs.findIndex((x) => x.id === id) + 1, 0, copy); return { ...st, tabs }; });
    },
    setGroup: (id, group) => setState((s) => {
      let tabs = s.tabs.map((x) => (x.id === id ? { ...x, group } : x));
      if (group) { // keep a group's tabs next to each other
        const me = tabs.find((x) => x.id === id)!; tabs = tabs.filter((x) => x.id !== id);
        const last = tabs.map((x) => x.group).lastIndexOf(group);
        tabs.splice(last >= 0 ? last + 1 : tabs.length, 0, me);
      }
      return { ...s, tabs, groups: s.groups.filter((g) => tabs.some((x) => x.group === g.id)) };
    }),
    newGroup: (id, name) => setState((s) => {
      const g: TabGroup = { id: `g${Date.now().toString(36)}`, name, color: GROUP_COLORS[s.groups.length % GROUP_COLORS.length], collapsed: false };
      return { ...s, groups: [...s.groups, g], tabs: s.tabs.map((x) => (x.id === id ? { ...x, group: g.id } : x)) };
    }),
    updateGroup: (gid, patch) => setState((s) => ({ ...s, groups: s.groups.map((g) => (g.id === gid ? { ...g, ...patch } : g)) })),
    ungroup: (gid) => setState((s) => ({ ...s, groups: s.groups.filter((g) => g.id !== gid), tabs: s.tabs.map((x) => (x.group === gid ? { ...x, group: null } : x)) })),
    closeGroup: (gid) => closeMany(stateRef.current.tabs.filter((x) => x.group === gid).map((x) => x.id)),
    openSplit: (id) => setState((s) => ({ ...s, split: { id, ratio: s.split?.ratio ?? 0.5 } })),
    closeSplit: () => setState((s) => ({ ...s, split: null })),
    setSplitRatio: (r) => setState((s) => (s.split ? { ...s, split: { ...s.split, ratio: Math.min(0.75, Math.max(0.25, r)) } } : s)),
    setTitle: (id, title) => setState((s) => {
      const titlePath = window.location.pathname;
      if (!s.tabs.some((x) => x.id === id && (x.title !== title || x.titlePath !== titlePath))) return s;
      return { ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, title, titlePath } : x)) };
    }),
    setDirty: (id, dirty) => setState((s) => (s.tabs.some((x) => x.id === id && !!x.dirty !== dirty) ? { ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, dirty } : x)) } : s)),
    quickOpen, setQuickOpen, switcher, setSwitcher,
    next: (dir) => {
      const s = stateRef.current;
      const visible = s.tabs.filter((x) => !x.group || !s.groups.find((g) => g.id === x.group)?.collapsed || x.id === s.activeId);
      const i = visible.findIndex((x) => x.id === s.activeId);
      const target = visible[(i + dir + visible.length) % visible.length];
      if (target) activate(target.id);
    },
  }), [ready, embedded, state, renderKey, pendingId, openTab, activate, closeMany, quickOpen, switcher]);

  useLinkInterception(value);
  useShortcuts(value);

  return (
    <TabsCtx.Provider value={value}>
      <Suspense><UrlWatcher onChange={onUrl} /></Suspense>
      {children}
    </TabsCtx.Provider>
  );
}

/** The page area: remounts when another tab becomes active, so the page restores that tab's own state. */
export function TabContent({ children }: { children: ReactNode }) {
  const ctx = useTabs();
  // While another tab's page is on its way, show a placeholder instead of the old page under the new tab
  if (ctx?.pendingId && !ctx.embedded) {
    return <div className="space-y-3 pt-2" aria-busy><div className="skeleton h-9 w-56" /><div className="skeleton h-24" /><div className="skeleton h-24" /></div>;
  }
  return <Fragment key={!ctx || ctx.embedded ? 'embed' : ctx.renderKey}>{children}</Fragment>;
}

// ---------------------------------------------------------------- page hooks
/** Page title shown on its tab (e.g. the customer's name). */
export function useTabTitle(title: string | null | undefined) {
  const tabs = useTabs();
  const id = useRef(getCurrentTab()).current;
  // The provider's functions change with every tab-state update: keep the latest in a ref so this effect
  // runs only when the title changes (otherwise each update re-sets the title → another update → loop).
  const setTitle = useRef(tabs?.setTitle);
  setTitle.current = tabs?.setTitle;
  const ready = !!tabs?.setTitle;
  useEffect(() => { if (title && setTitle.current) setTitle.current(id, title); }, [title, id, ready]);
}

/**
 * Keeps a form's unsaved values in the tab: they survive switching tabs and reloads.
 * Returns clear() to call after a successful save. Marks the tab "unsaved" while a draft exists.
 */
export function useTabDraft<T>(key: string, value: T, setValue: (v: T) => void, initial: T) {
  const tabs = useTabs();
  const id = useRef(getCurrentTab()).current;
  const storeKey = `draft.${key}`;
  const restored = useRef(false);
  const initialJson = useRef(JSON.stringify(initial));
  useEffect(() => {
    const saved = tabStore.getItem(storeKey);
    if (saved) { try { setValue(JSON.parse(saved)); } catch { /* ignore */ } }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey]);
  const dirtyRef = useRef(tabs?.setDirty);
  dirtyRef.current = tabs?.setDirty;
  const setDirty = useCallback((tid: string, d: boolean) => dirtyRef.current?.(tid, d), []);
  useEffect(() => {
    if (!restored.current) return;
    const json = JSON.stringify(value);
    const dirty = json !== initialJson.current;
    if (dirty) tabStore.setItem(storeKey, json); else tabStore.removeItem(storeKey);
    setDirty(id, dirty);
  }, [value, storeKey, id, setDirty]);
  return useCallback(() => { tabStore.removeItem(storeKey); setDirty(id, false); initialJson.current = JSON.stringify(value); }, [storeKey, id, setDirty, value]);
}

// ---------------------------------------------------------------- links: Ctrl/⌘/middle-click → new tab; long-press on phones
export const LONG_PRESS_EVENT = 'sos:longpress-link';

function internalHref(el: EventTarget | null): { url: string; text: string } | null {
  const a = (el as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return null;
  const u = new URL(a.href, window.location.href);
  if (u.origin !== window.location.origin || !/^\/(el|en)(\/|$)/.test(u.pathname)) return null;
  return { url: `${u.pathname}${u.search}`, text: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 80) };
}

function useLinkInterception(ctx: Ctx) {
  const ref = useRef(ctx);
  ref.current = ctx;
  useEffect(() => {
    if (!ctx.ready && !ctx.embedded) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let suppress = false;
    let start: { x: number; y: number } | null = null;
    const open = (url: string) => {
      if (ref.current.embedded) window.parent?.postMessage({ type: 'sos-open-tab', url }, window.location.origin);
      else ref.current.openTab(url, { background: true });
    };
    const onClick = (e: MouseEvent) => {
      if (suppress) { suppress = false; e.preventDefault(); e.stopPropagation(); return; }
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;
      const h = internalHref(e.target); if (!h) return;
      e.preventDefault(); e.stopPropagation(); open(h.url);
    };
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const h = internalHref(e.target); if (!h) return;
      e.preventDefault(); e.stopPropagation(); open(h.url);
    };
    const onDown = (e: MouseEvent) => { if (e.button === 1 && internalHref(e.target)) e.preventDefault(); }; // no autoscroll
    const onTouchStart = (e: TouchEvent) => {
      const h = internalHref(e.target); if (!h || e.touches.length !== 1) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      timer = setTimeout(() => {
        suppress = true;
        navigator.vibrate?.(15);
        window.dispatchEvent(new CustomEvent(LONG_PRESS_EVENT, { detail: h }));
      }, 520);
    };
    const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
    const onTouchMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - start.x) > 8 || Math.abs(t.clientY - start.y) > 8) cancel();
    };
    const onContext = (e: Event) => { if (suppress && internalHref(e.target)) e.preventDefault(); };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === 'sos-open-tab' && typeof e.data.url === 'string') ref.current.openTab(e.data.url, { background: true });
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onAux, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', cancel);
    document.addEventListener('touchcancel', cancel);
    document.addEventListener('contextmenu', onContext, true);
    window.addEventListener('message', onMessage);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('auxclick', onAux, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', cancel);
      document.removeEventListener('touchcancel', cancel);
      document.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('message', onMessage);
    };
  }, [ctx.ready, ctx.embedded]);
}

// ---------------------------------------------------------------- keyboard (Alt-based: browsers keep Ctrl+T/W/Tab for themselves)
function useShortcuts(ctx: Ctx) {
  const ref = useRef(ctx);
  ref.current = ctx;
  useEffect(() => {
    if (!ctx.ready || ctx.embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const c = ref.current;
      const s = c.state;
      const k = e.code;
      if (k === 'KeyT') { e.preventDefault(); c.setQuickOpen(true); }
      else if (k === 'KeyW') { e.preventDefault(); c.close(s.activeId); }
      else if (k === 'BracketRight' || k === 'PageDown') { e.preventDefault(); c.next(1); }
      else if (k === 'BracketLeft' || k === 'PageUp') { e.preventDefault(); c.next(-1); }
      else if (k === 'KeyP') { e.preventDefault(); const a = s.tabs.find((x) => x.id === s.activeId); if (a) c.pin(a.id, !a.pinned); }
      else if (k === 'KeyD') { e.preventDefault(); c.duplicate(s.activeId); }
      else if (k === 'KeyK') { e.preventDefault(); c.setSwitcher(true); }
      else if (/^Digit[1-9]$/.test(k)) {
        e.preventDefault();
        const n = Number(k.slice(5));
        const target = n === 9 ? s.tabs.at(-1) : s.tabs[n - 1];
        if (target) c.activate(target.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx.ready, ctx.embedded]);
}
