'use client';
// Tasks: types & hooks, task row, task dialog (details, checklist, watchers, comments with @mentions, attachments),
// a panel for customers / offers, and "from template".
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AtSign, Check, CheckCircle2, Circle, Flag, Loader2, MessageSquare, Paperclip, Plus, Send, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { daysFromNow, dueLabel, fromLocalInput, toLocalInput, type Recurrence } from '@/lib/crm';
import { Dialog } from './customer-dialogs';
import { appConfirm } from './confirm';
import { useToast } from './providers';
import { CustomerPicker, RecurrenceEditor } from './crm-editor';
import { DocumentsPanel } from './documents-ui';
import { Avatar } from './ui';

export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'done' | 'cancelled';
export type ChecklistItem = { id: string; text: string; done: boolean };
export type Task = {
  id: string; title: string; description: string | null; status: TaskStatus; priority: 1 | 2 | 3; due_at: string | null;
  owner_id: string | null; owner_name: string | null; created_by: string | null; created_by_name: string | null;
  customer_id: string | null; customer_name: string | null; branch_id: string | null; branch_name: string | null;
  offer_id: string | null; offer_number: string | null; activity_id: string | null; activity_subject: string | null;
  tags: string[]; checklist: ChecklistItem[]; checklist_total: number; checklist_done: number; recurrence: Recurrence | null; series_id: string | null;
  remind_before_min: number | null; completed_at: string | null; position: number; comments_count: number; docs_count: number;
  overdue: boolean; created_at: string; updated_at: string;
};
export type TaskDetail = Task & { watchers: { id: string; full_name: string }[];
  comments: { id: string; body: string; mentions: string[]; created_at: string; user_id: string | null; user_name: string | null }[]; can_edit: boolean };
export type TasksMeta = { users: { id: string; full_name: string }[]; templates: { id: string; name: string; description: string | null; items: { title: string; due_in_days?: number }[] }[];
  tags: string[]; can: { all: boolean; edit: boolean; manage: boolean }; me: string };
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'done', 'cancelled'];

export const useTasksMeta = () => useQuery({ queryKey: ['tasks', 'meta'], queryFn: () => api<TasksMeta>('/tasks/meta'), staleTime: 120_000 });
export function useTasksRefresh() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['docs'] }); };
}
const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none focus:border-primary';
const small = 'mb-1 block text-xs font-medium text-muted';
const uid = () => Math.random().toString(36).slice(2, 10);

