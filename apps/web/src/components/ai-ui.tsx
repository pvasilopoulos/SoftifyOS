'use client';
import { RequestMore } from './ai-usage';
// Shared AI UI: safe markdown (no HTML), action cards (confirm / cancel proposed changes), dictation (Web Speech API).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { BarChart3, CalendarClock, Check, CheckSquare, ExternalLink, FileText, Loader2, Mic, MicOff, Pencil, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { aiErrorKey, type AiAction } from '@/lib/ai';
import { Link } from '@/i18n/navigation';

// ============================================================ markdown (subset, rendered as React nodes)
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>);
    else if (m[4]) out.push(<code key={k} className="rounded bg-surface-2 px-1 text-[0.9em]">{m[4]}</code>);
    else if (m[5]) {
      const href = m[6];
      out.push(href.startsWith('/')
        ? <Link key={k} href={href} className="font-medium text-primary hover:underline">{m[5]}</Link>
        : /^https?:\/\//.test(href) ? <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{m[5]}</a> : m[5]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? 'ol' : 'ul';
    blocks.push(<L key={`l${blocks.length}`} className={clsx('my-1 space-y-0.5 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}>{list.items.map((x, i) => <li key={i}>{inline(x, `li${blocks.length}-${i}`)}</li>)}</L>);
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line), h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
      return;
    }
    flush();
    if (!line.trim()) return;
    if (h) blocks.push(<div key={i} className="mt-2 font-semibold">{inline(h[2], `h${i}`)}</div>);
    else blocks.push(<p key={i} className="my-1">{inline(line, `p${i}`)}</p>);
  });
  flush();
  return <div className={clsx('text-sm leading-relaxed [&>*:first-child]:mt-0', className)}>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}

// ============================================================ action card
const ICON = { task: CheckSquare, activity: CalendarClock, offer_draft: FileText, save_report: BarChart3 };
const hrefOf = (a: AiAction) => {
  const id = (a.result as { id?: string } | null | undefined)?.id;
  if (!id) return null;
  return a.kind === 'task' ? `/tasks?open=${id}` : a.kind === 'activity' ? `/crm?open=${id}` : a.kind === 'offer_draft' ? `/offers/${id}` : `/reports?saved=${id}`;
};

