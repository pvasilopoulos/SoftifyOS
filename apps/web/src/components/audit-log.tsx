'use client';
// Settings → Change history: search, filters (who / area / action / dates), numbered pages, details, CSV export.
import { Fragment, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Bot, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, Search, ShieldCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { date, time } from '@/lib/format';
import { Avatar } from './ui';
import { useMe } from './app-shell';
import { canDo } from './roles-settings';

type AuditRow = { id: string; action: string; entity: string | null; details: unknown; created_at: string; actor_id: string | null; actor_name: string | null; actor_email: string | null };
type AuditPage = { items: AuditRow[]; total: number; page: number; page_size: number; pages: number };
type Facets = { actors: { id: string | null; name: string; n: number }[]; categories: { key: string; n: number }[]; actions: { key: string; n: number }[] };

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary';

export function AuditSection() {
  const t = useTranslations('settings.audit');
  const ts = useTranslations('settings');
  const locale = useLocale();
  const { data: me } = useMe();
  const allowed = canDo(me, 'audit.view');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [actor, setActor] = useState('');
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  useEffect(() => setPage(1), [dq, actor, category, action, from, to, size]);

  const params = new URLSearchParams({ page: String(page), page_size: String(size) });
  if (dq) params.set('q', dq);
  if (actor) params.set('actor', actor);
  if (category) params.set('category', category);
  if (action) params.set('action', action);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const exportParams = new URLSearchParams(params); exportParams.delete('page'); exportParams.delete('page_size');

  const facets = useQuery({ queryKey: ['settings', 'audit-facets'], enabled: allowed, staleTime: 60_000, queryFn: () => api<Facets>('/settings/audit/facets') });
  const list = useQuery({
    queryKey: ['settings', 'audit', params.toString()], enabled: allowed, placeholderData: keepPreviousData,
    queryFn: () => api<AuditPage>(`/settings/audit?${params}`),
  });

  const actionLabel = (a: string) => (t.has(`actions.${a.replaceAll('.', '_')}`) ? t(`actions.${a.replaceAll('.', '_')}` as never) : a);
  const catLabel = (c: string) => (t.has(`cat_${c}`) ? t(`cat_${c}` as never) : c);
  const actions = (facets.data?.actions ?? []).filter((a) => !category || a.key.split('.')[0] === category);
  const filtersOn = !!(q || actor || category || action || from || to);
  const clear = () => { setQ(''); setActor(''); setCategory(''); setAction(''); setFrom(''); setTo(''); };

  // Group the page's rows by day
  const days = useMemo(() => {
    const out: { day: string; rows: AuditRow[] }[] = [];
    for (const r of list.data?.items ?? []) {
      const d = new Date(r.created_at).toLocaleDateString('sv'); // local YYYY-MM-DD (not UTC)
      if (out.at(-1)?.day !== d) out.push({ day: d, rows: [] });
      out.at(-1)!.rows.push(r);
    }
    return out;
  }, [list.data]);

  if (!allowed) return <div className="flex items-center gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info"><ShieldCheck size={16} /> {ts('adminOnly')}</div>;
  const d = list.data;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="card space-y-2 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')} className={clsx(input, 'pl-9')} />
          </label>
          <a href={`/api/settings/audit/export.csv?${exportParams}`} className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-sm font-medium hover:bg-surface-2">
            <Download size={16} /> {t('export')}
          </a>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label={t('actor')} className={input}>
            <option value="">{t('allActors')}</option>
            {facets.data?.actors.map((a) => <option key={a.id ?? 'api'} value={a.id ?? 'api'}>{a.id ? a.name : t('apiActor')} ({a.n})</option>)}
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setAction(''); }} aria-label={t('category')} className={input}>
            <option value="">{t('allCategories')}</option>
            {facets.data?.categories.map((c) => <option key={c.key} value={c.key}>{catLabel(c.key)} ({c.n})</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label={t('action')} className={input}>
            <option value="">{t('allActions')}</option>
            {actions.map((a) => <option key={a.key} value={a.key}>{actionLabel(a.key)} ({a.n})</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">{t('from')}
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={clsx(input, 'w-auto py-2')} /></label>
          <label className="flex items-center gap-2 text-sm text-muted">{t('to')}
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={clsx(input, 'w-auto py-2')} /></label>
          {filtersOn && <button onClick={clear} className="ml-auto flex items-center gap-1 text-sm font-medium text-primary"><X size={14} /> {t('clear')}</button>}
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-sm text-muted">
        <span>{d ? t('results', { count: d.total }) : '…'}</span>
        {list.isFetching && <Loader2 size={15} className="animate-spin" />}
      </div>

      {/* Rows grouped by day; a row expands to its details */}
      {d && d.items.length === 0 ? <div className="card p-8 text-center text-sm text-muted">{filtersOn ? t('noMatch') : t('empty')}</div> : (
        <div className="space-y-3">
          {days.map((g) => (
            <section key={g.day}>
              <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{date(`${g.day}T12:00:00`, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <ul className="card divide-y divide-border">
                {g.rows.map((a) => (
                  <Fragment key={a.id}>
                    <li>
                      <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}
                        className="flex w-full items-start gap-3 p-3.5 text-left transition hover:bg-surface-2">
                        {a.actor_id ? <Avatar name={a.actor_name} size={34} />
                          : <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-info-soft text-info"><Bot size={17} /></span>}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">
                            <span className="font-semibold">{a.actor_id ? a.actor_name : t('apiActor')}</span>
                            <span className="text-muted"> · </span>{actionLabel(a.action)}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <span className="rounded-full bg-surface-2 px-2 py-0.5">{catLabel(a.action.split('.')[0])}</span>
                            {a.entity && <span className="truncate">{a.entity}</span>}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs tabular text-muted">{time(a.created_at, locale)}</span>
                        <ChevronDown size={16} className={clsx('mt-0.5 shrink-0 text-muted transition', open === a.id && 'rotate-180')} />
                      </button>
                    </li>
                    {open === a.id && (
                      <li className="bg-surface-2/50 px-4 py-3">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                          <dt className="text-muted">{t('when')}</dt><dd>{date(a.created_at, locale)} {time(a.created_at, locale)}</dd>
                          <dt className="text-muted">{t('actor')}</dt><dd className="break-all">{a.actor_id ? `${a.actor_name} (${a.actor_email})` : t('apiActor')}</dd>
                          <dt className="text-muted">{t('action')}</dt><dd><code className="text-xs">{a.action}</code></dd>
                          {a.entity && <><dt className="text-muted">{t('entity')}</dt><dd className="break-words">{a.entity}</dd></>}
                        </dl>
                        {a.details != null && <Details value={a.details} />}
                      </li>
                    )}
                  </Fragment>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Pagination */}
      {d && d.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">{t('perPage')}
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} className={clsx(input, 'w-auto py-1.5')}>
              {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <Pager page={d.page} pages={d.pages} onPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
        </div>
      )}
    </div>
  );
}

/** details JSON as a readable key → value list (nested values as JSON). */
function Details({ value }: { value: unknown }) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
  }
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-surface p-3 text-xs">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <Fragment key={k}>
          <dt className="font-mono text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{typeof v === 'object' && v !== null ? <code>{JSON.stringify(v)}</code> : String(v ?? '—')}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const t = useTranslations('settings.audit');
  // 1 … 4 5 [6] 7 8 … 20
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btn = 'grid h-9 min-w-9 place-items-center rounded-xl border px-2 text-sm tabular disabled:opacity-40';
  return (
    <nav aria-label={t('pages')} className="flex items-center gap-1">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('prev')} className={clsx(btn, 'border-border')}><ChevronLeft size={16} /></button>
      {nums.map((n, i) => (
        <Fragment key={n}>
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-muted">…</span>}
          <button onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}
            className={clsx(btn, n === page ? 'border-primary bg-primary text-white' : 'border-border hover:bg-surface-2')}>{n}</button>
        </Fragment>
      ))}
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('next')} className={clsx(btn, 'border-border')}><ChevronRight size={16} /></button>
    </nav>
  );
}
