'use client';
import { VoiceVisitButton } from '@/components/ai-features';
// CRM activities: agenda / list / kanban, counters, filters, bulk actions, export, reports.
import { Suspense, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle, ArrowUpDown, CalendarClock, CalendarDays, CheckCircle2, ChevronDown, Circle, Columns3, Download, Flag, LayoutList, Link2, ListFilter,
  ListTodo, Loader2, Plus, Search, Sparkles, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { tabStore } from '@/lib/tab-store';
import { dueLabel, tone, useCrmMeta, useCrmRefresh, type Activity, type ActivityStatus, type Counts } from '@/lib/crm';
import { useTabTitle } from '@/components/tabs';
import { ActivityEditor, CompleteDialog, TypeIcon, type EditorPreset } from '@/components/crm-editor';
import { CrmReports } from '@/components/crm-reports';
import { Popover } from '@/components/customer-views';
import { appConfirm } from '@/components/confirm';
import { useToast } from '@/components/providers';
import { Link } from '@/i18n/navigation';

type View = 'agenda' | 'list' | 'kanban' | 'reports';
type Filters = { type: string[]; outcome: string[]; priority: string; owner: string; status: string; due: string; auto: boolean };
const EMPTY: Filters = { type: [], outcome: [], priority: '', owner: '', status: 'open', due: '', auto: false };

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

function CrmInner() {
  const t = useTranslations('crm');
  const sp = useSearchParams();
  const meta = useCrmMeta();
  const toast = useToast();
  const refresh = useCrmRefresh();
  useTabTitle(t('title'));
  // View / scope / filters stay with the tab
  const saved = useMemo(() => { try { return JSON.parse(tabStore.getItem('crm.state') ?? '{}'); } catch { return {}; } }, []);
  const [view, setView] = useState<View>((sp.get('view') as View) ?? saved.view ?? 'agenda');
  const [scope, setScope] = useState<'mine' | 'all'>(saved.scope ?? 'mine');
  const [f, setF] = useState<Filters>({ ...EMPTY, ...(saved.f ?? {}), ...(sp.get('type') ? { type: [sp.get('type')!] } : {}) });
  const [sort, setSort] = useState<string>(saved.sort ?? 'due');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  useEffect(() => { try { tabStore.setItem('crm.state', JSON.stringify({ view, scope, f, sort })); } catch {} }, [view, scope, f, sort]);
  const [editor, setEditor] = useState<{ id?: string; preset?: EditorPreset } | null>(sp.get('open') ? { id: sp.get('open')! } : sp.get('new') ? {} : null);
  const [completing, setCompleting] = useState<Activity | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const effScope = meta.data?.can.all ? scope : 'mine';
  const base = useMemo(() => {
    const p = new URLSearchParams({ scope: effScope });
    if (f.type.length) p.set('type', f.type.join(','));
    if (f.outcome.length) p.set('outcome', f.outcome.join(','));
    if (f.priority) p.set('priority', f.priority);
    if (f.owner && meta.data?.can.all) p.set('owner', f.owner);
    if (f.auto) p.set('auto', '1');
    if (dq.length >= 2) p.set('q', dq);
    return p;
  }, [effScope, f, dq, meta.data?.can.all]);
  const counts = useQuery({ queryKey: ['crm', 'counts', effScope, f.owner], queryFn: () => api<Counts>(`/crm/activities/counts?scope=${effScope}${f.owner && meta.data?.can.all ? `&owner=${f.owner}` : ''}`), refetchInterval: 60_000 });
  const filterCount = f.type.length + f.outcome.length + (f.priority ? 1 : 0) + (f.owner ? 1 : 0) + (f.auto ? 1 : 0) + (view === 'list' && f.status !== 'open' ? 1 : 0) + (view === 'list' && f.due ? 1 : 0);
  const setDue = (due: string, status = 'open') => { setF((x) => ({ ...x, due, status })); setView('list'); };

  const bulk = async (action: string, extra: Record<string, unknown> = {}) => {
    if (action === 'delete' && !(await appConfirm(t('bulkDeleteConfirm', { n: selected.size }), { danger: true }))) return;
    const r = await api<{ count: number }>('/crm/activities/bulk', { method: 'POST', json: { ids: [...selected], action, ...extra } });
    toast({ title: t('bulkDone', { n: r.count }) });
    setSelected(new Set()); refresh();
  };
  const exportCsv = () => {
    const p = new URLSearchParams(base);
    p.set('status', view === 'list' ? f.status : 'any');
    if (view === 'list' && f.due) p.set('due', f.due);
    window.location.href = `/api/crm/activities/export.csv?${p}`;
  };

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold tracking-tight">{t('title')}</h1>
        <IcalButton />
        <VoiceVisitButton />
        <button onClick={exportCsv} className="hidden h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium sm:flex"><Download size={16} /> CSV</button>
        {meta.data?.can.edit && (
          <>
            <button onClick={() => setEditor({ preset: { status: 'done', type: 'call' } })} className="hidden h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium sm:flex">
              <CheckCircle2 size={16} /> {t('logDone')}
            </button>
            <button onClick={() => setEditor({})} className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm"><Plus size={17} /> {t('new')}</button>
          </>
        )}
      </header>

      {/* Counters */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-5 sm:px-0">
        {([
          ['overdue', counts.data?.overdue, AlertTriangle, 'danger', () => setDue('overdue')],
          ['today', counts.data?.today, CalendarClock, 'primary', () => setDue('today')],
          ['week', counts.data?.week, CalendarDays, 'info', () => setDue('week')],
          ['open', counts.data?.open, ListTodo, 'warning', () => setDue('')],
          ['doneWeek', counts.data?.done_week, CheckCircle2, 'success', () => { setF((x) => ({ ...x, status: 'done', due: '' })); setSort('completed'); setView('list'); }],
        ] as const).map(([k, n, Icon, c, onClick]) => (
          <button key={k} onClick={onClick} className="card flex min-w-[9.5rem] shrink-0 items-center gap-3 p-3 text-left transition hover:shadow-md sm:min-w-0">
            <span className={clsx('grid h-10 w-10 place-items-center rounded-xl', tone(c))}><Icon size={19} /></span>
            <span className="min-w-0">
              <span className={clsx('block text-xl font-bold tabular', k === 'overdue' && (n ?? 0) > 0 && 'text-danger')}>{n ?? '–'}</span>
              <span className="block truncate text-xs text-muted">{t(`c_${k}`)}</span>
            </span>
          </button>
        ))}
      </div>

      {/* View switch */}
      <div className="grid grid-cols-4 gap-1 rounded-2xl border border-border bg-surface-2 p-1">
        {([['agenda', ListTodo], ['list', LayoutList], ['kanban', Columns3], ['reports', Sparkles]] as const).map(([k, Icon]) => (
          <button key={k} onClick={() => setView(k)} className={clsx('flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition',
            view === k ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-text')}>
            <Icon size={16} /> <span className="hidden sm:inline">{t(`v_${k}`)}</span>
          </button>
        ))}
      </div>

      {view === 'reports' ? <CrmReports scope={effScope} owner={f.owner} /> : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-11 min-w-0 basis-full items-center gap-2 rounded-xl border border-border bg-surface px-3.5 sm:basis-auto sm:flex-1">
              <Search size={18} className="shrink-0 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-full min-w-0 bg-transparent outline-none" />
              {q && <button onClick={() => setQ('')} aria-label="clear"><X size={16} className="text-muted" /></button>}
            </div>
            {meta.data?.can.all && (
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1">
                {(['mine', 'all'] as const).map((s) => (
                  <button key={s} onClick={() => setScope(s)} className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium', scope === s ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t(`scope_${s}`)}</button>
                ))}
              </div>
            )}
            <FilterMenu f={f} setF={setF} count={filterCount} view={view} />
            {view === 'list' && (
              <label className="relative flex h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm">
                <ArrowUpDown size={16} className="text-muted" />
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-transparent outline-none" aria-label={t('sort')}>
                  {['due', 'due_desc', 'created', 'updated', 'completed'].map((s) => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
                </select>
              </label>
            )}
          </div>
          {view === 'list' && (f.due || f.status !== 'open') && (
            <div className="flex flex-wrap gap-1.5">
              {f.due && <Chip onRemove={() => setF((x) => ({ ...x, due: '' }))}>{t(`due_${f.due}`)}</Chip>}
              {f.status !== 'open' && <Chip onRemove={() => setF((x) => ({ ...x, status: 'open' }))}>{t(`fs_${f.status}`)}</Chip>}
            </div>
          )}

          {view === 'agenda' && <Agenda base={base} onOpen={(a) => setEditor({ id: a.id })} onComplete={setCompleting} />}
          {view === 'list' && <ListView base={base} f={f} sort={sort} selected={selected} setSelected={setSelected} onOpen={(a) => setEditor({ id: a.id })} onComplete={setCompleting} />}
          {view === 'kanban' && <Kanban base={base} onOpen={(a) => setEditor({ id: a.id })} onComplete={setCompleting} />}
        </>
      )}

      {/* Bulk bar */}
      {selected.size > 0 && view === 'list' && (
        <div className="card sticky bottom-24 z-20 flex flex-wrap items-center gap-2 p-3 lg:bottom-4">
          <span className="text-sm font-semibold">{t('selected', { n: selected.size })}</span>
          <span className="flex-1" />
          <button className={bulkBtn} onClick={() => bulk('complete')}><CheckCircle2 size={15} /> {t('complete')}</button>
          <BulkMenu label={t('reschedule')} items={[1, 3, 7, -1].map((d) => ({ label: d > 0 ? `+${d} ${t('daysShort')}` : `${d} ${t('daysShort')}`, run: () => bulk('reschedule', { days: d }) }))} />
          {meta.data?.can.all && <BulkMenu label={t('assign')} items={(meta.data?.users ?? []).map((u) => ({ label: u.full_name, run: () => bulk('assign', { owner_id: u.id }) }))} />}
          <BulkMenu label={t('priority')} items={[1, 2, 3].map((p) => ({ label: t(`prio_${p}`), run: () => bulk('priority', { priority: p }) }))} />
          <button className={bulkBtn} onClick={() => bulk('cancel')}>{t('cancelActivity')}</button>
          <button className={clsx(bulkBtn, 'text-danger')} onClick={() => bulk('delete')}>{t('delete')}</button>
          <button className={bulkBtn} onClick={() => setSelected(new Set())} aria-label="clear"><X size={15} /></button>
        </div>
      )}

      {editor && <ActivityEditor id={editor.id} preset={editor.preset} onClose={() => setEditor(null)} />}
      {completing && <CompleteDialog activity={completing} onClose={() => setCompleting(null)} onDone={() => setCompleting(null)} />}
    </div>
  );
}
const bulkBtn = 'flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2';

function BulkMenu({ label, items }: { label: string; items: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className={bulkBtn} onClick={() => setOpen((o) => !o)}>{label} <ChevronDown size={14} /></button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <ul className="max-h-72 overflow-auto">
          {items.map((i) => <li key={i.label}><button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setOpen(false); i.run(); }}>{i.label}</button></li>)}
        </ul>
      </Popover>
    </div>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return <span className="flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">{children}<button onClick={onRemove} aria-label="remove"><X size={12} /></button></span>;
}

function FilterMenu({ f, setF, count, view }: { f: Filters; setF: (fn: (x: Filters) => Filters) => void; count: number; view: View }) {
  const t = useTranslations('crm');
  const meta = useCrmMeta();
  const [open, setOpen] = useState(false);
  const toggle = (k: 'type' | 'outcome', v: string) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const chip = (on: boolean) => clsx('rounded-full border px-3 py-1.5 text-sm', on ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border');
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-label={t('filters')} className={clsx('relative grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface text-muted', count && 'border-primary bg-primary-soft text-primary')}>
        <ListFilter size={18} />
        {count > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-white">{count}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold">{t('filters')}</span>
          {count > 0 && <button onClick={() => setF(() => EMPTY)} className="text-sm font-medium text-primary">{t('clear')}</button>}
        </div>
        <div className="space-y-4">
          {view === 'list' && (
            <>
              <section><div className={lbl}>{t('status')}</div>
                <div className="flex flex-wrap gap-1.5">{['open', 'planned', 'in_progress', 'done', 'cancelled', 'any'].map((s) => <button key={s} className={chip(f.status === s)} onClick={() => setF((x) => ({ ...x, status: s }))}>{t(`fs_${s}`)}</button>)}</div></section>
              <section><div className={lbl}>{t('when')}</div>
                <div className="flex flex-wrap gap-1.5">{['', 'overdue', 'today', 'tomorrow', 'week', 'upcoming', 'nodate'].map((d) => <button key={d || 'all'} className={chip(f.due === d)} onClick={() => setF((x) => ({ ...x, due: d }))}>{d ? t(`due_${d}`) : t('all')}</button>)}</div></section>
            </>
          )}
          <section><div className={lbl}>{t('type')}</div>
            <div className="flex flex-wrap gap-1.5">{(meta.data?.types ?? []).filter((x) => x.active).map((x) => <button key={x.key} className={chip(f.type.includes(x.key))} onClick={() => toggle('type', x.key)}>{x.name}</button>)}</div></section>
          <section><div className={lbl}>{t('priority')}</div>
            <div className="flex flex-wrap gap-1.5">{['', '1', '2', '3'].map((p) => <button key={p || 'all'} className={chip(f.priority === p)} onClick={() => setF((x) => ({ ...x, priority: p }))}>{p ? t(`prio_${p}`) : t('all')}</button>)}</div></section>
          {meta.data?.can.all && (
            <section><div className={lbl}>{t('owner')}</div>
              <select className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm" value={f.owner} onChange={(e) => setF((x) => ({ ...x, owner: e.target.value }))}>
                <option value="">{t('all')}</option>
                {meta.data.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select></section>
          )}
          <section><div className={lbl}>{t('outcome')}</div>
            <div className="flex flex-wrap gap-1.5">{(meta.data?.outcomes ?? []).filter((x) => x.active).map((x) => <button key={x.key} className={chip(f.outcome.includes(x.key))} onClick={() => toggle('outcome', x.key)}>{x.name}</button>)}</div></section>
          <label className="flex items-center justify-between text-sm">{t('onlyAuto')}
            <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={f.auto} onChange={(e) => setF((x) => ({ ...x, auto: e.target.checked }))} /></label>
        </div>
        <button onClick={() => setOpen(false)} className="mt-4 w-full rounded-xl bg-primary py-2.5 font-semibold text-white sm:hidden">{t('done')}</button>
      </Popover>
    </div>
  );
}
const lbl = 'mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted';

type Pg = { items: Activity[]; next_cursor: string | null };
function useActivities(key: unknown[], params: URLSearchParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['crm', 'list', ...key, params.toString()], enabled, initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api<Pg>(`/crm/activities?${params}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }),
    getNextPageParam: (l) => l.next_cursor,
  });
}

/** One activity line: type tile, subject, customer, when, owner; quick complete. */
function Row({ a, onOpen, onComplete, select }: { a: Activity; onOpen: () => void; onComplete: () => void; select?: { on: boolean; toggle: () => void } }) {
  const t = useTranslations('crm');
  const locale = useLocale();
  const open = a.status === 'planned' || a.status === 'in_progress';
  return (
    <li className={clsx('flex items-center gap-3 px-3 py-3 transition hover:bg-surface-2/60 sm:px-4', a.status === 'cancelled' && 'opacity-60')}>
      {select && <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--primary)]" checked={select.on} onChange={select.toggle} aria-label={a.subject} />}
      {open ? (
        <button onClick={onComplete} aria-label={t('complete')} title={t('complete')} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-success-soft hover:text-success">
          <Circle size={20} />
        </button>
      ) : <span className="grid h-7 w-7 shrink-0 place-items-center text-success">{a.status === 'done' ? <CheckCircle2 size={20} /> : <X size={18} className="text-muted" />}</span>}
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <TypeIcon icon={a.type_icon} color={a.type_color} />
        <span className="min-w-0 flex-1">
          <span className={clsx('flex items-center gap-1.5 font-medium', a.status === 'done' && 'text-muted line-through decoration-1')}>
            {a.priority === 1 && <Flag size={13} className="shrink-0 fill-danger text-danger" />}
            <span className="truncate">{a.subject}</span>
            {a.rule_id && <Sparkles size={12} className="shrink-0 text-info" />}
            {a.series_id && <span className="shrink-0 text-xs text-muted">↻</span>}
          </span>
          <span className="block truncate text-xs text-muted">
            {[a.customer_name, a.branch_name, a.contact_name, a.offer_number].filter(Boolean).join(' · ') || a.type_name}
            {a.outcome_name && <span className={clsx('ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold', tone(a.outcome_color))}>{a.outcome_name}</span>}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={clsx('block text-xs font-medium tabular', a.overdue ? 'text-danger' : 'text-muted')}>
            {dueLabel(a.status === 'done' ? a.completed_at : a.due_at, locale, (k) => t(`d_${k}`), a.all_day) || t('noDate')}
          </span>
          {a.owner_name && <span className="block max-w-[8rem] truncate text-[11px] text-muted">{a.owner_name}</span>}
        </span>
      </button>
    </li>
  );
}

function Agenda({ base, onOpen, onComplete }: { base: URLSearchParams; onOpen: (a: Activity) => void; onComplete: (a: Activity) => void }) {
  const t = useTranslations('crm');
  const p = new URLSearchParams(base); p.set('status', 'open'); p.set('sort', 'due'); p.set('limit', '200');
  const q = useActivities(['agenda'], p);
  const items = q.data?.pages.flatMap((x) => x.items) ?? [];
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const bucket = (a: Activity) => {
    if (!a.due_at) return 'nodate';
    const d = new Date(a.due_at);
    if (a.overdue) return 'overdue';
    const diff = Math.floor((d.getTime() - day0.getTime()) / 864e5);
    return diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : diff < 7 ? 'week' : 'later';
  };
  const groups = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate'].map((k) => ({ k, items: items.filter((a) => bucket(a) === k) })).filter((g) => g.items.length);
  if (q.isLoading) return <Loader2 className="mx-auto animate-spin text-muted" />;
  if (!groups.length) return <Empty />;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.k} className="card overflow-hidden">
          <header className={clsx('flex items-center justify-between border-b border-border px-4 py-2.5 text-sm font-semibold', g.k === 'overdue' && 'text-danger')}>
            {t(`b_${g.k}`)} <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{g.items.length}</span>
          </header>
          <ul className="divide-y divide-border">{g.items.map((a) => <Row key={a.id} a={a} onOpen={() => onOpen(a)} onComplete={() => onComplete(a)} />)}</ul>
        </section>
      ))}
      {q.hasNextPage && <button onClick={() => q.fetchNextPage()} className="mx-auto block text-sm font-medium text-primary">{t('more')}</button>}
    </div>
  );
}

function ListView({ base, f, sort, selected, setSelected, onOpen, onComplete }: {
  base: URLSearchParams; f: Filters; sort: string; selected: Set<string>; setSelected: (s: Set<string>) => void; onOpen: (a: Activity) => void; onComplete: (a: Activity) => void;
}) {
  const t = useTranslations('crm');
  const p = new URLSearchParams(base); p.set('status', f.status); p.set('sort', sort); if (f.due) p.set('due', f.due);
  const q = useActivities(['list'], p);
  const items = q.data?.pages.flatMap((x) => x.items) ?? [];
  if (q.isLoading) return <Loader2 className="mx-auto animate-spin text-muted" />;
  if (!items.length) return <Empty />;
  const allOn = items.every((a) => selected.has(a.id));
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs text-muted sm:px-4">
        <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={allOn} aria-label={t('selectAll')}
          onChange={() => setSelected(allOn ? new Set() : new Set(items.map((a) => a.id)))} />
        {t('shown', { n: items.length })}
      </div>
      <ul className="divide-y divide-border">
        {items.map((a) => (
          <Row key={a.id} a={a} onOpen={() => onOpen(a)} onComplete={() => onComplete(a)}
            select={{ on: selected.has(a.id), toggle: () => { const s = new Set(selected); if (s.has(a.id)) s.delete(a.id); else s.add(a.id); setSelected(s); } }} />
        ))}
      </ul>
      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="w-full border-t border-border py-3 text-sm font-medium text-primary">
          {q.isFetchingNextPage ? <Loader2 size={16} className="mx-auto animate-spin" /> : t('more')}
        </button>
      )}
    </div>
  );
}

function Kanban({ base, onOpen, onComplete }: { base: URLSearchParams; onOpen: (a: Activity) => void; onComplete: (a: Activity) => void }) {
  const t = useTranslations('crm');
  const locale = useLocale();
  const refresh = useCrmRefresh();
  const toast = useToast();
  const cols: { status: ActivityStatus; sort: string }[] = [{ status: 'planned', sort: 'due' }, { status: 'in_progress', sort: 'due' }, { status: 'done', sort: 'completed' }];
  const [over, setOver] = useState<string | null>(null);
  const drop = async (id: string, to: ActivityStatus, list: Activity[]) => {
    const a = list.find((x) => x.id === id);
    if (!a || a.status === to) return;
    if (to === 'done') { onComplete(a); return; }
    try { await api(`/crm/activities/${id}/status`, { method: 'PATCH', json: { status: to } }); refresh(); }
    catch { toast({ title: t('saveError') }); }
  };
  const lists = cols.map((c) => { const p = new URLSearchParams(base); p.set('status', c.status); p.set('sort', c.sort); p.set('limit', '100'); return p; });
  const q0 = useActivities(['kanban', 'planned'], lists[0]);
  const q1 = useActivities(['kanban', 'in_progress'], lists[1]);
  const q2 = useActivities(['kanban', 'done'], lists[2]);
  const data = [q0, q1, q2].map((q) => q.data?.pages.flatMap((x) => x.items) ?? []);
  const all = data.flat();
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0">
      {cols.map((c, i) => (
        <section key={c.status} onDragOver={(e) => { e.preventDefault(); setOver(c.status); }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); drop(e.dataTransfer.getData('text/activity'), c.status, all); }}
          className={clsx('flex w-[85vw] shrink-0 snap-start flex-col rounded-2xl bg-surface-2 p-2 transition sm:w-auto', over === c.status && 'ring-2 ring-primary')}>
          <header className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold">
            {t(`st_${c.status}`)} <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{data[i].length}{[q0, q1, q2][i].hasNextPage ? '+' : ''}</span>
          </header>
          <div className="min-h-24 space-y-2">
            {data[i].map((a) => (
              <article key={a.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/activity', a.id)} onClick={() => onOpen(a)}
                className="card cursor-pointer space-y-2 p-3 transition hover:shadow-md">
                <div className="flex items-start gap-2">
                  <TypeIcon icon={a.type_icon} color={a.type_color} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className={clsx('line-clamp-2 text-sm font-medium', a.status === 'done' && 'text-muted line-through')}>{a.priority === 1 && <Flag size={12} className="mr-1 inline fill-danger text-danger" />}{a.subject}</div>
                    {a.customer_name && <div className="truncate text-xs text-muted">{a.customer_name}</div>}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className={clsx('font-medium', a.overdue ? 'text-danger' : 'text-muted')}>{dueLabel(c.status === 'done' ? a.completed_at : a.due_at, locale, (k) => t(`d_${k}`), a.all_day) || t('noDate')}</span>
                  {a.outcome_name ? <span className={clsx('rounded px-1.5 py-0.5 font-semibold', tone(a.outcome_color))}>{a.outcome_name}</span>
                    : <span className="truncate text-muted">{a.owner_name}</span>}
                </div>
              </article>
            ))}
            {!data[i].length && <p className="px-2 py-6 text-center text-xs text-muted">{t('dropHere')}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

function Empty() {
  const t = useTranslations('crm');
  return <div className="card grid place-items-center gap-2 p-10 text-center text-muted"><CheckCircle2 size={32} className="text-success" /><p>{t('empty')}</p></div>;
}

/** Subscribe the personal activity calendar in Google / Outlook / Apple (read-only iCal). */
function IcalButton() {
  const t = useTranslations('crm');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ical = useQuery({ queryKey: ['crm', 'ical'], enabled: open, queryFn: () => api<{ url: string }>('/crm/ical') });
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); toast({ title: t('copied') }); } catch {} };
  const rotate = async () => {
    if (!(await appConfirm(t('icalRotateConfirm')))) return;
    const r = await api<{ url: string }>('/crm/ical/rotate', { method: 'POST' });
    ical.refetch(); copy(r.url);
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium" aria-label={t('ical')}>
        <Link2 size={16} /> <span className="hidden sm:inline">{t('ical')}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="space-y-3 text-sm">
          <div className="font-semibold">{t('icalTitle')}</div>
          <p className="text-muted">{t('icalHint')}</p>
          {ical.data ? (
            <>
              <input readOnly value={ical.data.url} onFocus={(e) => e.target.select()} className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 font-mono text-xs" />
              <div className="flex gap-2">
                <button onClick={() => copy(ical.data!.url)} className="flex-1 rounded-xl bg-primary py-2 font-semibold text-white">{t('copy')}</button>
                <button onClick={rotate} className="rounded-xl border border-border px-3 py-2">{t('icalRotate')}</button>
              </div>
            </>
          ) : <Loader2 className="mx-auto animate-spin text-muted" />}
          <Link href="/calendar" className="block text-center text-xs font-medium text-primary">{t('openCalendar')}</Link>
        </div>
      </Popover>
    </div>
  );
}

export default function CrmPage() {
  return <Suspense><CrmInner /></Suspense>;
}
