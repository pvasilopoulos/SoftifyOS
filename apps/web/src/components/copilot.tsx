'use client';
// Copilot: a side panel (full screen on phones) that answers from the organisation's data with the user's own
// permissions and proposes changes as cards to confirm. Opened with the ✨ button or Ctrl/⌘+J; other screens open it
// with a prepared prompt (useCopilot().open({ prompt, send })).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUp, History, Loader2, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { aiErrorKey, streamChat, useAiStatus, type AiAction } from '@/lib/ai';
import { usePathname } from '@/i18n/navigation';
import { ActionCard, Markdown, MicButton, useDictation } from './ai-ui';

type Item = { key: string; role: 'user' | 'assistant'; text: string; tools: string[]; actions: AiAction[]; error?: string; streaming?: boolean };
type OpenOpts = { prompt?: string; send?: boolean };
const Ctx = createContext<{ open: (o?: OpenOpts) => void; close: () => void; isOpen: boolean } | null>(null);
export const useCopilot = () => useContext(Ctx);

/** Where the user is, so "this customer" means something. */
function usePage() {
  const path = usePathname();
  return useMemo(() => {
    const m = /^\/(customers|offers)\/([0-9a-f-]{36})/.exec(path);
    if (m) return { kind: m[1] === 'customers' ? 'customer' : 'offer', id: m[2] };
    const k = /^\/(customers|offers|tasks|crm|reports|documents|calendar)/.exec(path)?.[1];
    return k ? { kind: `${k} page` } : null;
  }, [path]);
}
const uuidTime = (id: string) => parseInt(id.replace(/-/g, '').slice(0, 12), 16);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [pending, setPending] = useState<OpenOpts | null>(null);
  const status = useAiStatus();
  const open = useCallback((o?: OpenOpts) => { setOpen(true); if (o) setPending(o); }, []);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen((x) => !x); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {isOpen && status.data && <CopilotPanel pending={pending} clearPending={() => setPending(null)} onClose={close} />}
    </Ctx.Provider>
  );
}

