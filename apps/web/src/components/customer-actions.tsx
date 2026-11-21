'use client';
// Customer → "Ενέργειες": the customer's CRM activities as in the ERP (code, series, store, requester, handler,
// subject, characterisation, status, start/end, priority), with remarks, editing, ERP sync state and an AI summary.
import { Fragment, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, ChevronDown, Flag, Loader2, MessageSquareText, Pencil, Plus, RefreshCw, Search, Send, Sparkles, Store, Wand2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { iconOf, tone, useCrmMeta, useCrmRefresh, type Activity, type ActivityStatus } from '@/lib/crm';
import { useToast } from './providers';
import { ActivityEditor, CompleteDialog, ErpBadge, type EditorPreset } from './crm-editor';
import { useAi } from '@/lib/ai';
import { AiErrorNote, Markdown } from './ai-ui';

type Filter = 'any' | 'open' | 'done' | 'cancelled';
type Page = { items: Activity[]; next_cursor: string | null };

export function CustomerActions({ customerId, customerName, canEdit }: { customerId: string; customerName: string; canEdit: boolean }) {
  const t = useTranslations('actions');
  const tc = useTranslations('crm');
  const locale = useLocale();
  const toast = useToast();
  const refresh = useCrmRefresh();
  const meta = useCrmMeta();
  const aiOn = useAi('summary');
  const [status, setStatus] = useState<Filter>('any');
  const [type, setType] = useState('');
  const [char, setChar] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: string; preset?: EditorPreset } | null>(null);
  const [complete, setComplete] = useState<Activity | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAi, setShowAi] = useState(false);
  useEffect(() => { const h = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const params = new URLSearchParams({ scope: 'all', status, customer_id: customerId, sort: 'due_desc', limit: '50' });
  if (type) params.set('type', type);
  if (char) params.set('characterization', char);
  if (dq.length >= 2) params.set('q', dq);
  const list = useInfiniteQuery({
    queryKey: ['crm', 'customer-actions', customerId, params.toString()],
    queryFn: ({ pageParam }) => api<Page>(`/crm/activities?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '' as string, getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const erp = meta.data?.erp?.enabled;
  const chars = (meta.data?.erp_values ?? []).filter((x) => x.kind === 'characterization' && x.active);
  const filtered = !!(type || char || dq || status !== 'any');

  const d = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
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

  const sync = async () => {
    setSyncing(true);
    try { await api('/settings/erp/sync', { method: 'POST', json: { what: 'pull' } }); toast({ title: t('syncQueued') }); setTimeout(() => refresh(), 6000); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'not_configured' ? t('syncNotConfigured') : t('syncError') }); }
    setSyncing(false);
  };
  const resend = async (a: Activity) => { await api(`/crm/activities/${a.id}/erp-sync`, { method: 'POST' }); toast({ title: t('resendQueued') }); refresh(); };
  const newActivity = () => setEdit({ preset: { type: meta.data?.types.find((x) => x.active)?.key, customer_id: customerId, customer_name: customerName } });

  const select = 'h-8 rounded-lg border border-border bg-surface pl-2 pr-7 text-sm outline-none focus:border-primary';
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
          {filtered && (
            <button type="button" onClick={() => { setStatus('any'); setType(''); setChar(''); setQ(''); }} className="text-sm font-medium text-primary">{t('clear')}</button>
          )}
          <span className="ml-auto text-xs text-muted tabular">{rows.length > 0 && t('shown', { n: rows.length, more: list.hasNextPage ? '+' : '' })}</span>
        </div>
      </div>

      {showAi && aiOn && <ActionsAi customerId={customerId} onClose={() => setShowAi(false)} />}

      {/* ---------------------------------------------------------------- list */}
      {list.isLoading ? <div className="card py-12 text-center"><Loader2 className="mx-auto animate-spin text-muted" /></div>
        : !rows.length ? (
          <div className="card flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted"><MessageSquareText size={22} /></span>
            <p className="text-sm text-muted">{filtered ? t('emptyFiltered') : t('empty')}</p>
            {canEdit && !filtered && <button type="button" onClick={newActivity} className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"><Plus size={16} /> {t('new')}</button>}
          </div>
        ) : (
          <>
            {/* Wide: table */}
            <div className="card hidden overflow-hidden @3xl:block">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[8.5rem]" /><col className="w-[9.5rem]" /><col /><col className="w-[11rem]" /><col className="w-[10.5rem]" />{erp && <col className="w-14" />}
                </colgroup>
                <thead className="bg-surface-2/60 text-xs text-muted">
                  <tr>
                    {['when', 'series', 'subject', 'handler', 'status'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{t(`h_${h}`)}</th>)}
                    {erp && <th className="px-2 py-2.5 text-center font-medium">ERP</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((a) => {
                    const Icon = iconOf(a.type_icon);
                    const isOpen = open === a.id;
                    return (
                      <Fragment key={a.id}>
                        <tr onClick={() => setOpen(isOpen ? null : a.id)} aria-expanded={isOpen}
                          className={clsx('group cursor-pointer align-top transition-colors', isOpen ? 'bg-primary-soft/40' : 'hover:bg-surface-2/70')}>
                          <td className="px-4 py-3">
                            <div className={clsx('font-semibold tabular', a.overdue && 'text-danger')}>{a.due_at ? d(a.due_at) : d(a.created_at)}</div>
                            <div className="text-xs text-muted tabular">{span(a)}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-lg', tone(a.type_color))}><Icon size={14} /></span>
                              <div className="min-w-0">
                                <div className="truncate font-medium">{a.type_name ?? a.type}</div>
                                {a.erp_code && <div className="truncate font-mono text-[11px] text-muted">{a.erp_code}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-1.5">
                              {a.priority === 1 && <Flag size={13} className="mt-1 shrink-0 fill-danger text-danger" aria-label={tc('prio_1')} />}
                              <span className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">{a.subject}</span>
                            </div>
                            {(a.branch_name || a.body) && (
                              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                                {a.branch_name && <span className="flex shrink-0 items-center gap-1"><Store size={11} /> {a.branch_name}</span>}
                                {a.branch_name && a.body && <span>·</span>}
                                {a.body && <span className="truncate">{a.body}</span>}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="truncate font-medium">{a.owner_name ?? '—'}</div>
                            {a.requested_by_name && a.requested_by !== a.owner_id && <div className="truncate text-xs text-muted">{t('by', { name: a.requested_by_name })}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={clsx('inline-block max-w-full truncate rounded-md px-2 py-0.5 text-xs font-semibold', statusTone(a.status, a.overdue))}>{a.overdue ? tc('overdue') : statusOf(a)}</span>
                            {a.characterization_name && <div className="mt-1 truncate text-xs text-muted">{a.characterization_name}</div>}
                          </td>
                          {erp && <td className="px-2 py-3 text-center">{a.erp_state && <ErpBadge state={a.erp_state} error={a.erp_error} compact />}</td>}
                        </tr>
                        {isOpen && (
                          <tr className="bg-primary-soft/40">
                            <td colSpan={erp ? 6 : 5} className="px-4 pb-4 pt-0">
                              <Details a={a} canEdit={canEdit} onEdit={() => setEdit({ id: a.id })} onComplete={() => setComplete(a)} onResend={() => resend(a)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Narrow: cards */}
            <ul className="space-y-2 @3xl:hidden">
              {rows.map((a) => {
                const Icon = iconOf(a.type_icon);
                const isOpen = open === a.id;
                return (
                  <li key={a.id} className={clsx('card overflow-hidden transition', isOpen && 'border-primary/40')}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : a.id)} aria-expanded={isOpen} className="flex w-full items-start gap-3 p-3.5 text-left">
                      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', tone(a.type_color))}><Icon size={17} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                          <span className={clsx('font-semibold tabular', a.overdue ? 'text-danger' : 'text-text')}>{a.due_at ? d(a.due_at) : d(a.created_at)}</span>
                          <span className="tabular">{span(a)}</span>
                          {a.erp_code && <span className="font-mono">{a.erp_code}</span>}
                        </span>
                        <span className="mt-0.5 flex items-start gap-1.5 font-semibold [overflow-wrap:anywhere]">
                          {a.priority === 1 && <Flag size={13} className="mt-1 shrink-0 fill-danger text-danger" />}{a.subject}
                        </span>
                        {a.body && !isOpen && <span className="mt-0.5 line-clamp-1 text-xs text-muted">{a.body}</span>}
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className={clsx('rounded-md px-2 py-0.5 font-semibold', statusTone(a.status, a.overdue))}>{a.overdue ? tc('overdue') : statusOf(a)}</span>
                          {a.characterization_name && <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium">{a.characterization_name}</span>}
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
  return <div className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="truncate">{v || '—'}</dd></div>;
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
