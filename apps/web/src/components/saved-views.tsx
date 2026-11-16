'use client';
// Saved views of the Customers module: chips bar with live counts, save / save as / revert, sharing,
// favourites, personal order (drag & drop), default view, copy link, CSV export.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Bookmark, BookmarkPlus, Briefcase, Building2, Check, ChevronDown, Copy, Crown, Download, Flame, GripVertical, Heart, Home,
  Layers, Link2, List, Loader2, MapPin, PenLine, RotateCcw, Save, Search, Settings2, Sparkles, Star, Store, Sun, Tag, Target,
  Trash2, TrendingUp, User, Users, type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { matchRank } from '@/lib/search';
import { Dialog } from './customer-dialogs';
import { Popover } from './customer-views';
import { useRoles } from './roles-settings';
import { useToast } from './providers';

export type ViewConfig = { view: 'list' | 'tree' | 'stores'; filters: Record<string, string>; sort: string; q: string; expand: 'none' | 'all' };
export type SavedView = {
  id: string; name: string; icon: string; color: string; scope: 'personal' | 'role' | 'organization'; roles: string[];
  owner_id: string | null; owner_name: string | null; config: ViewConfig; is_system: boolean; favorite: boolean;
  position: number | null; can_edit: boolean; applies: boolean;
};
type ViewsResponse = { views: SavedView[]; default_view: string | null; defaults: { mine: string | null; organization: string | null; roles: Record<string, string> }; can_share: boolean };

export const VIEW_ICONS: Record<string, LucideIcon> = {
  list: List, users: Users, user: User, target: Target, sparkles: Sparkles, store: Store, star: Star, heart: Heart, sun: Sun,
  'map-pin': MapPin, tag: Tag, flame: Flame, crown: Crown, briefcase: Briefcase, building: Building2, layers: Layers, trending: TrendingUp, bookmark: Bookmark,
};
export const VIEW_COLORS: Record<string, { chip: string; dot: string }> = {
  primary: { chip: 'bg-primary text-white', dot: 'bg-primary' },
  info: { chip: 'bg-info text-white', dot: 'bg-info' },
  success: { chip: 'bg-success text-white', dot: 'bg-success' },
  warning: { chip: 'bg-warning text-white', dot: 'bg-warning' },
  danger: { chip: 'bg-danger text-white', dot: 'bg-danger' },
  muted: { chip: 'bg-text text-surface', dot: 'bg-muted' },
};
const smallBtn = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60';
const primaryBtn = 'flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60';
const ghostBtn = 'flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 font-medium';
const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary';

/** Same settings? (ignores empty values and key order) */
export function sameConfig(a: ViewConfig, b: ViewConfig) {
  const clean = (f: Record<string, string>) => JSON.stringify(Object.entries(f ?? {}).filter(([, v]) => v !== '' && v != null).sort());
  return a.view === b.view && (a.sort || 'name') === (b.sort || 'name') && (a.q ?? '') === (b.q ?? '')
    && (a.view !== 'tree' || (a.expand ?? 'none') === (b.expand ?? 'none')) && clean(a.filters) === clean(b.filters);
}

export function useSavedViews() {
  return useQuery({ queryKey: ['views'], queryFn: () => api<ViewsResponse>('/views'), staleTime: 30_000 });
}

function useCounts(ids: string[]) {
  return useQuery({
    queryKey: ['views', 'counts', ids.join(',')], enabled: ids.length > 0, staleTime: 60_000, refetchInterval: 120_000,
    queryFn: () => api<Record<string, number>>(`/views/counts?ids=${ids.join(',')}`),
  });
}

