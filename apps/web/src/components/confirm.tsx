'use client';
// In-app replacements for window.confirm / window.prompt. The native dialogs are blocked silently in some
// embedded browsers and installed apps (they return "cancel"), which made delete buttons look dead.
//   if (await appConfirm(text, { danger: true })) …     const name = await appPrompt(label, defaultValue)
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

type Request =
  | { kind: 'confirm'; text: string; danger: boolean; confirmLabel?: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; text: string; value: string; resolve: (v: string | null) => void };

let push: ((r: Request) => void) | null = null;

export function appConfirm(text: string, opts: { danger?: boolean; confirmLabel?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) { resolve(window.confirm(text)); return; } // host not mounted (should not happen)
    push({ kind: 'confirm', text, danger: opts.danger ?? true, confirmLabel: opts.confirmLabel, resolve });
  });
}

export function appPrompt(text: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) { resolve(window.prompt(text, value)); return; }
    push({ kind: 'prompt', text, value, resolve });
  });
}

/** Mounted once (Providers): shows the queued confirm / prompt dialogs. */
export function DialogHost() {
  const t = useTranslations('common');
  const [queue, setQueue] = useState<Request[]>([]);
  const [value, setValue] = useState('');
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { push = (r) => setQueue((q) => [...q, r]); return () => { push = null; }; }, []);
  const cur = queue[0];
  useEffect(() => {
    if (!cur) return;
    if (cur.kind === 'prompt') { setValue(cur.value); setTimeout(() => inputRef.current?.select(), 0); }
    else setTimeout(() => okRef.current?.focus(), 0);
  }, [cur]);
  if (!cur) return null;
  const done = (ok: boolean) => {
    if (cur.kind === 'confirm') cur.resolve(ok);
    else cur.resolve(ok ? value.trim() || null : null);
    setQueue((q) => q.slice(1));
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => done(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') done(false); }}>
      <div role="alertdialog" aria-modal onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl bg-surface p-5 shadow-2xl sheet-pb sm:rounded-3xl">
        <form onSubmit={(e) => { e.preventDefault(); done(true); }}>
          <div className="flex items-start gap-3">
            {cur.kind === 'confirm' && cur.danger && (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger-soft text-danger"><AlertTriangle size={19} /></span>
            )}
            <p className="pt-2 text-sm leading-relaxed">{cur.text}</p>
          </div>
          {cur.kind === 'prompt' && (
            <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} maxLength={120}
              className="mt-3 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none focus:border-primary" />
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => done(false)} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('cancel')}</button>
            <button ref={okRef} type="submit" disabled={cur.kind === 'prompt' && !value.trim()}
              className={clsx('rounded-xl px-4 py-2.5 font-semibold text-white disabled:opacity-60', cur.kind === 'confirm' && cur.danger ? 'bg-danger' : 'bg-primary')}>
              {cur.kind === 'confirm' ? cur.confirmLabel ?? t('confirm') : t('ok')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
