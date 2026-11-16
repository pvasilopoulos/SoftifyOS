'use client';
// Select with "smart" search: accent/case-insensitive, matches every word, best matches first, keyboard friendly.
// The list opens inline (below the field), so it also works inside popovers and bottom sheets.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { matchRank } from '@/lib/search';

export type SelectOption = { value: string; label: string; hint?: string };

// Matching: accents, case and greeklish are handled by matchRank (lib/search)
export function SearchSelect({ value, options, onChange, allLabel, placeholder, ariaLabel, className }: {
  value: string; options: SelectOption[]; onChange: (v: string) => void;
  allLabel: string; placeholder: string; ariaLabel?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const fq = q.trim();
    const all = [{ value: '', label: allLabel }, ...options];
    if (!fq) return all;
    return options
      .map((o, i) => ({ o, i, r: matchRank(o.label, fq) }))
      .filter((x) => x.r !== null)
      .sort((a, b) => a.r! - b.r! || a.i - b.i)
      .map((x) => x.o);
  }, [q, options, allLabel]);

  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => { listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const pick = (v: string) => { onChange(v); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active].value); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox" aria-label={ariaLabel}
        className={clsx('flex w-full items-center gap-2 rounded-xl border bg-surface-2 px-3 py-2.5 text-left text-sm outline-none transition',
          open ? 'border-primary' : 'border-border', value && 'font-medium text-primary')}>
        <span className="min-w-0 flex-1 truncate">{current?.label ?? (value || allLabel)}</span>
        {value && (
          <span role="button" tabIndex={-1} aria-label="clear" onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="grid h-5 w-5 place-items-center rounded text-muted hover:text-text"><X size={14} /></span>
        )}
        <ChevronDown size={16} className={clsx('shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <label className="flex items-center gap-2 border-b border-border px-3">
            <Search size={15} className="shrink-0 text-muted" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={placeholder}
              className="w-full min-w-0 bg-transparent py-2.5 text-sm outline-none" aria-label={placeholder} />
            {q && <button type="button" onClick={() => setQ('')} aria-label="clear" className="text-muted"><X size={14} /></button>}
          </label>
          <ul ref={listRef} role="listbox" className="max-h-56 overflow-auto py-1">
            {shown.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">—</li>}
            {shown.map((o, i) => (
              <li key={o.value || '__all'} role="option" aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}
                className={clsx('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', i === active && 'bg-surface-2', !o.value && 'text-muted')}>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs tabular text-muted">{o.hint}</span>}
                {o.value === value && <Check size={15} className="shrink-0 text-primary" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
