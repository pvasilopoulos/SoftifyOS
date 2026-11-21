'use client';
// Customer → "Ενέργειες": the customer's CRM activities as in the ERP (code, series, store, requester, handler,
// subject, characterisation, status, start/end, priority), with remarks, editing, ERP sync state and an AI summary.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowDown, ArrowRight, ArrowUp, Building2, CheckCircle2, Group, Save, ChevronDown, ChevronLeft, ChevronRight, Columns3, Download, Flag, Loader2, MessageSquareText, Pencil, Plus, RefreshCw,
  Rows3, Search, Send, SlidersHorizontal, Sparkles, Store, Wand2, X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { iconOf, tone, useCrmMeta, useCrmRefresh, type Activity, type ActivityStatus } from '@/lib/crm';
import { useToast } from './providers';
import { ActivityEditor, CompleteDialog, ErpBadge, type EditorPreset } from './crm-editor';
import { useAi } from '@/lib/ai';
import { AiErrorNote, Markdown } from './ai-ui';

type Filter = 'any' | 'open' | 'done' | 'cancelled';
type Page = { items: Activity[]; next_cursor: string | null };
type ColKey = 'when' | 'series' | 'code' | 'subject' | 'store' | 'remarks' | 'handler' | 'requester' | 'status' | 'characterization' | 'priority' | 'start' | 'end' | 'created' | 'updated' | 'erp';
type ColState = { key: ColKey; width: number; hidden: boolean };
type SortKey = 'due_desc' | 'due' | 'updated' | 'created';
type GroupBy = '' | 'branch' | 'series' | 'status' | 'handler' | 'characterization' | 'month';
type Extra = { owner: string; priority: string; erpStatus: string; from: string; to: string; overdue: boolean; remarks: boolean };

// Every column the grid can show: width in px (resizable), which are on by default, and the server sort it maps to
const COLUMNS: { key: ColKey; width: number; on: boolean; sort?: SortKey }[] = [
  { key: 'when', width: 140, on: true, sort: 'due_desc' }, { key: 'series', width: 160, on: true }, { key: 'code', width: 120, on: false },
  { key: 'subject', width: 340, on: true }, { key: 'store', width: 150, on: false }, { key: 'remarks', width: 260, on: false },
  { key: 'handler', width: 180, on: true }, { key: 'requester', width: 160, on: false }, { key: 'status', width: 170, on: true },
  { key: 'characterization', width: 160, on: false }, { key: 'priority', width: 100, on: false }, { key: 'start', width: 140, on: false },
  { key: 'end', width: 140, on: false }, { key: 'created', width: 140, on: false, sort: 'created' }, { key: 'updated', width: 140, on: false, sort: 'updated' },
  { key: 'erp', width: 64, on: true },
];
type Layout = { cols: ColState[]; dense: boolean; group: string };
type LayoutResp = { organization: Layout | null; mine: Layout | null; effective: Layout | null; source: 'user' | 'organization' | 'default'; can_edit_organization: boolean };
const GRID = 'customer_actions';
const defaultCols = (): ColState[] => COLUMNS.map((c) => ({ key: c.key, width: c.width, hidden: !c.on }));
/** A saved layout, with columns added since then appended and unknown ones dropped. */
function colsOf(saved?: ColState[] | null): ColState[] {
  if (!saved?.length) return defaultCols();
  const known = saved.filter((c) => COLUMNS.some((x) => x.key === c.key));
  for (const c of COLUMNS) if (!known.some((x) => x.key === c.key)) known.push({ key: c.key, width: c.width, hidden: !c.on });
  return known;
}
const NO_EXTRA: Extra = { owner: '', priority: '', erpStatus: '', from: '', to: '', overdue: false, remarks: false };