export function ActionCard({ action, onChange }: { action: AiAction; onChange?: (a: AiAction) => void }) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const qc = useQueryClient();
  const [a, setA] = useState(action);
  useEffect(() => setA(action), [action]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const p = a.payload;
  const titleKey = a.kind === 'task' ? 'title' : a.kind === 'activity' ? 'subject' : a.kind === 'save_report' ? 'name' : null;
  const [title, setTitle] = useState(String((titleKey && p[titleKey]) ?? ''));
  const [due, setDue] = useState(String(p.due_at ?? '').slice(0, 16));
  const Icon = ICON[a.kind];
  const update = (x: AiAction) => { setA(x); onChange?.(x); };

  const decide = async (decision: 'confirm' | 'cancel') => {
    setBusy(true); setErr(null);
    try {
      const edits = edit && titleKey ? { payload: { [titleKey]: title, ...(a.kind !== 'save_report' ? { due_at: due || null } : {}) } } : {};
      const r = await api<{ status: AiAction['status']; result?: Record<string, unknown> }>(`/ai/actions/${a.id}/${decision}`, { method: 'POST', json: edits });
      update({ ...a, status: r.status, result: r.result ?? null, payload: { ...p, ...(edits.payload ?? {}) } });
      setEdit(false);
      if (decision === 'confirm') ['tasks', 'crm', 'offers', 'reports', 'customer'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code === 'validation' ? t('err_validation') : e.code === 'forbidden' ? t('err_forbidden') : e.code === 'not_pending' ? t('err_not_pending') : e.code) : t('err_generic'));
    }
    setBusy(false);
  };

  const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString(locale, { dateStyle: 'medium', ...(String(v).length > 10 ? { timeStyle: 'short' } : {}) }) : null);
  const details: string[] = [];
  if (a.kind === 'task' || a.kind === 'activity') { const w = when(p.due_at); if (w) details.push(w); }
  if (a.kind === 'activity') details.push(t(p.status === 'done' ? 'actDone' : 'actPlanned'));
  if (a.kind === 'offer_draft') details.push(t('offerLines', { n: (p.items as unknown[]).length }), Number(a.summary.net ?? 0).toLocaleString(locale, { style: 'currency', currency: 'EUR' }));
  if (a.summary.assignee) details.push(String(a.summary.assignee));
  const href = hrefOf(a);

  return (
    <div className={clsx('rounded-2xl border p-3 text-sm', a.status === 'pending' ? 'border-primary/40 bg-primary-soft/40' : 'border-border bg-surface')}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface text-primary"><Icon size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t(`k_${a.kind}`)}</div>
          {edit && titleKey ? (
            <div className="mt-1 space-y-1.5">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 outline-none focus:border-primary" aria-label={t('title_')} />
              {a.kind !== 'save_report' && <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 outline-none focus:border-primary" aria-label={t('due')} />}
            </div>
          ) : (
            <div className="font-semibold">{titleKey ? String(p[titleKey] ?? '') : t('offerFor')}</div>
          )}
          {!edit && details.length > 0 && <div className="mt-0.5 text-xs text-muted">{details.join(' · ')}</div>}
          {!edit && typeof p.body === 'string' && p.body && <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-muted">{p.body}</p>}
          {!edit && typeof p.description === 'string' && p.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</p>}
          {a.kind === 'offer_draft' && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {(p.items as { description: string; quantity: number; unit_price: number }[]).slice(0, 5).map((x, i) => <li key={i} className="truncate">{x.quantity} × {x.description} — {x.unit_price}</li>)}
            </ul>
          )}
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        {a.status === 'pending' ? (
          <>
            {titleKey && <button type="button" onClick={() => setEdit(!edit)} className="mr-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:text-text"><Pencil size={12} /> {t('edit')}</button>}
            <button type="button" disabled={busy} onClick={() => decide('cancel')} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium"><X size={13} /> {t('cancel')}</button>
            <button type="button" disabled={busy} onClick={() => decide('confirm')} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t('confirm')}
            </button>
          </>
        ) : (
          <span className={clsx('flex items-center gap-1 text-xs font-medium', a.status === 'done' ? 'text-success' : a.status === 'failed' ? 'text-danger' : 'text-muted')}>
            {a.status === 'done' ? <Check size={13} /> : <X size={13} />} {t(`st_${a.status}`)}
            {href && <Link href={href} className="ml-2 flex items-center gap-1 text-primary hover:underline">{t('open')} <ExternalLink size={11} /></Link>}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================ dictation
type SR = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SRClass = () => (typeof window === 'undefined' ? null : ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition ?? null));

/** Speech-to-text in the browser (Chrome, Edge, Safari, Android). Appends final text through onText. */
export function useDictation(onText: (text: string) => void) {
  const locale = useLocale();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SR | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const supported = typeof window !== 'undefined' && !!SRClass();
  const stop = () => { rec.current?.stop(); };
  const start = () => {
    const C = SRClass();
    if (!C) return;
    setError(null);
    const r = new C();
    r.lang = locale === 'el' ? 'el-GR' : 'en-US';
    r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else tmp += res[0].transcript;
      }
      setInterim(tmp);
    };
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(e.error); };
    r.onend = () => { setListening(false); setInterim(''); };
    rec.current = r;
    r.start();
    setListening(true);
  };
  useEffect(() => () => rec.current?.abort(), []);
  return { supported, listening, interim, error, start, stop, toggle: () => (listening ? stop() : start()) };
}

export function MicButton({ d, className, size = 18 }: { d: ReturnType<typeof useDictation>; className?: string; size?: number }) {
  const t = useTranslations('ai');
  if (!d.supported) return null;
  return (
    <button type="button" onClick={d.toggle} aria-pressed={d.listening} title={d.listening ? t('micStop') : t('micStart')} aria-label={d.listening ? t('micStop') : t('micStart')}
      className={clsx('grid shrink-0 place-items-center rounded-xl transition', d.listening ? 'animate-pulse bg-danger text-white' : 'text-muted hover:bg-surface-2 hover:text-primary', className ?? 'h-10 w-10')}>
      {d.listening ? <MicOff size={size} /> : <Mic size={size} />}
    </button>
  );
}

/** Shows why an AI feature cannot run (not configured, disabled, budget…). */
export function AiErrorNote({ code }: { code: string }) {
  const t = useTranslations('ai');
  return (
    <div className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
      <p>{t((code.startsWith('err_') ? code : aiErrorKey(code)) as never)}</p>
      {/* Own monthly limit reached: ask an administrator for more right here */}
      {code === 'user_budget_exceeded' && <RequestMore pending={false} compact />}
    </div>
  );
}