/** ✨ button (sidebar / top bar). Hidden when the user's role has no AI. */
export function CopilotButton({ variant }: { variant: 'dark' | 'light' }) {
  const t = useTranslations('ai');
  const c = useCopilot();
  const { data } = useAiStatus();
  if (!c || !data?.allowed) return null;
  return variant === 'dark' ? (
    <button type="button" onClick={() => c.open()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/5 hover:text-white">
      <Sparkles size={19} /> {t('copilot')} <kbd className="ml-auto rounded bg-white/10 px-1.5 text-[10px] text-white/60">Ctrl J</kbd>
    </button>
  ) : (
    <button type="button" onClick={() => c.open()} aria-label={t('copilot')} className="grid h-10 w-10 place-items-center rounded-full text-primary"><Sparkles size={21} /></button>
  );
}

function CopilotPanel({ pending, clearPending, onClose }: { pending: OpenOpts | null; clearPending: () => void; onClose: () => void }) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const qc = useQueryClient();
  const page = usePage();
  const { data: status } = useAiStatus();
  const [conv, setConv] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dict = useDictation((x) => setInput((v) => (v ? `${v} ${x}` : x)));
  const blocked = !status?.features.copilot ? (!status?.configured ? 'ai_not_configured' : !status.allowed ? 'forbidden' : !status.enabled ? 'ai_disabled' : !status.budget_left ? 'budget_exceeded' : 'feature_disabled') : null;

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [items, toolLabel]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const patchLast = (f: (it: Item) => Item) => setItems((xs) => xs.map((x, i) => (i === xs.length - 1 ? f(x) : x)));
  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput(''); setBusy(true);
    setItems((xs) => [...xs, { key: `u${Date.now()}`, role: 'user', text: msg, tools: [], actions: [] }, { key: `a${Date.now()}`, role: 'assistant', text: '', tools: [], actions: [], streaming: true }]);
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      await streamChat({ conversation_id: conv, message: msg, page, locale }, (e) => {
        if (e.type === 'start') setConv(e.conversation_id);
        else if (e.type === 'text') { setToolLabel(null); patchLast((it) => ({ ...it, text: it.text + e.delta })); }
        else if (e.type === 'tool') { setToolLabel(e.label); patchLast((it) => ({ ...it, tools: [...it.tools, e.label] })); }
        else if (e.type === 'action') patchLast((it) => ({ ...it, actions: [...it.actions, e.action] }));
        else if (e.type === 'error') patchLast((it) => ({ ...it, error: e.error }));
      }, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) patchLast((it) => ({ ...it, error: (e as { code?: string }).code ?? 'error' }));
    }
    patchLast((it) => ({ ...it, streaming: false }));
    setToolLabel(null); setBusy(false);
    qc.invalidateQueries({ queryKey: ['ai-conversations'] });
  }, [busy, conv, page, locale, qc]);

  // Opened from another screen with a prepared prompt
  useEffect(() => {
    if (!pending?.prompt) return;
    if (pending.send) { setConv(null); setItems([]); setTimeout(() => send(pending.prompt!), 0); } else setInput(pending.prompt);
    clearPending();
  }, [pending, clearPending, send]);

  const load = async (id: string) => {
    const d = await api<{ items: { id: string; role: 'user' | 'assistant'; text: string; tools?: string[] }[]; actions: (AiAction & { created_at: string })[] }>(`/ai/conversations/${id}`);
    // Each proposal goes under the answer to the question that produced it
    const users = d.items.filter((x) => x.role === 'user').map((x) => uuidTime(x.id));
    const out: Item[] = d.items.map((x) => ({ key: x.id, role: x.role, text: x.text, tools: x.tools ?? [], actions: [] }));
    for (const a of d.actions) {
      const ts = new Date(a.created_at).getTime();
      const u = users.filter((x) => x <= ts).length; // after the u-th user message
      let seen = 0;
      const target = out.findIndex((x) => (x.role === 'user' ? (++seen, false) : seen === u));
      (out[target >= 0 ? target : out.length - 1] ?? out[0])?.actions.push(a);
    }
    setConv(id); setItems(out); setShowHistory(false);
  };
  const reset = () => { abort.current?.abort(); setConv(null); setItems([]); setShowHistory(false); inputRef.current?.focus(); };
  const suggestions = page?.kind === 'customer' ? [t('sg_customer1'), t('sg_customer2'), t('sg_customer3')] : [t('sg1'), t('sg2'), t('sg3'), t('sg4')];

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30 lg:hidden" onClick={onClose} />
      <aside role="dialog" aria-label={t('copilot')}
        className="fixed inset-x-0 bottom-0 top-0 z-[61] flex flex-col bg-surface shadow-2xl safe-top lg:left-auto lg:w-[440px] lg:border-l lg:border-border">
        <header className="flex items-center gap-1 border-b border-border px-3 py-2.5">
          <Sparkles size={18} className="text-primary" />
          <h2 className="flex-1 font-semibold">{t('copilot')}</h2>
          <button type="button" onClick={() => setShowHistory(!showHistory)} title={t('history_')} aria-label={t('history_')} aria-pressed={showHistory} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2"><History size={17} /></button>
          <button type="button" onClick={reset} title={t('newChat')} aria-label={t('newChat')} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2"><Plus size={18} /></button>
          <button type="button" onClick={onClose} aria-label={t('close')} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2"><X size={18} /></button>
        </header>

        {showHistory ? <Conversations onPick={load} current={conv} /> : (
          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
            {blocked && <div className="rounded-2xl bg-warning-soft p-3 text-sm text-warning">{t(aiErrorKey(blocked) as never)}</div>}
            {!items.length && !blocked && (
              <div className="pt-6 text-center">
                <Sparkles size={28} className="mx-auto text-primary" />
                <p className="mt-2 font-semibold">{t('welcome')}</p>
                <p className="mt-1 text-sm text-muted">{t('welcomeHint')}</p>
                <div className="mt-4 flex flex-col gap-2">
                  {suggestions.map((s) => <button key={s} type="button" onClick={() => send(s)} className="rounded-xl border border-border px-3 py-2 text-left text-sm hover:border-primary/50 hover:bg-primary-soft/40">{s}</button>)}
                </div>
              </div>
            )}
            {items.map((it) => it.role === 'user' ? (
              <div key={it.key} className="ml-8 rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-white whitespace-pre-wrap">{it.text}</div>
            ) : (
              <div key={it.key} className="mr-4 space-y-2">
                {it.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {[...new Set(it.tools)].map((x) => <span key={x} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{x}</span>)}
                  </div>
                )}
                {it.text && <Markdown text={it.text} />}
                {it.streaming && !it.text && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> {toolLabel ?? t('thinking')}…</div>}
                {it.streaming && it.text && toolLabel && <div className="flex items-center gap-2 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> {toolLabel}…</div>}
                {it.actions.map((a) => <ActionCard key={a.id} action={a} />)}
                {it.error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{t(aiErrorKey(it.error) as never)}</p>}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-border p-3 sheet-pb">
          {dict.interim && <p className="mb-1 truncate text-xs italic text-muted">{dict.interim}</p>}
          <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-surface-2 p-1.5 focus-within:border-primary">
            <textarea ref={inputRef} rows={1} value={input} disabled={!!blocked} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder={t('placeholder')} aria-label={t('placeholder')}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none [field-sizing:content]" />
            {!blocked && <MicButton d={dict} />}
            {busy ? (
              <button type="button" onClick={() => abort.current?.abort()} aria-label={t('stop')} className="grid h-10 w-10 place-items-center rounded-xl bg-text text-bg"><Square size={14} /></button>
            ) : (
              <button type="submit" disabled={!input.trim() || !!blocked} aria-label={t('send')} className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-white disabled:opacity-40"><ArrowUp size={18} /></button>
            )}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted">{t('disclaimer')}</p>
        </form>
      </aside>
    </>
  );
}

function Conversations({ onPick, current }: { onPick: (id: string) => void; current: string | null }) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai-conversations'], queryFn: () => api<{ id: string; title: string; updated_at: string }[]>('/ai/conversations') });
  if (!q.data) return <div className="flex-1 p-6"><Loader2 className="mx-auto animate-spin text-muted" /></div>;
  if (!q.data.length) return <p className="flex-1 p-6 text-center text-sm text-muted">{t('noHistory')}</p>;
  return (
    <ul className="flex-1 divide-y divide-border overflow-y-auto">
      {q.data.map((c) => (
        <li key={c.id} className={clsx('flex items-center gap-2 px-4 py-3', c.id === current && 'bg-primary-soft/40')}>
          <button type="button" onClick={() => onPick(c.id)} className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium">{c.title || '—'}</div>
            <div className="text-xs text-muted">{new Date(c.updated_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </button>
          <button type="button" aria-label={t('deleteChat')} onClick={async () => { await api(`/ai/conversations/${c.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['ai-conversations'] }); }}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"><Trash2 size={14} /></button>
        </li>
      ))}
    </ul>
  );
}