export function CustomerActions({ customerId, customerName, canEdit }: { customerId: string; customerName: string; canEdit: boolean }) {
  const t = useTranslations('actions');
  const tc = useTranslations('crm');
  const locale = useLocale();
  const toast = useToast();
  const refresh = useCrmRefresh();
  const meta = useCrmMeta();
  const aiOn = useAi('actions_summary');
  const [status, setStatus] = useState<Filter>('any');
  const [type, setType] = useState('');
  const [char, setChar] = useState('');
  const [extra, setExtra] = useState<Extra>(NO_EXTRA);
  const [sort, setSort] = useState<SortKey>('due_desc');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: string; preset?: EditorPreset } | null>(null);
  const [complete, setComplete] = useState<Activity | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [panel, setPanel] = useState<'filters' | 'columns' | null>(null);
  const [cols, setCols] = useState<ColState[]>(defaultCols);
  const [dense, setDense] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Grid layout is a per-viewer convenience: kept in this browser
  // Layout: mine, else the organisation's, else built-in. Changes are saved as mine (follows me on every device).
  const qc = useQueryClient();
  const layoutQ = useQuery({ queryKey: ['grids', GRID], queryFn: () => api<LayoutResp>(`/me/grids/${GRID}`), staleTime: 300_000 });
  const [touched, setTouched] = useState(0);
  const applyLayout = (l: Layout | null) => { setCols(colsOf(l?.cols)); setDense(!!l?.dense); setGroupBy((l?.group ?? '') as GroupBy); };
  useEffect(() => { if (layoutQ.data) applyLayout(layoutQ.data.effective); }, [layoutQ.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!touched) return;
    const h = setTimeout(() => {
      api(`/me/grids/${GRID}`, { method: 'PUT', json: { layout: { cols, dense, group: groupBy } } })
        .then(() => qc.setQueryData<LayoutResp>(['grids', GRID], (d) => d && { ...d, mine: { cols, dense, group: groupBy }, effective: { cols, dense, group: groupBy }, source: 'user' }))
        .catch(() => {});
    }, 700);
    return () => clearTimeout(h);
  }, [touched]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => setTouched((n) => n + 1);
  const pickGroup = (g: GroupBy) => { setGroupBy(g); setCollapsed(new Set()); changed(); };
  const saveCols = (next: ColState[]) => { setCols(next); changed(); };
  const setOrgLayout = async (reset: boolean) => {
    try {
      await api(`/settings/grids/${GRID}`, { method: 'PUT', json: { layout: reset ? null : { cols, dense, group: groupBy } } });
      toast({ title: reset ? t('layoutOrgReset') : t('layoutOrgSaved') });
      qc.invalidateQueries({ queryKey: ['grids', GRID] });
    } catch { toast({ title: t('layoutError') }); }
  };
  const followOrg = async () => {
    await api(`/me/grids/${GRID}`, { method: 'PUT', json: { layout: null } }).catch(() => {});
    const d = await qc.fetchQuery({ queryKey: ['grids', GRID], queryFn: () => api<LayoutResp>(`/me/grids/${GRID}`), staleTime: 0 });
    applyLayout(d.effective); toast({ title: t('layoutFollowOrg') });
  };
  useEffect(() => { const h = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const params = new URLSearchParams({ scope: 'all', status, customer_id: customerId, sort, limit: groupBy ? '200' : '50' });
  if (type) params.set('type', type);
  if (char) params.set('characterization', char);
  if (extra.erpStatus) params.set('erp_status', extra.erpStatus);
  if (extra.owner) params.set('owner', extra.owner);
  if (extra.priority) params.set('priority', extra.priority);
  if (extra.overdue) params.set('due', 'overdue');
  else if (extra.from || extra.to) {
    params.set('due', 'range');
    if (extra.from) params.set('from', new Date(`${extra.from}T00:00:00`).toISOString());
    if (extra.to) params.set('to', new Date(new Date(`${extra.to}T00:00:00`).getTime() + 864e5).toISOString());
  }
  if (dq.length >= 2) params.set('q', dq);
  const list = useInfiniteQuery({
    queryKey: ['crm', 'customer-actions', customerId, params.toString()],
    queryFn: ({ pageParam }) => api<Page>(`/crm/activities?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '' as string, getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const all = list.data?.pages.flatMap((p) => p.items) ?? [];
  const rows = extra.remarks ? all.filter((a) => a.body) : all;
  const erp = meta.data?.erp?.enabled;
  const values = meta.data?.erp_values ?? [];
  const chars = values.filter((x) => x.kind === 'characterization' && x.active);
  const statuses = values.filter((x) => x.kind === 'status' && x.active);
  const users = meta.data?.users ?? [];

  // Active filters as removable chips
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (status !== 'any') chips.push({ key: 'status', label: t(`f_${status}`), clear: () => setStatus('any') });
  if (type) chips.push({ key: 'type', label: meta.data?.types.find((x) => x.key === type)?.name ?? type, clear: () => setType('') });
  if (char) chips.push({ key: 'char', label: chars.find((x) => x.code === char)?.name ?? char, clear: () => setChar('') });
  if (extra.erpStatus) chips.push({ key: 'erp', label: statuses.find((x) => x.code === extra.erpStatus)?.name ?? extra.erpStatus, clear: () => setExtra((e) => ({ ...e, erpStatus: '' })) });
  if (extra.owner) chips.push({ key: 'owner', label: `${t('h_handler')}: ${users.find((u) => u.id === extra.owner)?.full_name ?? '—'}`, clear: () => setExtra((e) => ({ ...e, owner: '' })) });
  if (extra.priority) chips.push({ key: 'prio', label: tc(`prio_${extra.priority}`), clear: () => setExtra((e) => ({ ...e, priority: '' })) });
  if (extra.overdue) chips.push({ key: 'overdue', label: tc('overdue'), clear: () => setExtra((e) => ({ ...e, overdue: false })) });
  if (extra.from || extra.to) chips.push({ key: 'range', label: `${extra.from || '…'} → ${extra.to || '…'}`, clear: () => setExtra((e) => ({ ...e, from: '', to: '' })) });
  if (extra.remarks) chips.push({ key: 'remarks', label: t('withRemarks'), clear: () => setExtra((e) => ({ ...e, remarks: false })) });
  if (dq) chips.push({ key: 'q', label: `«${dq}»`, clear: () => setQ('') });
  const clearAll = () => { setStatus('any'); setType(''); setChar(''); setExtra(NO_EXTRA); setQ(''); };
  const extraCount = [extra.owner, extra.priority, extra.erpStatus, extra.from || extra.to, extra.overdue, extra.remarks].filter(Boolean).length;

  const d = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const dt = (iso: string | null) => (iso ? `${d(iso)} ${hm(iso)}` : '—');
  /** "14:00 → 15:30" the same day, "→ 03/12/2026" when it ends another day */
  const span = (a: Activity) => {
    if (!a.due_at) return '';
    const from = a.all_day ? '' : hm(a.due_at);
    if (!a.ends_at) return from;
    const sameDay = new Date(a.ends_at).toDateString() === new Date(a.due_at).toDateString();
    return `${from}${from ? ' ' : ''}→ ${sameDay ? hm(a.ends_at) : d(a.ends_at)}`;
  };
  const statusOf = (a: Activity) => a.erp_status_name ?? tc(`st_${a.status}`);
  const statusTone = (s: ActivityStatus, overdue: boolean) => (s === 'done' ? 'bg-success-soft text-success' : s === 'cancelled' ? 'bg-surface-2 text-muted' : overdue ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info');
  /** Group label of an activity, and the groups in display order (empty group last; months newest first) */
  const groupOf = (a: Activity): string => {
    switch (groupBy) {
      case 'branch': return a.branch_name ?? '';
      case 'series': return a.type_name ?? a.type;
      case 'status': return a.overdue ? tc('overdue') : statusOf(a);
      case 'handler': return a.owner_name ?? '';
      case 'characterization': return a.characterization_name ?? '';
      case 'month': { const x = a.due_at ?? a.created_at; return x.slice(0, 7); }
      default: return '';
    }
  };
  const groups = (() => {
    if (!groupBy) return [{ key: '', rows }];
    const by = new Map<string, Activity[]>();
    for (const a of rows) { const k = groupOf(a); by.set(k, [...(by.get(k) ?? []), a]); }
    const keys = [...by.keys()].sort((x, y) => (!x ? 1 : !y ? -1 : groupBy === 'month' ? y.localeCompare(x) : x.localeCompare(y, locale)));
    return keys.map((key) => ({ key, rows: by.get(key)! }));
  })();
  const groupLabel = (k: string) => (groupBy === 'month' && k
    ? new Date(`${k}-15T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
    : k || t(`g_none_${groupBy}`));
  const toggleGroup = (k: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const groupStats = (rs: Activity[]) => ({
    open: rs.filter((a) => a.status === 'planned' || a.status === 'in_progress').length,
    overdue: rs.filter((a) => a.overdue).length,
    last: rs.reduce<string | null>((m, a) => { const x = a.due_at ?? a.created_at; return !m || x > m ? x : m; }, null),
  });
  const prioTone = (p: number) => (p === 1 ? 'bg-danger-soft text-danger' : p === 3 ? 'bg-surface-2 text-muted' : 'text-muted');

  const sync = async () => {
    setSyncing(true);
    try { await api('/settings/erp/sync', { method: 'POST', json: { what: 'pull' } }); toast({ title: t('syncQueued') }); setTimeout(() => refresh(), 6000); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'not_configured' ? t('syncNotConfigured') : t('syncError') }); }
    setSyncing(false);
  };
  const resend = async (a: Activity) => { await api(`/crm/activities/${a.id}/erp-sync`, { method: 'POST' }); toast({ title: t('resendQueued') }); refresh(); };
  const newActivity = () => setEdit({ preset: { type: meta.data?.types.find((x) => x.active)?.key, customer_id: customerId, customer_name: customerName } });

  // ---- cells
  const cell = (k: ColKey, a: Activity): ReactNode => {
    const Icon = iconOf(a.type_icon);
    switch (k) {
      case 'when': return <><div className={clsx('font-semibold tabular', a.overdue && 'text-danger')}>{d(a.due_at ?? a.created_at)}</div>{!dense && <div className="truncate text-xs text-muted tabular">{span(a)}</div>}</>;
      case 'series': return (
        <div className="flex min-w-0 items-center gap-2">
          <span className={clsx('grid shrink-0 place-items-center rounded-lg', dense ? 'h-6 w-6' : 'h-7 w-7', tone(a.type_color))}><Icon size={dense ? 12 : 14} /></span>
          <div className="min-w-0"><div className="truncate font-medium">{a.type_name ?? a.type}</div>{!dense && a.erp_code && <div className="truncate font-mono text-[11px] text-muted">{a.erp_code}</div>}</div>
        </div>);
      case 'code': return <span className="font-mono text-xs">{a.erp_code ?? '—'}</span>;
      case 'subject': return (
        <>
          <div className="flex items-start gap-1.5">
            {a.priority === 1 && <Flag size={13} className="mt-1 shrink-0 fill-danger text-danger" aria-label={tc('prio_1')} />}
            <span className={clsx('font-semibold [overflow-wrap:anywhere]', dense && 'line-clamp-1')}>{a.subject}</span>
          </div>
          {!dense && (a.branch_name || a.body) && !visible.includes('remarks') && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
              {a.branch_name && !visible.includes('store') && <span className="flex shrink-0 items-center gap-1"><Store size={11} /> {a.branch_name}</span>}
              {a.branch_name && !visible.includes('store') && a.body && <span>·</span>}
              {a.body && <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{a.body}</span>}
            </div>
          )}
        </>);
      case 'store': return <span className="block truncate">{a.branch_name ?? '—'}</span>;
      case 'remarks': return <span className={clsx('text-xs text-muted [overflow-wrap:anywhere]', dense ? 'line-clamp-1' : 'whitespace-pre-wrap')}>{a.body || '—'}</span>;
      case 'handler': return <><div className="truncate font-medium">{a.owner_name ?? '—'}</div>{!dense && !visible.includes('requester') && a.requested_by_name && a.requested_by !== a.owner_id && <div className="truncate text-xs text-muted">{t('by', { name: a.requested_by_name })}</div>}</>;
      case 'requester': return <span className="block truncate">{a.requested_by_name ?? '—'}</span>;
      case 'status': return (
        <>
          <span className={clsx('inline-block max-w-full truncate rounded-md px-2 py-0.5 text-xs font-semibold', statusTone(a.status, a.overdue))}>{a.overdue ? tc('overdue') : statusOf(a)}</span>
          {!dense && !visible.includes('characterization') && a.characterization_name && <div className="mt-1 truncate text-xs text-muted">{a.characterization_name}</div>}
        </>);
      case 'characterization': return <span className="block truncate">{a.characterization_name ?? '—'}</span>;
      case 'priority': return <span className={clsx('rounded-md px-1.5 py-0.5 text-xs font-semibold', prioTone(a.priority))}>{tc(`prio_${a.priority}`)}</span>;
      case 'start': return <span className="tabular">{dt(a.due_at)}</span>;
      case 'end': return <span className="tabular">{dt(a.ends_at)}</span>;
      case 'created': return <span className="tabular">{dt(a.created_at)}</span>;
      case 'updated': return <span className="tabular">{dt(a.updated_at)}</span>;
      case 'erp': return a.erp_state ? <ErpBadge state={a.erp_state} error={a.erp_error} compact /> : null;
    }
  };
  const shownCols = cols.filter((c) => !c.hidden && (c.key !== 'erp' || erp));
  const visible = shownCols.map((c) => c.key);
  const total = shownCols.reduce((s, c) => s + c.width, 0);

  // ---- resizing: drag the right edge of a header
  const startResize = (key: ColKey, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, start = cols.find((c) => c.key === key)!.width;
    const move = (ev: PointerEvent) => setCols((cs) => cs.map((c) => (c.key === key ? { ...c, width: Math.max(56, Math.min(800, start + ev.clientX - startX)) } : c)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setCols((cs) => { saveCols(cs); return cs; }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const sortFor = (k: ColKey) => COLUMNS.find((c) => c.key === k)?.sort;
  const headerClick = (k: ColKey) => {
    const s = sortFor(k);
    if (!s) return;
    if (k === 'when') setSort(sort === 'due_desc' ? 'due' : 'due_desc'); else setSort(sort === s ? 'due_desc' : s);
  };

  // ---- CSV of what is shown (visible columns, plain text)
  const exportCsv = () => {
    const plain = (k: ColKey, a: Activity): string => ({
      when: d(a.due_at ?? a.created_at), series: a.type_name ?? a.type, code: a.erp_code ?? '', subject: a.subject, store: a.branch_name ?? '', remarks: a.body ?? '',
      handler: a.owner_name ?? '', requester: a.requested_by_name ?? '', status: statusOf(a), characterization: a.characterization_name ?? '', priority: tc(`prio_${a.priority}`),
      start: a.due_at ?? '', end: a.ends_at ?? '', created: a.created_at, updated: a.updated_at, erp: a.erp_state ?? '',
    } as Record<ColKey, string>)[k];
    const esc = (x: string) => (/[",;\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
    const lines = [visible.map((k) => esc(t(`h_${k}`))).join(','), ...rows.map((a) => visible.map((k) => esc(plain(k, a))).join(','))];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    const el = document.createElement('a'); el.href = url; el.download = `${customerName.replace(/[^\p{L}\p{N}]+/gu, '-')}-energeies.csv`; el.click(); URL.revokeObjectURL(url);
  };

  const select = 'h-8 rounded-lg border border-border bg-surface pl-2 pr-7 text-sm outline-none focus:border-primary';
  const toolBtn = (active: boolean) => clsx('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition', active ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface hover:border-primary');
  return (
    <div className="@container space-y-3">
      {/* ---------------------------------------------------------------- toolbar */}
      <div className="card space-y-2.5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 min-w-0 flex-1 basis-56 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 focus-within:border-primary">
            <Search size={16} className="shrink-0 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="clear" className="text-muted"><X size={15} /></button>}
          </label>
          <div className="flex items-center gap-2">
            {aiOn && (
              <button type="button" onClick={() => setShowAi(!showAi)} aria-pressed={showAi}
                className={clsx('flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition', showAi ? 'bg-primary-soft text-primary' : 'border border-border bg-surface hover:border-primary')}>
                <Sparkles size={15} /> <span className="hidden @md:inline">{t('ai')}</span>
              </button>
            )}
            {erp && (
              <button type="button" onClick={sync} disabled={syncing} title={t('syncHint')} aria-label={t('sync')}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium hover:border-primary disabled:opacity-60">
                <RefreshCw size={15} className={clsx(syncing && 'animate-spin')} /> <span className="hidden @md:inline">{t('sync')}</span>
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={newActivity} className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm">
                <Plus size={16} /> {t('new')}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="no-scrollbar flex gap-0.5 overflow-x-auto rounded-lg bg-surface-2 p-0.5 text-sm">
            {(['any', 'open', 'done', 'cancelled'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k}
                className={clsx('shrink-0 rounded-md px-3 py-1 font-medium transition', status === k ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>{t(`f_${k}`)}</button>
            ))}
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('series')} className={select}>
            <option value="">{t('allSeries')}</option>
            {meta.data?.types.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
          {chars.length > 0 && (
            <select value={char} onChange={(e) => setChar(e.target.value)} aria-label={t('characterization')} className={select}>
              <option value="">{t('allChars')}</option>
              {chars.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </select>
          )}
          <label className={clsx(toolBtn(!!groupBy), 'pr-1')}>
            <Group size={14} /> <span className="hidden @xl:inline">{t('groupBy')}</span>
            <select value={groupBy} onChange={(e) => pickGroup(e.target.value as GroupBy)} aria-label={t('groupBy')} className="bg-transparent pr-1 text-sm outline-none">
              <option value="">{t('g_off')}</option>
              {(['branch', 'series', 'status', 'handler', 'characterization', 'month'] as const).map((g) => <option key={g} value={g}>{t(`g_${g}`)}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setPanel(panel === 'filters' ? null : 'filters')} aria-expanded={panel === 'filters'} className={toolBtn(panel === 'filters' || extraCount > 0)}>
            <SlidersHorizontal size={14} /> {t('moreFilters')}{extraCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-white">{extraCount}</span>}
          </button>
          <span className="flex-1" />
          {groupBy && groups.length > 1 && (
            <button type="button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.key)))} className="text-xs font-medium text-primary">
              {collapsed.size ? t('g_expandAll') : t('g_collapseAll')}
            </button>
          )}
          <span className="text-xs text-muted tabular">{rows.length > 0 && (groupBy ? t('g_count', { g: groups.length, n: rows.length, more: list.hasNextPage ? '+' : '' }) : t('shown', { n: rows.length, more: list.hasNextPage ? '+' : '' }))}</span>
          <div className="hidden items-center gap-1 @3xl:flex">
            <button type="button" onClick={() => { setDense(!dense); changed(); }}
              aria-pressed={dense} title={t('dense')} aria-label={t('dense')} className={toolBtn(dense)}><Rows3 size={14} /></button>
            <button type="button" onClick={() => setPanel(panel === 'columns' ? null : 'columns')} aria-expanded={panel === 'columns'} className={toolBtn(panel === 'columns')}><Columns3 size={14} /> {t('columns')}</button>
            <button type="button" onClick={exportCsv} disabled={!rows.length} title={t('exportCsv')} aria-label={t('exportCsv')} className={toolBtn(false)}><Download size={14} /></button>
          </div>
        </div>

        {panel === 'filters' && (
          <div className="grid gap-2 rounded-xl bg-surface-2 p-3 @xl:grid-cols-3 @4xl:grid-cols-6">
            <label className="min-w-0"><span className="mb-1 block text-xs text-muted">{t('h_handler')}</span>
              <select value={extra.owner} onChange={(e) => setExtra((x) => ({ ...x, owner: e.target.value }))} className={clsx(select, 'w-full')}>
                <option value="">{t('anyone')}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select></label>
            <label className="min-w-0"><span className="mb-1 block text-xs text-muted">{t('h_priority')}</span>
              <select value={extra.priority} onChange={(e) => setExtra((x) => ({ ...x, priority: e.target.value }))} className={clsx(select, 'w-full')}>
                <option value="">{t('any')}</option>{['1', '2', '3'].map((p) => <option key={p} value={p}>{tc(`prio_${p}`)}</option>)}
              </select></label>
            {statuses.length > 0 && (
              <label className="min-w-0"><span className="mb-1 block text-xs text-muted">{t('erpStatus')}</span>
                <select value={extra.erpStatus} onChange={(e) => setExtra((x) => ({ ...x, erpStatus: e.target.value }))} className={clsx(select, 'w-full')}>
                  <option value="">{t('any')}</option>{statuses.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select></label>
            )}
            <label className="min-w-0"><span className="mb-1 block text-xs text-muted">{t('from')}</span>
              <input type="date" value={extra.from} disabled={extra.overdue} onChange={(e) => setExtra((x) => ({ ...x, from: e.target.value }))} className={clsx(select, 'w-full pr-2')} /></label>
            <label className="min-w-0"><span className="mb-1 block text-xs text-muted">{t('to')}</span>
              <input type="date" value={extra.to} disabled={extra.overdue} onChange={(e) => setExtra((x) => ({ ...x, to: e.target.value }))} className={clsx(select, 'w-full pr-2')} /></label>
            <div className="flex flex-col justify-end gap-1.5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--primary)]" checked={extra.overdue} onChange={(e) => setExtra((x) => ({ ...x, overdue: e.target.checked }))} /> {t('onlyOverdue')}</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--primary)]" checked={extra.remarks} onChange={(e) => setExtra((x) => ({ ...x, remarks: e.target.checked }))} /> {t('withRemarks')}</label>
            </div>
          </div>
        )}

        {panel === 'columns' && (
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="mb-2 flex items-center gap-2"><span className="flex-1 text-xs text-muted">{t('columnsHint')}</span>
              <button type="button" onClick={() => saveCols(defaultCols())} className="text-xs font-medium text-primary">{t('resetColumns')}</button></div>
            <ul className="grid gap-1 @xl:grid-cols-2 @3xl:grid-cols-4">
              {cols.filter((c) => c.key !== 'erp' || erp).map((c, i) => (
                <li key={c.key} className="flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1.5 text-sm">
                  <input type="checkbox" className="accent-[var(--primary)]" checked={!c.hidden} disabled={c.key === 'subject'} id={`col-${c.key}`}
                    onChange={() => saveCols(cols.map((x) => (x.key === c.key ? { ...x, hidden: !x.hidden } : x)))} />
                  <label htmlFor={`col-${c.key}`} className="min-w-0 flex-1 truncate">{t(`h_${c.key}`)}</label>
                  <button type="button" disabled={i === 0} onClick={() => { const n = [...cols]; const j = cols.indexOf(c); [n[j - 1], n[j]] = [n[j], n[j - 1]]; saveCols(n); }} aria-label={t('moveLeft')} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-2 disabled:opacity-30"><ChevronLeft size={13} /></button>
                  <button type="button" disabled={cols.indexOf(c) === cols.length - 1} onClick={() => { const n = [...cols]; const j = cols.indexOf(c); [n[j + 1], n[j]] = [n[j], n[j + 1]]; saveCols(n); }} aria-label={t('moveRight')} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-2 disabled:opacity-30"><ChevronRight size={13} /></button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
              <span className="flex items-center gap-1.5 text-muted"><Save size={13} /> {t(`layoutSource_${layoutQ.data?.source ?? 'default'}`)}</span>
              <span className="flex-1" />
              {layoutQ.data?.mine && <button type="button" onClick={followOrg} className="font-medium text-primary">{layoutQ.data.organization ? t('layoutUseOrg') : t('layoutUseDefault')}</button>}
              {layoutQ.data?.can_edit_organization && (
                <>
                  <button type="button" onClick={() => setOrgLayout(false)} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 font-semibold text-white"><Building2 size={13} /> {t('layoutSetOrg')}</button>
                  {layoutQ.data.organization && <button type="button" onClick={() => setOrgLayout(true)} className="font-medium text-muted hover:text-text">{t('layoutResetOrg')}</button>}
                </>
              )}
            </div>
          </div>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span key={c.key} className="flex items-center gap-1 rounded-full bg-primary-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
                {c.label}<button type="button" onClick={c.clear} aria-label={t('clear')} className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary/15"><X size={11} /></button>
              </span>
            ))}
            {chips.length > 1 && <button type="button" onClick={clearAll} className="text-xs font-medium text-muted hover:text-text">{t('clear')}</button>}
          </div>
        )}
      </div>

      {showAi && aiOn && <ActionsAi customerId={customerId} onClose={() => setShowAi(false)} />}

      {/* ---------------------------------------------------------------- list */}
      {list.isLoading ? <div className="card py-12 text-center"><Loader2 className="mx-auto animate-spin text-muted" /></div>
        : !rows.length ? (
          <div className="card flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted"><MessageSquareText size={22} /></span>
            <p className="text-sm text-muted">{chips.length ? t('emptyFiltered') : t('empty')}</p>
            {chips.length > 0 && <button type="button" onClick={clearAll} className="text-sm font-medium text-primary">{t('clear')}</button>}
            {canEdit && !chips.length && <button type="button" onClick={newActivity} className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"><Plus size={16} /> {t('new')}</button>}
          </div>
        ) : (
          <>
            {/* Wide: configurable grid */}
            <div className="card hidden overflow-x-auto @3xl:block">
              <table className="table-fixed text-left text-sm" style={{ width: `max(100%, ${total}px)` }}>
                <colgroup>{shownCols.map((c) => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
                <thead className="sticky top-0 z-10 bg-surface-2 text-xs text-muted">
                  <tr>
                    {shownCols.map((c) => {
                      const s = sortFor(c.key);
                      const activeSort = s && (c.key === 'when' ? sort === 'due_desc' || sort === 'due' : sort === s);
                      return (
                        <th key={c.key} className={clsx('group relative select-none px-3 py-2.5 font-medium', c.key === 'erp' && 'text-center')}>
                          <button type="button" onClick={() => headerClick(c.key)} disabled={!s} className={clsx('flex max-w-full items-center gap-1 truncate', s && 'hover:text-text', activeSort && 'text-primary')}>
                            <span className="truncate">{c.key === 'erp' ? 'ERP' : t(`h_${c.key}`)}</span>
                            {activeSort && (sort === 'due' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                          </button>
                          <span role="separator" aria-orientation="vertical" aria-label={t('resize')} onPointerDown={(e) => startResize(c.key, e)}
                            onDoubleClick={() => saveCols(cols.map((x) => (x.key === c.key ? { ...x, width: COLUMNS.find((y) => y.key === c.key)!.width } : x)))}
                            className="absolute inset-y-1 right-0 w-2 cursor-col-resize border-r-2 border-transparent group-hover:border-border hover:!border-primary" />
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groups.map((g) => (
                    <Fragment key={`g-${g.key}`}>
                      {groupBy && (() => {
                        const st = groupStats(g.rows);
                        const shut = collapsed.has(g.key);
                        return (
                          <tr className="bg-surface-2/80">
                            <td colSpan={shownCols.length} className="p-0">
                              <button type="button" onClick={() => toggleGroup(g.key)} aria-expanded={!shut}
                                className="sticky left-0 flex w-full max-w-[100cqw] items-center gap-2 px-3 py-2 text-left text-sm">
                                <ChevronDown size={15} className={clsx('shrink-0 text-muted transition', shut && '-rotate-90')} />
                                {groupBy === 'branch' && <Store size={14} className="shrink-0 text-muted" />}
                                <span className={clsx('truncate font-semibold', !g.key && 'text-muted')}>{groupLabel(g.key)}</span>
                                <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold tabular">{g.rows.length}</span>
                                {st.open > 0 && <span className="shrink-0 text-xs text-info">{t('g_open', { n: st.open })}</span>}
                                {st.overdue > 0 && <span className="shrink-0 text-xs font-semibold text-danger">{t('g_overdue', { n: st.overdue })}</span>}
                                <span className="flex-1" />
                                {st.last && <span className="hidden shrink-0 text-xs text-muted @xl:inline">{t('g_last', { when: d(st.last) })}</span>}
                              </button>
                            </td>
                          </tr>
                        );
                      })()}
                  {!collapsed.has(g.key) && g.rows.map((a) => {
                    const isOpen = open === a.id;
                    return (
                      <Fragment key={a.id}>
                        <tr onClick={() => setOpen(isOpen ? null : a.id)} aria-expanded={isOpen}
                          className={clsx('group cursor-pointer align-top transition-colors', isOpen ? 'bg-primary-soft/40' : 'hover:bg-surface-2/70')}>
                          {shownCols.map((c) => <td key={c.key} className={clsx('min-w-0 overflow-hidden px-3', dense ? 'py-1.5' : 'py-3', c.key === 'erp' && 'text-center')}>{cell(c.key, a)}</td>)}
                        </tr>
                        {isOpen && (
                          <tr className="bg-primary-soft/40">
                            <td colSpan={shownCols.length} className="px-4 pb-4 pt-0">
                              <Details a={a} canEdit={canEdit} onEdit={() => setEdit({ id: a.id })} onComplete={() => setComplete(a)} onResend={() => resend(a)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Narrow: cards */}
            <div className="space-y-3 @3xl:hidden">
            {groups.map((g) => (
            <section key={`gc-${g.key}`} className="space-y-2">
              {groupBy && (
                <button type="button" onClick={() => toggleGroup(g.key)} aria-expanded={!collapsed.has(g.key)} className="flex w-full items-center gap-2 px-1 text-left text-sm">
                  <ChevronDown size={15} className={clsx('text-muted transition', collapsed.has(g.key) && '-rotate-90')} />
                  <span className={clsx('truncate font-semibold', !g.key && 'text-muted')}>{groupLabel(g.key)}</span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular">{g.rows.length}</span>
                  {groupStats(g.rows).overdue > 0 && <span className="text-xs font-semibold text-danger">{t('g_overdue', { n: groupStats(g.rows).overdue })}</span>}
                </button>
              )}
            <ul className="space-y-2">
              {!collapsed.has(g.key) && g.rows.map((a) => {
                const Icon = iconOf(a.type_icon);
                const isOpen = open === a.id;
                return (
                  <li key={a.id} className={clsx('card overflow-hidden transition', isOpen && 'border-primary/40')}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : a.id)} aria-expanded={isOpen} className="flex w-full items-start gap-3 p-3.5 text-left">
                      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', tone(a.type_color))}><Icon size={17} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                          <span className={clsx('font-semibold tabular', a.overdue ? 'text-danger' : 'text-text')}>{d(a.due_at ?? a.created_at)}</span>
                          <span className="tabular">{span(a)}</span>
                          {a.erp_code && <span className="font-mono">{a.erp_code}</span>}
                        </span>
                        <span className="mt-0.5 flex items-start gap-1.5 font-semibold [overflow-wrap:anywhere]">
                          {a.priority === 1 && <Flag size={13} className="mt-1 shrink-0 fill-danger text-danger" />}{a.subject}
                        </span>
                        {a.body && !isOpen && <span className="mt-1 block whitespace-pre-wrap text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">{a.body}</span>}
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className={clsx('rounded-md px-2 py-0.5 font-semibold', statusTone(a.status, a.overdue))}>{a.overdue ? tc('overdue') : statusOf(a)}</span>
                          {a.characterization_name && <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium">{a.characterization_name}</span>}
                          {a.branch_name && <span className="flex items-center gap-1 text-muted"><Store size={11} /> {a.branch_name}</span>}
                          {a.owner_name && <span className="text-muted">{a.owner_name}</span>}
                          {erp && a.erp_state && <ErpBadge state={a.erp_state} error={a.erp_error} compact />}
                        </span>
                      </span>
                      <ChevronDown size={16} className={clsx('mt-1 shrink-0 text-muted transition', isOpen && 'rotate-180')} />
                    </button>
                    {isOpen && <div className="border-t border-border bg-surface-2/60 px-3.5 pb-3.5"><Details a={a} canEdit={canEdit} mobile onEdit={() => setEdit({ id: a.id })} onComplete={() => setComplete(a)} onResend={() => resend(a)} /></div>}
                  </li>
                );
              })}
            </ul>
            </section>
            ))}
            </div>
            {list.hasNextPage && (
              <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="card w-full py-2.5 text-sm font-medium text-primary hover:border-primary/40">
                {list.isFetchingNextPage ? <Loader2 size={15} className="mx-auto animate-spin" /> : t('more')}
              </button>
            )}
          </>
        )}

      {edit && <ActivityEditor id={edit.id} preset={edit.preset} onClose={() => setEdit(null)} />}
      {complete && <CompleteDialog activity={complete} onClose={() => setComplete(null)} onDone={() => setComplete(null)} />}
    </div>
  );
}

/** Expanded row: remarks (Παρατηρήσεις) + what the row hides + actions. */
function Details({ a, canEdit, mobile, onEdit, onComplete, onResend }: { a: Activity; canEdit: boolean; mobile?: boolean; onEdit: () => void; onComplete: () => void; onResend: () => void }) {
  const t = useTranslations('actions');
  const tc = useTranslations('crm');
  const locale = useLocale();
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : null);
  return (
    <div className="space-y-3 pt-3">
      <div className="rounded-xl border border-border bg-surface p-3.5">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('remarks')}</div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{a.body || <span className="text-muted">{t('noRemarks')}</span>}</p>
      </div>
      <dl className={clsx('grid gap-x-6 gap-y-2 text-sm', mobile ? 'grid-cols-2' : 'grid-cols-2 @3xl:grid-cols-4')}>
        <Info k={t('h_start')} v={when(a.due_at)} /><Info k={t('h_end')} v={when(a.ends_at)} />
        <Info k={t('h_requester')} v={a.requested_by_name} /><Info k={t('h_handler')} v={a.owner_name} />
        <Info k={t('h_store')} v={a.branch_name} /><Info k={t('h_priority')} v={tc(`prio_${a.priority}`)} />
        {a.outcome_name && <Info k={t('outcome')} v={`${a.outcome_name}${a.outcome_note ? ` · ${a.outcome_note}` : ''}`} />}
        {a.erp_synced_at && <Info k="ERP" v={t('syncedAt', { when: when(a.erp_synced_at)! })} />}
      </dl>
      {a.erp_error && <p className="rounded-xl bg-danger-soft p-2.5 text-sm text-danger">{a.erp_error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canEdit && (a.erp_state === 'error' || a.erp_state === 'skipped') && (
          <button type="button" onClick={onResend} className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm font-medium"><RefreshCw size={14} /> {t('resend')}</button>
        )}
        {canEdit && (a.status === 'planned' || a.status === 'in_progress') && (
          <button type="button" onClick={onComplete} className="flex items-center gap-1.5 rounded-xl bg-success-soft px-3 py-1.5 text-sm font-semibold text-success"><CheckCircle2 size={14} /> {t('complete')}</button>
        )}
        <button type="button" onClick={onEdit} className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-white"><Pencil size={14} /> {canEdit ? t('edit') : t('view')}</button>
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string | null | undefined }) {
  return <div className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="[overflow-wrap:anywhere]">{v || '—'}</dd></div>;
}

/** AI: summary of the customer's activities (remarks included) or an answer to a question about them. */
function ActionsAi({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const t = useTranslations('actions');
  const locale = useLocale();
  const [period, setPeriod] = useState<'90d' | '365d' | 'all'>('365d');
  const [question, setQuestion] = useState('');
  const [res, setRes] = useState<{ text?: string; count?: number; at?: string; err?: string; busy?: boolean; asked?: string }>({});
  const run = async (ask?: string) => {
    setRes({ busy: true, asked: ask });
    try {
      const r = await api<{ text: string; count: number; generated_at: string }>(`/ai/customers/${customerId}/actions-summary`, { method: 'POST', json: { locale, period, question: ask || undefined } });
      setRes({ text: r.text, count: r.count, at: r.generated_at, asked: ask });
    } catch (e) { setRes({ err: e instanceof ApiError ? e.code : 'ai_error', asked: ask }); }
  };
  useEffect(() => { run(); /* first summary as soon as the panel opens */ }, [period]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card overflow-hidden border-primary/30">
      <div className="flex flex-wrap items-center gap-2 bg-gradient-to-r from-primary-soft/70 to-transparent px-4 py-3">
        <Sparkles size={16} className="text-primary" />
        <h3 className="flex-1 text-sm font-semibold">{res.asked ? t('aiAnswer') : t('aiTitle')}</h3>
        <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} aria-label={t('aiPeriod')} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs outline-none">
          {(['90d', '365d', 'all'] as const).map((p) => <option key={p} value={p}>{t(`p_${p}`)}</option>)}
        </select>
        <button type="button" onClick={() => run(res.asked)} disabled={res.busy} aria-label={t('aiRefresh')} className="grid h-8 w-8 place-items-center rounded-lg text-primary hover:bg-primary-soft disabled:opacity-50">
          {res.busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
        <button type="button" onClick={onClose} aria-label={t('aiClose')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2"><X size={15} /></button>
      </div>
      <div className="p-4">
        {res.busy && !res.text && (
          <div className="space-y-2" aria-live="polite">
            <p className="flex items-center gap-2 text-sm text-muted"><Wand2 size={14} className="animate-pulse text-primary" /> {t('aiWorking')}</p>
            {[92, 80, 86, 60].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />)}
          </div>
        )}
        {res.err && <AiErrorNote code={res.err} />}
        {res.text && (
          <div className={clsx(res.busy && 'opacity-50')}>
            {res.asked && <p className="mb-2 flex items-center gap-1.5 text-xs text-muted"><ArrowRight size={12} /> {res.asked}</p>}
            <Markdown text={res.text} />
            <p className="mt-2 text-[11px] text-muted">{t('aiBasedOn', { n: res.count ?? 0 })} · {new Date(res.at!).toLocaleTimeString(locale, { timeStyle: 'short' })}</p>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 3) { run(question.trim()); setQuestion(''); } }}
          className="mt-3 flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 p-1 pl-3 focus-within:border-primary">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('aiAsk')} aria-label={t('aiAsk')} maxLength={500} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          <button type="submit" disabled={res.busy || question.trim().length < 3} aria-label={t('aiSend')} className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-white disabled:opacity-40"><Send size={14} /></button>
        </form>
      </div>
    </section>
  );
}
