'use client';
// Tasks: mine / assigned by me / watching / team; list, kanban (drag & drop with order), month calendar;
// filters, search, bulk actions, templates.
import { Suspense, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CalendarDays, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Columns3, Flag, LayoutList, ListTodo, Loader2, Plus, Search, Send, X } from 'lucide-react';
import { api } from '@/lib/api';
import { tabStore } from '@/lib/tab-store';
import { tone } from '@/lib/crm';
import { useTabTitle } from '@/components/tabs';
import { TASK_STATUSES, TaskDialog, TaskRow, TemplateDialog, useTasksMeta, useTasksRefresh, useToggleTask, type Task, type TaskStatus } from '@/components/task-ui';
import { appConfirm } from '@/components/confirm';
import { useToast } from '@/components/providers';

type View = 'list' | 'kanban' | 'calendar';
type Scope = 'mine' | 'created' | 'watching' | 'team';
function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

function TasksInner() {
  const t = useTranslations('tasks');
  const sp = useSearchParams();
  const meta = useTasksMeta();
  const toast = useToast();
  const refresh = useTasksRefresh();
  const toggle = useToggleTask();
  useTabTitle(t('title'));
  const saved = useMemo(() => { try { return JSON.parse(tabStore.getItem('tasks.state') ?? '{}'); } catch { return {}; } }, []);
  const [view, setView] = useState<View>(saved.view ?? 'list');
  const [scope, setScope] = useState<Scope>(saved.scope ?? 'mine');
  const [status, setStatus] = useState<string>(saved.status ?? 'open');
  const [due, setDue] = useState<string>('');
  const [priority, setPriority] = useState('');
  const [tag, setTag] = useState('');
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  useEffect(() => { try { tabStore.setItem('tasks.state', JSON.stringify({ view, scope, status })); } catch {} }, [view, scope, status]);
  const [open, setOpen] = useState<string | null>(sp.get('open'));
  const [adding, setAdding] = useState(sp.get('new') === '1');
  const [tpl, setTpl] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const counts = useQuery({ queryKey: ['tasks', 'counts'], queryFn: () => api<{ mine: number; overdue: number; today: number; delegated: number; done_week: number }>('/tasks/counts'), refetchInterval: 60_000 });

  const base = useMemo(() => {
    const p = new URLSearchParams({ view: scope });
    if (priority) p.set('priority', priority);
    if (tag) p.set('tag', tag);
    if (owner && scope === 'team') p.set('owner', owner);
    if (dq.length >= 2) p.set('q', dq);
    return p;
  }, [scope, priority, tag, owner, dq]);

  const bulk = async (action: string, extra: Record<string, unknown> = {}) => {
    if (action === 'delete' && !(await appConfirm(t('bulkDeleteConfirm', { n: sel.size }), { danger: true }))) return;
    const r = await api<{ count: number }>('/tasks/bulk', { method: 'POST', json: { ids: [...sel], action, ...extra } });
    toast({ title: t('bulkDone', { n: r.count }) }); setSel(new Set()); refresh();
  };

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold tracking-tight">{t('title')}</h1>
        <button onClick={() => setTpl(true)} className="hidden h-10 items-center rounded-xl border border-border bg-surface px-3 text-sm font-medium sm:flex">{t('fromTemplate')}</button>
        {meta.data?.can.edit && <button onClick={() => setAdding(true)} className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm"><Plus size={17} /> {t('new')}</button>}
      </header>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-5 sm:px-0">
        {([
          ['mine', counts.data?.mine, ListTodo, 'primary', () => { setScope('mine'); setStatus('open'); setDue(''); }],
          ['overdue', counts.data?.overdue, AlertTriangle, 'danger', () => { setScope('mine'); setStatus('open'); setDue('overdue'); setView('list'); }],
          ['today', counts.data?.today, CalendarDays, 'info', () => { setScope('mine'); setStatus('open'); setDue('today'); setView('list'); }],
          ['delegated', counts.data?.delegated, Send, 'warning', () => { setScope('created'); setStatus('open'); setDue(''); }],
          ['doneWeek', counts.data?.done_week, CheckCircle2, 'success', () => { setScope('mine'); setStatus('done'); setDue(''); setView('list'); }],
        ] as const).map(([k, n, Icon, c, fn]) => (
          <button key={k} onClick={fn} className="card flex min-w-[9.5rem] shrink-0 items-center gap-3 p-3 text-left hover:shadow-md sm:min-w-0">
            <span className={clsx('grid h-10 w-10 place-items-center rounded-xl', tone(c))}><Icon size={19} /></span>
            <span className="min-w-0"><span className={clsx('block text-xl font-bold tabular', k === 'overdue' && (n ?? 0) > 0 && 'text-danger')}>{n ?? '–'}</span><span className="block truncate text-xs text-muted">{t(`c_${k}`)}</span></span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-2 p-1">
          {(['mine', 'created', 'watching', ...(meta.data?.can.all ? ['team'] : [])] as Scope[]).map((s) => (
            <button key={s} onClick={() => setScope(s)} className={clsx('shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium', scope === s ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t(`scope_${s}`)}</button>
          ))}
        </div>
        <span className="flex-1" />
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface-2 p-1">
          {([['list', LayoutList], ['kanban', Columns3], ['calendar', CalendarRange]] as const).map(([k, Icon]) => (
            <button key={k} onClick={() => setView(k)} aria-label={t(`v_${k}`)} className={clsx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium', view === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}><Icon size={15} /><span className="hidden md:inline">{t(`v_${k}`)}</span></button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-11 min-w-0 basis-full items-center gap-2 rounded-xl border border-border bg-surface px-3.5 sm:basis-auto sm:flex-1">
          <Search size={18} className="shrink-0 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-full min-w-0 bg-transparent outline-none" />
          {q && <button onClick={() => setQ('')} aria-label="clear"><X size={16} className="text-muted" /></button>}
        </div>
        {view === 'list' && (
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-xl border border-border bg-surface px-3 text-sm" aria-label={t('status')}>
              {['open', ...TASK_STATUSES, 'any'].map((s) => <option key={s} value={s}>{t(`fs_${s}`)}</option>)}
            </select>
            <select value={due} onChange={(e) => setDue(e.target.value)} className="h-11 rounded-xl border border-border bg-surface px-3 text-sm" aria-label={t('due')}>
              {['', 'overdue', 'today', 'week', 'nodate'].map((d) => <option key={d || 'all'} value={d}>{d ? t(`due_${d}`) : t('anyDue')}</option>)}
            </select>
          </>
        )}
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="h-11 rounded-xl border border-border bg-surface px-3 text-sm" aria-label={t('priority')}>
          <option value="">{t('anyPriority')}</option>{['1', '2', '3'].map((p) => <option key={p} value={p}>{t(`prio_${p}`)}</option>)}
        </select>
        {!!meta.data?.tags.length && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} className="h-11 rounded-xl border border-border bg-surface px-3 text-sm" aria-label={t('tags')}>
            <option value="">#</option>{meta.data.tags.map((g) => <option key={g} value={g}>#{g}</option>)}
          </select>
        )}
        {scope === 'team' && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-11 rounded-xl border border-border bg-surface px-3 text-sm" aria-label={t('owner')}>
            <option value="">{t('everyone')}</option>{meta.data?.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}
      </div>

      {view === 'list' && <ListView base={base} status={status} due={due} sel={sel} setSel={setSel} onOpen={setOpen} onToggle={toggle} />}
      {view === 'kanban' && <Kanban base={base} onOpen={setOpen} />}
      {view === 'calendar' && <MonthView base={base} onOpen={setOpen} onNew={() => setAdding(true)} />}

      {sel.size > 0 && view === 'list' && (
        <div className="card sticky bottom-24 z-20 flex flex-wrap items-center gap-2 p-3 lg:bottom-4">
          <span className="text-sm font-semibold">{t('selected', { n: sel.size })}</span>
          <span className="flex-1" />
          <button className={bb} onClick={() => bulk('complete')}><CheckCircle2 size={15} /> {t('markDone')}</button>
          <select className={bb} value="" onChange={(e) => e.target.value && bulk('reschedule', { days: Number(e.target.value) })}>
            <option value="">{t('reschedule')}</option>{[1, 3, 7, -1].map((d) => <option key={d} value={d}>{d > 0 ? `+${d}` : d} {t('days')}</option>)}
          </select>
          <select className={bb} value="" onChange={(e) => e.target.value && bulk('assign', { owner_id: e.target.value })}>
            <option value="">{t('assign')}</option>{meta.data?.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select className={bb} value="" onChange={(e) => e.target.value && bulk('priority', { priority: Number(e.target.value) })}>
            <option value="">{t('priority')}</option>{[1, 2, 3].map((p) => <option key={p} value={p}>{t(`prio_${p}`)}</option>)}
          </select>
          <button className={clsx(bb, 'text-danger')} onClick={() => bulk('delete')}>{t('delete')}</button>
          <button className={bb} onClick={() => setSel(new Set())} aria-label="clear"><X size={15} /></button>
        </div>
      )}

      {open && <TaskDialog id={open} onClose={() => setOpen(null)} />}
      {adding && <TaskDialog onClose={() => setAdding(false)} />}
      {tpl && <TemplateDialog onClose={() => setTpl(false)} />}
    </div>
  );
}
const bb = 'flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2';

function useTaskList(key: string, p: URLSearchParams) {
  return useInfiniteQuery({
    queryKey: ['tasks', key, p.toString()], initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api<{ items: Task[]; next_offset: number | null }>(`/tasks?${p}&offset=${pageParam}`, { signal }),
    getNextPageParam: (l) => l.next_offset,
  });
}

function ListView({ base, status, due, sel, setSel, onOpen, onToggle }: { base: URLSearchParams; status: string; due: string; sel: Set<string>; setSel: (s: Set<string>) => void; onOpen: (id: string) => void; onToggle: (t: Task) => void }) {
  const t = useTranslations('tasks');
  const p = new URLSearchParams(base); p.set('status', status); p.set('limit', '80'); p.set('sort', status === 'done' ? 'updated' : 'due'); if (due) p.set('due', due);
  const q = useTaskList('list', p);
  const items = q.data?.pages.flatMap((x) => x.items) ?? [];
  if (q.isLoading) return <Loader2 className="mx-auto animate-spin text-muted" />;
  if (!items.length) return <div className="card grid place-items-center gap-2 p-10 text-center text-muted"><CheckCircle2 size={32} className="text-success" />{t('empty')}</div>;
  const allOn = items.every((x) => sel.has(x.id));
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs text-muted sm:px-4">
        <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(items.map((x) => x.id)))} aria-label={t('selectAll')} />
        {t('shown', { n: items.length })}
      </div>
      <ul className="divide-y divide-border">
        {items.map((x) => <TaskRow key={x.id} t={x} onOpen={() => onOpen(x.id)} onToggle={() => onToggle(x)}
          select={{ on: sel.has(x.id), toggle: () => { const s = new Set(sel); if (s.has(x.id)) s.delete(x.id); else s.add(x.id); setSel(s); } }} />)}
      </ul>
      {q.hasNextPage && <button onClick={() => q.fetchNextPage()} className="w-full border-t border-border py-3 text-sm font-medium text-primary">{t('more')}</button>}
    </div>
  );
}

function Kanban({ base, onOpen }: { base: URLSearchParams; onOpen: (id: string) => void }) {
  const t = useTranslations('tasks');
  const tc = useTranslations('crm');
  const locale = useLocale();
  const refresh = useTasksRefresh();
  const cols: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'done'];
  const qs = cols.map((c) => { const p = new URLSearchParams(base); p.set('status', c); p.set('sort', c === 'done' ? 'updated' : 'position'); p.set('limit', '100'); return p; });
  const q0 = useTaskList('k0', qs[0]); const q1 = useTaskList('k1', qs[1]); const q2 = useTaskList('k2', qs[2]); const q3 = useTaskList('k3', qs[3]);
  const data = [q0, q1, q2, q3].map((q) => q.data?.pages.flatMap((x) => x.items) ?? []);
  const [over, setOver] = useState<string | null>(null);
  // Drop on a card = put before it; on the column = at the end
  const drop = async (id: string, to: TaskStatus, before?: Task) => {
    const list = data[cols.indexOf(to)].filter((x) => x.id !== id);
    let position: number;
    if (before) { const i = list.findIndex((x) => x.id === before.id); const prev = list[i - 1]; position = prev ? (prev.position + before.position) / 2 : before.position - 1; }
    else position = (list.at(-1)?.position ?? 0) + 1;
    await api(`/tasks/${id}/status`, { method: 'PATCH', json: { status: to, position } }).catch(() => {});
    refresh();
  };
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0">
      {cols.map((c, i) => (
        <section key={c} onDragOver={(e) => { e.preventDefault(); setOver(c); }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/task'); if (id) drop(id, c); }}
          className={clsx('flex w-[80vw] shrink-0 snap-start flex-col rounded-2xl bg-surface-2 p-2 sm:w-auto', over === c && 'ring-2 ring-primary')}>
          <header className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold">{t(`st_${c}`)}<span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{data[i].length}</span></header>
          <div className="min-h-24 space-y-2">
            {data[i].map((x) => (
              <article key={x.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', x.id)} onClick={() => onOpen(x.id)}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(null); const id = e.dataTransfer.getData('text/task'); if (id && id !== x.id) drop(id, c, x); }}
                className="card cursor-pointer space-y-1.5 p-3 hover:shadow-md">
                <div className={clsx('text-sm font-medium', c === 'done' && 'text-muted line-through')}>{x.priority === 1 && <Flag size={12} className="mr-1 inline fill-danger text-danger" />}{x.title}</div>
                {x.customer_name && <div className="truncate text-xs text-muted">{x.customer_name}</div>}
                {x.checklist_total > 0 && <div className="h-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-success" style={{ width: `${(x.checklist_done / x.checklist_total) * 100}%` }} /></div>}
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span className={clsx(x.overdue && 'font-semibold text-danger')}>{x.due_at ? new Date(x.due_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : ''}</span>
                  <span className="truncate">{x.owner_name}</span>
                </div>
              </article>
            ))}
            {!data[i].length && <p className="px-2 py-6 text-center text-xs text-muted">{tc('dropHere')}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

function MonthView({ base, onOpen, onNew }: { base: URLSearchParams; onOpen: (id: string) => void; onNew: () => void }) {
  const t = useTranslations('tasks');
  const locale = useLocale();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 42);
  const p = new URLSearchParams(base); p.set('status', 'any'); p.set('due', 'range'); p.set('from', start.toISOString()); p.set('to', end.toISOString()); p.set('limit', '300');
  const q = useQuery({ queryKey: ['tasks', 'month', p.toString()], queryFn: () => api<{ items: Task[] }>(`/tasks?${p}`) });
  const byDay = new Map<string, Task[]>();
  for (const x of q.data?.items ?? []) { const k = new Date(x.due_at!).toDateString(); byDay.set(k, [...(byDay.get(k) ?? []), x]); }
  const today = new Date().toDateString();
  return (
    <div className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2" aria-label="prev"><ChevronLeft size={18} /></button>
        <span className="flex-1 text-center font-semibold capitalize">{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2" aria-label="next"><ChevronRight size={18} /></button>
        <button onClick={onNew} className="grid h-8 w-8 place-items-center rounded-lg text-primary hover:bg-surface-2" aria-label={t('new')}><Plus size={18} /></button>
      </header>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted">
        {Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' })).map((w) => <div key={w} className="py-1.5">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 border-t border-border">
        {Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; }).map((d) => {
          const list = byDay.get(d.toDateString()) ?? [];
          return (
            <div key={d.toISOString()} className={clsx('min-h-20 border-b border-r border-border p-1 sm:min-h-24', d.getMonth() !== month.getMonth() && 'bg-surface-2/50')}>
              <div className={clsx('mb-0.5 text-right text-xs', d.toDateString() === today ? 'font-bold text-primary' : 'text-muted')}>{d.getDate()}</div>
              {list.slice(0, 3).map((x) => (
                <button key={x.id} onClick={() => onOpen(x.id)} className={clsx('mb-0.5 block w-full truncate rounded px-1 text-left text-[11px]',
                  x.status === 'done' ? 'bg-success-soft text-success line-through' : x.overdue ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary')}>{x.title}</button>
              ))}
              {list.length > 3 && <div className="text-[10px] text-muted">+{list.length - 3}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TasksPage() {
  return <Suspense><TasksInner /></Suspense>;
}