/** One task line: done toggle, title, links, checklist / comments / attachments counters, due, owner. */
export function TaskRow({ t: task, onOpen, onToggle, select }: { t: Task; onOpen: () => void; onToggle: () => void; select?: { on: boolean; toggle: () => void } }) {
  const t = useTranslations('tasks');
  const tc = useTranslations('crm');
  const locale = useLocale();
  const done = task.status === 'done';
  return (
    <li className={clsx('flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2/60 sm:px-4', task.status === 'cancelled' && 'opacity-60')}>
      {select && <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--primary)]" checked={select.on} onChange={select.toggle} aria-label={task.title} />}
      <button onClick={onToggle} aria-label={done ? t('reopen') : t('markDone')} className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full transition', done ? 'text-success' : 'text-muted hover:bg-success-soft hover:text-success')}>
        {done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
      </button>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="min-w-0 flex-1">
          <span className={clsx('flex items-center gap-1.5 font-medium', done && 'text-muted line-through decoration-1')}>
            {task.priority === 1 && <Flag size={13} className="shrink-0 fill-danger text-danger" />}
            <span className="truncate">{task.title}</span>
            {task.status === 'in_progress' && <span className="shrink-0 rounded bg-info-soft px-1.5 text-[10px] font-semibold text-info">{t('st_in_progress')}</span>}
            {task.status === 'waiting' && <span className="shrink-0 rounded bg-warning-soft px-1.5 text-[10px] font-semibold text-warning">{t('st_waiting')}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {[task.customer_name, task.offer_number].filter(Boolean).join(' · ')}
            {task.checklist_total > 0 && <span className="tabular">☑ {task.checklist_done}/{task.checklist_total}</span>}
            {task.comments_count > 0 && <span className="flex items-center gap-0.5"><MessageSquare size={11} />{task.comments_count}</span>}
            {task.docs_count > 0 && <span className="flex items-center gap-0.5"><Paperclip size={11} />{task.docs_count}</span>}
            {task.tags.slice(0, 3).map((g) => <span key={g} className="rounded bg-surface-2 px-1">#{g}</span>)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={clsx('block text-xs font-medium tabular', task.overdue ? 'text-danger' : 'text-muted')}>{dueLabel(task.due_at, locale, (k) => tc(`d_${k}`)) || ''}</span>
          {task.owner_name && <span className="block max-w-[8rem] truncate text-[11px] text-muted">{task.owner_name}</span>}
        </span>
      </button>
    </li>
  );
}

/** Quick done / reopen from a row. */
export function useToggleTask() {
  const refresh = useTasksRefresh();
  const toast = useToast();
  const t = useTranslations('tasks');
  return async (task: Task) => {
    try { await api(`/tasks/${task.id}/status`, { method: 'PATCH', json: { status: task.status === 'done' ? 'todo' : 'done' } }); refresh(); }
    catch { toast({ title: t('saveError') }); }
  };
}

type V = {
  title: string; description: string; status: TaskStatus; priority: string; due_at: string; owner_id: string;
  customer: { id: string; name: string } | null; offer_id: string | null; tags: string; checklist: ChecklistItem[]; watchers: string[];
  remind_before_min: string;
};

export function TaskDialog({ id, preset, onClose }: { id?: string; preset?: Partial<{ customer_id: string; customer_name: string; offer_id: string; title: string }>; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['tasks', 'detail', id], enabled: !!id, queryFn: () => api<TaskDetail>(`/tasks/${id}`) });
  if (id && !detail.data) return <Dialog title="…" onClose={onClose} wide><Loader2 className="mx-auto animate-spin text-muted" /></Dialog>;
  return <TaskBody key={id ?? 'new'} task={detail.data} preset={preset} onClose={onClose} />;
}

function TaskBody({ task, preset, onClose }: { task?: TaskDetail; preset?: Partial<{ customer_id: string; customer_name: string; offer_id: string; title: string }>; onClose: () => void }) {
  const t = useTranslations('tasks');
  const tc = useTranslations('crm');
  const toast = useToast();
  const refresh = useTasksRefresh();
  const meta = useTasksMeta();
  const creating = !task;
  const ro = !!task && !task.can_edit;
  const [v, setV] = useState<V>(() => ({
    title: task?.title ?? preset?.title ?? '', description: task?.description ?? '', status: task?.status ?? 'todo', priority: String(task?.priority ?? 2),
    due_at: toLocalInput(task ? task.due_at : daysFromNow(1, 10)), owner_id: task?.owner_id ?? '',
    customer: task?.customer_id ? { id: task.customer_id, name: task.customer_name ?? '' } : preset?.customer_id ? { id: preset.customer_id, name: preset.customer_name ?? '' } : null,
    offer_id: task?.offer_id ?? preset?.offer_id ?? null, tags: (task?.tags ?? []).join(', '), checklist: task?.checklist ?? [],
    watchers: task?.watchers.map((w) => w.id) ?? [], remind_before_min: task?.remind_before_min == null ? '' : String(task.remind_before_min),
  }));
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [newItem, setNewItem] = useState('');
  const [tab, setTab] = useState<'details' | 'comments' | 'files'>('details');
  useEffect(() => { if (meta.data && !v.owner_id) setV((x) => ({ ...x, owner_id: meta.data!.me })); }, [meta.data, v.owner_id]);
  const set = <K extends keyof V>(k: K, val: V[K]) => setV((x) => ({ ...x, [k]: val }));
  const offers = useQuery({ queryKey: ['crm', 'links', v.customer?.id], enabled: !!v.customer, queryFn: () => api<{ offers: { id: string; number: string }[] }>(`/crm/links/${v.customer!.id}`) });

  const body = () => ({
    title: v.title.trim(), description: v.description || null, status: v.status, priority: Number(v.priority), due_at: fromLocalInput(v.due_at),
    owner_id: v.owner_id || null, customer_id: v.customer?.id ?? null, offer_id: v.offer_id, branch_id: null, activity_id: task?.activity_id ?? null,
    tags: v.tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20), checklist: v.checklist, watchers: v.watchers,
    remind_before_min: v.remind_before_min === '' ? null : Number(v.remind_before_min), recurrence: creating ? recurrence : null,
  });
  const save = useMutation({
    mutationFn: async (apply: 'one' | 'following') => {
      if (task) { await api(`/tasks/${task.id}?apply=${apply}`, { method: 'PUT', json: body() }); return task.id; }
      return (await api<{ id: string }>('/tasks', { method: 'POST', json: body() })).id;
    },
    onSuccess: () => { refresh(); toast({ title: t('saved') }); onClose(); },
    onError: (e) => toast({ title: t('saveError'), body: e instanceof ApiError ? e.code : undefined }),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) return;
    const apply = task?.series_id ? ((await appConfirm(tc('applyFollowing'), { confirmLabel: tc('applyFollowingYes') })) ? 'following' : 'one') : 'one';
    save.mutate(apply);
  };
  const remove = async () => {
    if (!task) return;
    const series = task.series_id && (await appConfirm(tc('deleteFollowing'), { danger: true, confirmLabel: tc('deleteFollowingYes') })) ? 'following' : 'one';
    if (series === 'one' && !(await appConfirm(t('deleteConfirm'), { danger: true }))) return;
    await api(`/tasks/${task.id}?series=${series}`, { method: 'DELETE' }); refresh(); onClose();
  };
  // Checklist changes on an existing task are saved right away
  const saveChecklist = async (list: ChecklistItem[]) => {
    set('checklist', list);
    if (task && !ro) { await api(`/tasks/${task.id}/checklist`, { method: 'PATCH', json: { checklist: list } }).catch(() => {}); refresh(); }
  };
  const users = meta.data?.users ?? [];
  const done = v.checklist.filter((x) => x.done).length;

  return (
    <Dialog title={creating ? t('newTitle') : t('editTitle')} onClose={onClose} wide>
      {task && (
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
          {(['details', 'comments', 'files'] as const).map((x) => (
            <button key={x} type="button" onClick={() => setTab(x)} className={clsx('rounded-lg py-1.5 text-sm font-medium', tab === x ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
              {t(`tab_${x}`)}{x === 'comments' && task.comments_count ? ` (${task.comments_count})` : ''}{x === 'files' && task.docs_count ? ` (${task.docs_count})` : ''}
            </button>
          ))}
        </div>
      )}
      {tab === 'comments' && task && <Comments task={task} />}
      {tab === 'files' && task && <DocumentsPanel links={{ task_id: task.id, customer_id: task.customer_id }} />}
      {tab === 'details' && (
        <form onSubmit={submit} className="space-y-3">
          <input autoFocus={creating} className={clsx(input, 'text-base font-semibold')} placeholder={t('titlePh')} maxLength={300} disabled={ro} value={v.title} onChange={(e) => set('title', e.target.value)} />
          <textarea rows={3} className={input} placeholder={t('descriptionPh')} disabled={ro} value={v.description} onChange={(e) => set('description', e.target.value)} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="col-span-2 sm:col-span-1"><span className={small}>{t('status')}</span>
              <select className={input} disabled={ro} value={v.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{t(`st_${s}`)}</option>)}</select></label>
            <label className="col-span-2 sm:col-span-1"><span className={small}>{t('priority')}</span>
              <select className={input} disabled={ro} value={v.priority} onChange={(e) => set('priority', e.target.value)}>{['1', '2', '3'].map((p) => <option key={p} value={p}>{tc(`prio_${p}`)}</option>)}</select></label>
            <label className="col-span-2"><span className={small}>{t('due')}</span>
              <input type="datetime-local" className={input} disabled={ro} value={v.due_at} onChange={(e) => set('due_at', e.target.value)} /></label>
          </div>
          <div className="flex flex-wrap gap-1">
            {[[0, 'today'], [1, 'tomorrow'], [3, 'in3'], [7, 'in7'], [14, 'in14']].map(([n, k]) => (
              <button key={k} type="button" disabled={ro} onClick={() => set('due_at', toLocalInput(daysFromNow(n as number, 10)))} className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-surface-2">{tc(`q_${k}`)}</button>
            ))}
            <button type="button" disabled={ro} onClick={() => set('due_at', '')} className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-surface-2">{t('noDue')}</button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label><span className={small}>{t('owner')}</span>
              <select className={input} disabled={ro} value={v.owner_id} onChange={(e) => set('owner_id', e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
            <label><span className={small}>{t('reminder')}</span>
              <select className={input} disabled={ro} value={v.remind_before_min} onChange={(e) => set('remind_before_min', e.target.value)}>
                {[null, 0, 15, 60, 1440, 2880].map((m) => <option key={String(m)} value={m === null ? '' : String(m)}>{m === null ? tc('noReminder') : m === 0 ? tc('atTime') : m < 60 ? tc('minBefore', { n: m }) : m < 1440 ? tc('hoursBefore', { n: m / 60 }) : tc('daysBefore', { n: m / 1440 })}</option>)}
              </select></label>
            <div><span className={small}>{t('customer')}</span><CustomerPicker value={v.customer} disabled={ro} onChange={(c) => setV((x) => ({ ...x, customer: c, offer_id: null }))} /></div>
            <label><span className={small}>{t('offer')}</span>
              <select className={input} disabled={ro || !v.customer} value={v.offer_id ?? ''} onChange={(e) => set('offer_id', e.target.value || null)}>
                <option value="">{tc('none')}</option>{offers.data?.offers.map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}
              </select></label>
          </div>
          <div><span className={small}>{t('watchers')}</span>
            <div className="flex flex-wrap gap-1.5">
              {users.filter((u) => u.id !== v.owner_id).map((u) => {
                const on = v.watchers.includes(u.id);
                return <button key={u.id} type="button" disabled={ro} aria-pressed={on} onClick={() => set('watchers', on ? v.watchers.filter((x) => x !== u.id) : [...v.watchers, u.id])}
                  className={clsx('flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs', on ? 'border-primary bg-primary-soft text-primary' : 'border-border')}><Avatar name={u.full_name} size={18} />{u.full_name}</button>;
              })}
            </div>
          </div>
          <label className="block"><span className={small}>{t('tags')}</span><input className={input} disabled={ro} placeholder="a, b" value={v.tags} onChange={(e) => set('tags', e.target.value)} list="task-tags" />
            <datalist id="task-tags">{meta.data?.tags.map((g) => <option key={g} value={g} />)}</datalist></label>

          <div className="rounded-2xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-medium">{t('checklist')} {v.checklist.length > 0 && <span className="tabular text-xs text-muted">{done}/{v.checklist.length}</span>}</div>
            {v.checklist.length > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-success" style={{ width: `${(done / v.checklist.length) * 100}%` }} /></div>}
            <ul className="space-y-1">
              {v.checklist.map((it, i) => (
                <li key={it.id} className="group flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--success)]" disabled={ro} checked={it.done}
                    onChange={(e) => saveChecklist(v.checklist.map((x, n) => (n === i ? { ...x, done: e.target.checked } : x)))} />
                  <span className={clsx('flex-1', it.done && 'text-muted line-through')}>{it.text}</span>
                  {!ro && <button type="button" onClick={() => saveChecklist(v.checklist.filter((_, n) => n !== i))} className="hidden text-muted hover:text-danger group-hover:block" aria-label={t('remove')}><X size={14} /></button>}
                </li>
              ))}
            </ul>
            {!ro && (
              <div className="mt-2 flex gap-2">
                <input className={clsx(input, 'py-1.5 text-sm')} placeholder={t('addItem')} value={newItem} onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newItem.trim()) { saveChecklist([...v.checklist, { id: uid(), text: newItem.trim(), done: false }]); setNewItem(''); } } }} />
                <button type="button" onClick={() => { if (newItem.trim()) { saveChecklist([...v.checklist, { id: uid(), text: newItem.trim(), done: false }]); setNewItem(''); } }} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary" aria-label={t('addItem')}><Plus size={16} /></button>
              </div>
            )}
          </div>
          {creating && v.due_at && <RecurrenceEditor value={recurrence} onChange={setRecurrence} />}
          {task && <p className="text-xs text-muted">{t('createdBy', { name: task.created_by_name ?? '—', d: new Date(task.created_at).toLocaleString() })}</p>}
          <div className="flex items-center gap-2 border-t border-border pt-4">
            {task?.can_edit && <button type="button" onClick={remove} className="grid h-10 w-10 place-items-center rounded-xl text-danger hover:bg-danger-soft" aria-label={t('delete')}><Trash2 size={18} /></button>}
            <span className="flex-1" />
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('cancel')}</button>
            {!ro && <button disabled={save.isPending || !v.title.trim()} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}</button>}
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Comments with @mentions: type "@" to pick a colleague (they are notified and start watching). */
function Comments({ task }: { task: TaskDetail }) {
  const t = useTranslations('tasks');
  const locale = useLocale();
  const qc = useQueryClient();
  const meta = useTasksMeta();
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [task.comments.length]);
  const users = (meta.data?.users ?? []).filter((u) => pick !== null && u.full_name.toLowerCase().includes(pick.toLowerCase())).slice(0, 6);
  const onChange = (val: string) => {
    setText(val);
    const m = /@([^\s@]{0,30})$/.exec(val.slice(0, ref.current?.selectionStart ?? val.length));
    setPick(m ? m[1] : null);
  };
  const choose = (u: { id: string; full_name: string }) => {
    setText((x) => x.replace(/@([^\s@]{0,30})$/, `@${u.full_name} `));
    setMentions((m) => (m.some((x) => x.id === u.id) ? m : [...m, { id: u.id, name: u.full_name }]));
    setPick(null); ref.current?.focus();
  };
  const send = useMutation({
    mutationFn: () => api(`/tasks/${task.id}/comments`, { method: 'POST', json: { body: text.trim(), mentions: mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id) } }),
    onSuccess: () => { setText(''); setMentions([]); qc.invalidateQueries({ queryKey: ['tasks'] }); },
  });
  const del = async (cid: string) => { await api(`/tasks/${task.id}/comments/${cid}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['tasks'] }); };
  const render = (body: string) => body.split(/(@[\p{L}\p{N}.\-]+(?: [\p{L}\p{N}.\-]+)?)/u).map((p, i) => (p.startsWith('@') ? <b key={i} className="text-primary">{p}</b> : p));
  return (
    <div className="space-y-3">
      <ul className="max-h-[45dvh] space-y-3 overflow-auto">
        {!task.comments.length && <li className="py-6 text-center text-sm text-muted">{t('noComments')}</li>}
        {task.comments.map((c) => (
          <li key={c.id} className="group flex gap-2.5">
            <Avatar name={c.user_name ?? '?'} size={30} />
            <div className="min-w-0 flex-1 rounded-2xl bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2 text-xs"><b>{c.user_name ?? '—'}</b><span className="text-muted">{new Date(c.created_at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                {(c.user_id === meta.data?.me || meta.data?.can.all) && <button onClick={() => del(c.id)} className="ml-auto hidden text-muted hover:text-danger group-hover:block" aria-label={t('delete')}><Trash2 size={12} /></button>}</div>
              <p className="whitespace-pre-line text-sm">{render(c.body)}</p>
            </div>
          </li>
        ))}
        <div ref={endRef} />
      </ul>
      <div className="relative">
        {pick !== null && users.length > 0 && (
          <ul className="absolute bottom-full z-20 mb-1 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
            {users.map((u) => <li key={u.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); choose(u); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"><Avatar name={u.full_name} size={20} />{u.full_name}</button></li>)}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <textarea ref={ref} rows={2} className={clsx(input, 'resize-none')} placeholder={t('commentPh')} value={text} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) send.mutate(); }} />
          <button type="button" onClick={() => { setText((x) => `${x}@`); setPick(''); ref.current?.focus(); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border" aria-label={t('mention')}><AtSign size={16} /></button>
          <button type="button" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-white disabled:opacity-50" aria-label={t('send')}><Send size={16} /></button>
        </div>
        <p className="mt-1 text-[11px] text-muted">{t('commentHint')}</p>
      </div>
    </div>
  );
}

/** Tasks of a customer / offer, with "new" and "from template". */
export function TasksPanel({ customerId, customerName, offerId }: { customerId?: string; customerName?: string; offerId?: string }) {
  const t = useTranslations('tasks');
  const toggle = useToggleTask();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tpl, setTpl] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const p = new URLSearchParams({ view: 'team', status: showDone ? 'any' : 'open', limit: '100' });
  if (offerId) p.set('offer_id', offerId);
  else if (customerId) p.set('customer_id', customerId);
  const q = useQuery({ queryKey: ['tasks', 'panel', p.toString()], queryFn: () => api<{ items: Task[] }>(`/tasks?${p}`) });
  const items = q.data?.items ?? [];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white"><Plus size={15} /> {t('new')}</button>
        <button onClick={() => setTpl(true)} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium">{t('fromTemplate')}</button>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" className="accent-[var(--primary)]" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {t('showDone')}</label>
      </div>
      {q.isLoading ? <Loader2 className="mx-auto animate-spin text-muted" /> : !items.length ? <p className="py-6 text-center text-sm text-muted">{t('emptyPanel')}</p> : (
        <ul className="card divide-y divide-border overflow-hidden">{items.map((x) => <TaskRow key={x.id} t={x} onOpen={() => setOpen(x.id)} onToggle={() => toggle(x)} />)}</ul>
      )}
      {open && <TaskDialog id={open} onClose={() => setOpen(null)} />}
      {adding && <TaskDialog preset={{ customer_id: customerId, customer_name: customerName, offer_id: offerId }} onClose={() => setAdding(false)} />}
      {tpl && <TemplateDialog customerId={customerId} offerId={offerId} onClose={() => setTpl(false)} />}
    </section>
  );
}

export function TemplateDialog({ customerId, offerId, onClose }: { customerId?: string; offerId?: string; onClose: () => void }) {
  const t = useTranslations('tasks');
  const toast = useToast();
  const refresh = useTasksRefresh();
  const meta = useTasksMeta();
  const [sel, setSel] = useState('');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [owner, setOwner] = useState('');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const tp = useMemo(() => meta.data?.templates.find((x) => x.id === sel), [meta.data, sel]);
  const run = useMutation({
    mutationFn: () => api<{ created: number }>('/tasks/from-template', { method: 'POST', json: { template_id: sel, customer_id: customerId ?? customer?.id ?? null, offer_id: offerId ?? null, owner_id: owner || null, start: new Date(`${start}T10:00`) } }),
    onSuccess: (r) => { toast({ title: t('templateCreated', { n: r.created }) }); refresh(); onClose(); },
    onError: () => toast({ title: t('saveError') }),
  });
  return (
    <Dialog title={t('fromTemplate')} onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-2">
          {meta.data?.templates.map((x) => (
            <button key={x.id} onClick={() => setSel(x.id)} className={clsx('w-full rounded-2xl border p-3 text-left', sel === x.id ? 'border-primary bg-primary-soft/60' : 'border-border hover:bg-surface-2')}>
              <div className="font-medium">{x.name}</div><div className="text-xs text-muted">{x.description ?? ''} · {t('stepsN', { n: x.items.length })}</div>
            </button>
          ))}
          {!meta.data?.templates.length && <p className="text-sm text-muted">{t('noTemplates')}</p>}
        </div>
        {tp && <ol className="list-decimal space-y-0.5 rounded-xl bg-surface-2 p-3 pl-8 text-sm">{tp.items.map((it, i) => <li key={i}>{it.title} <span className="text-xs text-muted">+{it.due_in_days ?? 0} {t('days')}</span></li>)}</ol>}
        {!customerId && <div><span className={small}>{t('customer')}</span><CustomerPicker value={customer} onChange={setCustomer} /></div>}
        <div className="grid grid-cols-2 gap-2">
          <label><span className={small}>{t('start')}</span><input type="date" className={input} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label><span className={small}>{t('owner')}</span><select className={input} value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">{t('me')}</option>{meta.data?.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('cancel')}</button>
          <button disabled={!sel || run.isPending} onClick={() => run.mutate()} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">{run.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('create')}</button>
        </div>
      </div>
    </Dialog>
  );
}

export { useInfiniteQuery };