function useCountLabel() {
  const locale = useLocale();
  return (n: number | undefined) => (n === undefined ? '' : n > 10000 ? '10k+' : new Intl.NumberFormat(locale, { notation: n >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n));
}

const ViewIcon = ({ name, size = 15, className }: { name: string; size?: number; className?: string }) => {
  const I = VIEW_ICONS[name] ?? List;
  return <I size={size} className={className} />;
};

// ============================================================ chips bar
export function SavedViewsBar({ activeId, dirty, onApply, onManage }: {
  activeId: string | null; dirty: boolean; onApply: (v: SavedView) => void; onManage: () => void;
}) {
  const t = useTranslations('views');
  const qc = useQueryClient();
  const { data } = useSavedViews();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const all = data?.views ?? [];
  // In the bar: favourites meant for me (+ the active one even if not a favourite)
  const bar = all.filter((v) => (v.favorite && v.applies) || v.id === activeId);
  const counts = useCounts(bar.map((v) => v.id));
  const label = useCountLabel();
  const star = useMutation({
    mutationFn: (v: SavedView) => api(`/views/${v.id}/favorite`, { method: 'PUT', json: { favorite: !v.favorite } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }),
  });
  const groups = (['personal', 'role', 'organization'] as const).map((scope) => ({
    scope, views: all.filter((v) => v.scope === scope && (!q || matchRank(v.name, q) !== null)),
  })).filter((g) => g.views.length);

  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-0.5">
        {bar.map((v) => {
          const active = v.id === activeId;
          return (
            <button key={v.id} onClick={() => onApply(v)} aria-pressed={active} title={v.name}
              className={clsx('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition',
                active ? clsx('border-transparent shadow-sm', VIEW_COLORS[v.color]?.chip ?? VIEW_COLORS.primary.chip) : 'border-border bg-surface text-text hover:bg-surface-2')}>
              <ViewIcon name={v.icon} size={14} className={active ? '' : 'text-muted'} />
              <span className="max-w-40 truncate">{v.name}</span>
              {active && dirty && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" title={t('unsaved')} />}
              {counts.data?.[v.id] !== undefined && (
                <span className={clsx('rounded-full px-1.5 text-xs tabular', active ? 'bg-white/20' : 'bg-surface-2 text-muted')}>{label(counts.data[v.id])}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="relative shrink-0">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-9 items-center gap-1 rounded-full border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2">
          <Bookmark size={15} /> <span className="hidden sm:inline">{t('views')}</span> <ChevronDown size={14} className="text-muted" />
        </button>
        <Popover open={open} onClose={() => setOpen(false)}>
          <label className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
            <Search size={15} className="text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-full bg-transparent py-2 text-sm outline-none" />
          </label>
          <div className="max-h-[55vh] space-y-3 overflow-auto">
            {groups.map((g) => (
              <div key={g.scope}>
                <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t(`scope_${g.scope}`)}</div>
                <ul>
                  {g.views.map((v) => (
                    <li key={v.id} className={clsx('flex items-center gap-1 rounded-xl', v.id === activeId && 'bg-primary-soft')}>
                      <button onClick={() => { onApply(v); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm">
                        <span className={clsx('h-2 w-2 shrink-0 rounded-full', VIEW_COLORS[v.color]?.dot)} />
                        <ViewIcon name={v.icon} size={15} className="shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate">{v.name}</span>
                        {!v.applies && <span className="shrink-0 text-[11px] text-muted">{t('otherRole')}</span>}
                        {data?.default_view === v.id && <Home size={13} className="shrink-0 text-primary" aria-label={t('default')} />}
                      </button>
                      <button onClick={() => star.mutate(v)} aria-label={t('favorite')} title={t('favorite')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:text-warning">
                        <Star size={15} className={v.favorite ? 'fill-warning text-warning' : ''} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!groups.length && <p className="px-1 py-3 text-sm text-muted">{t('noViews')}</p>}
          </div>
          <button onClick={() => { setOpen(false); onManage(); }} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-sm font-medium hover:bg-surface-2">
            <Settings2 size={15} /> {t('manage')}
          </button>
        </Popover>
      </div>
    </div>
  );
}

// ============================================================ save button (toolbar)
export function SaveViewButton({ active, dirty, current, exportHref, onSaved, onRevert, onManage }: {
  active: SavedView | null; dirty: boolean; current: ViewConfig; exportHref: string;
  onSaved: (id: string) => void; onRevert: () => void; onManage: () => void;
}) {
  const t = useTranslations('views');
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useSavedViews();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'new' | null>(null);
  const save = useMutation({
    mutationFn: () => api(`/views/${active!.id}`, { method: 'PUT', json: { config: current } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['views'] }); toast({ title: t('saved', { name: active!.name }) }); },
    onError: () => toast({ title: t('error') }),
  });
  const setDefault = useMutation({
    mutationFn: (id: string | null) => api('/views/default', { method: 'PUT', json: { target: 'me', view_id: id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['views'] }); toast({ title: t('defaultSet') }); },
  });
  const copyLink = async () => {
    const url = new URL(window.location.href);
    if (active && !dirty) url.searchParams.set('v', active.id); else url.searchParams.delete('v');
    if (!active || dirty) url.searchParams.set('cfg', btoa(unescape(encodeURIComponent(JSON.stringify(current)))));
    await navigator.clipboard.writeText(url.toString());
    toast({ title: t('linkCopied') });
  };
  const isDefault = !!active && data?.defaults.mine === active.id;
  const Item = ({ icon: I, children, onClick, disabled, href }: { icon: LucideIcon; children: ReactNode; onClick?: () => void; disabled?: boolean; href?: string }) => {
    const cls = 'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40';
    return href
      ? <a href={href} onClick={() => setOpen(false)} className={cls}><I size={16} className="text-muted" />{children}</a>
      : <button disabled={disabled} onClick={() => { setOpen(false); onClick?.(); }} className={cls}><I size={16} className="text-muted" />{children}</button>;
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('saveView')} title={t('saveView')}
        className={clsx('relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-surface transition hover:text-text',
          dirty ? 'border-primary text-primary' : 'border-border text-muted')}>
        <BookmarkPlus size={18} />
        {dirty && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface bg-warning" title={t('unsaved')} />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="mb-2 px-1">
          <div className="text-sm font-semibold">{active ? active.name : t('noActive')}</div>
          <div className="text-xs text-muted">{dirty ? t('unsavedHint') : active ? t(`scope_${active.scope}`) : t('saveHint')}</div>
        </div>
        <div className="space-y-0.5">
          {active && <Item icon={Save} disabled={!dirty || !active.can_edit} onClick={() => save.mutate()}>{active.can_edit ? t('save') : t('saveReadOnly')}</Item>}
          <Item icon={BookmarkPlus} onClick={() => setDialog('new')}>{t('saveAs')}</Item>
          {active && dirty && <Item icon={RotateCcw} onClick={onRevert}>{t('revert')}</Item>}
          <div className="my-1 border-t border-border" />
          {active && <Item icon={Home} onClick={() => setDefault.mutate(isDefault ? null : active.id)}>{isDefault ? t('unsetDefault') : t('setDefault')}</Item>}
          <Item icon={Link2} onClick={copyLink}>{t('copyLink')}</Item>
          <Item icon={Download} href={exportHref}>{t('export')}</Item>
          <Item icon={Settings2} onClick={onManage}>{t('manage')}</Item>
        </div>
      </Popover>
      {dialog && (
        <ViewDialog config={current} canShare={!!data?.can_share} onClose={() => setDialog(null)}
          onSaved={(id) => { setDialog(null); onSaved(id); }} />
      )}
      {save.isPending && <Loader2 size={14} className="absolute -bottom-4 left-1/2 -translate-x-1/2 animate-spin text-muted" />}
    </div>
  );
}

// ============================================================ create / edit dialog
export function ViewDialog({ view, config, canShare, onClose, onSaved }: {
  view?: SavedView; config?: ViewConfig; canShare: boolean; onClose: () => void; onSaved: (id: string) => void;
}) {
  const t = useTranslations('views');
  const qc = useQueryClient();
  const roles = useRoles().data?.roles ?? [];
  const [name, setName] = useState(view?.name ?? '');
  const [icon, setIcon] = useState(view?.icon ?? 'bookmark');
  const [color, setColor] = useState(view?.color ?? 'primary');
  const [scope, setScope] = useState<SavedView['scope']>(view?.scope ?? 'personal');
  const [sel, setSel] = useState<Set<string>>(new Set(view?.roles ?? []));
  const [asDefault, setAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const json = { name, icon, color, scope, roles: [...sel], ...(view ? {} : { config }) };
      const id = view ? (await api(`/views/${view.id}`, { method: 'PUT', json }), view.id)
        : (await api<{ id: string }>('/views', { method: 'POST', json })).id;
      if (asDefault) await api('/views/default', { method: 'PUT', json: { target: 'me', view_id: id } });
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ['views'] }); onSaved(id); },
    onError: (e) => setError(e instanceof ApiError ? t.has(`err_${e.code}`) ? t(`err_${e.code}` as never) : e.code : t('error')),
  });
  const scopes = ['personal', 'role', 'organization'] as const;
  return (
    <Dialog title={view ? t('editTitle') : t('saveAs')} onClose={onClose}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">{t('name')}</span>
          <input required maxLength={60} autoFocus className={input} placeholder={t('namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div>
          <span className="mb-1.5 block text-sm font-medium">{t('look')}</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(VIEW_ICONS).map((k) => (
              <button key={k} type="button" onClick={() => setIcon(k)} aria-pressed={icon === k} aria-label={k}
                className={clsx('grid h-9 w-9 place-items-center rounded-xl border transition', icon === k ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-text')}>
                <ViewIcon name={k} size={16} />
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {Object.entries(VIEW_COLORS).map(([k, c]) => (
              <button key={k} type="button" onClick={() => setColor(k)} aria-pressed={color === k} aria-label={k}
                className={clsx('grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition', c.dot, color === k && 'ring-2 ring-primary')}>
                {color === k && <Check size={14} className="text-white" />}
              </button>
            ))}
          </div>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t('who')}</legend>
          <div className="space-y-2">
            {scopes.map((s) => {
              const disabled = s !== 'personal' && !canShare;
              return (
                <label key={s} className={clsx('flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition', scope === s ? 'border-primary bg-primary-soft/50' : 'border-border', disabled && 'cursor-not-allowed opacity-50')}>
                  <input type="radio" name="scope" disabled={disabled} checked={scope === s} onChange={() => setScope(s)} className="mt-1 accent-[var(--primary)]" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t(`scope_${s}`)}</span>
                    <span className="block text-xs text-muted">{t(`scopeHint_${s}`)}</span>
                    {s === 'role' && scope === 'role' && (
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {roles.map((r) => (
                          <button key={r.key} type="button" onClick={() => { const n = new Set(sel); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); setSel(n); }}
                            className={clsx('rounded-full border px-2.5 py-1 text-xs', sel.has(r.key) ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>{r.name}</button>
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {!canShare && <p className="mt-1.5 text-xs text-muted">{t('noSharePermission')}</p>}
        </fieldset>
        {!view && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />
            {t('asMyDefault')}
          </label>
        )}
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={ghostBtn}>{t('cancel')}</button>
          <button disabled={save.isPending || !name.trim() || (scope === 'role' && !sel.size)} className={primaryBtn}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {t('saveBtn')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ============================================================ manage (list + drag & drop + defaults)
export function ManageViews({ onApply }: { onApply?: (v: SavedView) => void }) {
  const t = useTranslations('views');
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useSavedViews();
  const roles = useRoles().data?.roles ?? [];
  const [order, setOrder] = useState<SavedView[]>([]);
  const [editing, setEditing] = useState<SavedView | null>(null);
  const drag = useRef<number | null>(null);
  useEffect(() => { if (data) setOrder(data.views); }, [data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['views'] });
  const onErr = () => toast({ title: t('error') });
  const saveOrder = useMutation({ mutationFn: (ids: string[]) => api('/views/order', { method: 'PUT', json: { ids } }), onSuccess: refresh, onError: onErr });
  const star = useMutation({ mutationFn: (v: SavedView) => api(`/views/${v.id}/favorite`, { method: 'PUT', json: { favorite: !v.favorite } }), onSuccess: refresh });
  const dup = useMutation({ mutationFn: (v: SavedView) => api(`/views/${v.id}/duplicate`, { method: 'POST' }), onSuccess: () => { refresh(); toast({ title: t('duplicated') }); }, onError: onErr });
  const del = useMutation({ mutationFn: (v: SavedView) => api(`/views/${v.id}`, { method: 'DELETE' }), onSuccess: refresh, onError: onErr });
  const setDefault = useMutation({
    mutationFn: (b: { target: 'me' | 'organization' | 'role'; role?: string; view_id: string | null }) => api('/views/default', { method: 'PUT', json: b }),
    onSuccess: () => { refresh(); toast({ title: t('defaultSet') }); }, onError: onErr,
  });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const n = [...order]; const [x] = n.splice(from, 1); n.splice(to, 0, x);
    setOrder(n); saveOrder.mutate(n.map((v) => v.id));
  };
  if (!data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const d = data.defaults;
  const viewSelect = (value: string | null, onChange: (id: string | null) => void, label: string) => (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
      className="rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-primary">
      <option value="">{t('noDefault')}</option>
      {data.views.filter((v) => v.scope !== 'personal').map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('manageHint')}</p>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {order.map((v, i) => (
          <li key={v.id} draggable onDragStart={() => { drag.current = i; }} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag.current !== null) move(drag.current, i); drag.current = null; }}
            className="flex flex-wrap items-center gap-2 px-2 py-2.5 sm:flex-nowrap">
            <span className="hidden cursor-grab text-muted sm:block" aria-hidden><GripVertical size={16} /></span>
            <span className="flex flex-col sm:hidden">
              <button onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="up" className="text-muted disabled:opacity-30"><ChevronDown size={14} className="rotate-180" /></button>
              <button onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label="down" className="text-muted disabled:opacity-30"><ChevronDown size={14} /></button>
            </span>
            <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white', VIEW_COLORS[v.color]?.dot ?? 'bg-primary')}><ViewIcon name={v.icon} size={15} /></span>
            <button onClick={() => onApply?.(v)} className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{v.name}</span>
                {data.default_view === v.id && <Home size={13} className="shrink-0 text-primary" />}
              </span>
              <span className="block truncate text-xs text-muted">
                {t(`scope_${v.scope}`)}{v.scope === 'role' && ` · ${v.roles.map((r) => roles.find((x) => x.key === r)?.name ?? r).join(', ')}`}
                {v.is_system ? ` · ${t('system')}` : v.owner_name && v.scope !== 'personal' ? ` · ${v.owner_name}` : ''}
              </span>
            </button>
            <span className="ml-auto flex shrink-0 items-center">
              <button onClick={() => star.mutate(v)} aria-label={t('favorite')} title={t('favorite')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-warning">
                <Star size={15} className={v.favorite ? 'fill-warning text-warning' : ''} />
              </button>
              <button onClick={() => setDefault.mutate({ target: 'me', view_id: d.mine === v.id ? null : v.id })} aria-label={t('setDefault')} title={d.mine === v.id ? t('unsetDefault') : t('setDefault')}
                className={clsx('grid h-8 w-8 place-items-center rounded-lg hover:text-primary', d.mine === v.id ? 'text-primary' : 'text-muted')}><Home size={15} /></button>
              <button onClick={() => dup.mutate(v)} aria-label={t('duplicate')} title={t('duplicate')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-text"><Copy size={15} /></button>
              {v.can_edit && <button onClick={() => setEditing(v)} aria-label={t('edit')} title={t('edit')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-primary"><PenLine size={15} /></button>}
              {v.can_edit && !v.is_system && (
                <button onClick={() => { if (confirm(t('confirmDelete', { name: v.name }))) del.mutate(v); }} aria-label={t('delete')} title={t('delete')}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-danger"><Trash2 size={15} /></button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {data.can_share && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t('defaultsTitle')}</div>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="text-sm font-medium">{t('forOrganization')}</span>
              {viewSelect(d.organization, (id) => setDefault.mutate({ target: 'organization', view_id: id }), t('forOrganization'))}
            </li>
            {roles.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="text-sm">{r.name}</span>
                {viewSelect(d.roles[r.key] ?? null, (id) => setDefault.mutate({ target: 'role', role: r.key, view_id: id }), r.name)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t('defaultsHint')}</p>
        </div>
      )}
      {editing && <ViewDialog view={editing} canShare={data.can_share} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
    </div>
  );
}

export function ManageViewsDialog({ onClose, onApply }: { onClose: () => void; onApply: (v: SavedView) => void }) {
  const t = useTranslations('views');
  return (
    <Dialog title={t('manage')} onClose={onClose}>
      <ManageViews onApply={(v) => { onApply(v); onClose(); }} />
    </Dialog>
  );
}

/** Decode a shared ?cfg= link. */
export function decodeConfig(s: string | null): ViewConfig | null {
  if (!s) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(s)))) as ViewConfig; } catch { return null; }
}
export const useViewById = (id: string | null) => {
  const { data } = useSavedViews();
  return useMemo(() => (id ? data?.views.find((v) => v.id === id) ?? null : null), [id, data]);
};
