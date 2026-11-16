'use client';
// Renders a form from its Module Forms configuration: sections (cards, plain or sub-tabs), order, widths,
// captions, help, required marks, read-only and conditional fields. Each form supplies renderers for its own
// fields; custom fields (and anything without a renderer) use the generic inputs below.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, ChevronDown, Loader2, RotateCw } from 'lucide-react';
import {
  defaultsFor, fieldState, l10n, type EffField, type Effective, type EffSection,
} from '@/lib/forms';
import { LookupSelect, NameSelect, type IdList, type NameList } from './lookup-select';

export const formInput = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-70';

export type RenderCtx = {
  field: EffField; id: string; label: string; placeholder: string; required: boolean; readonly: boolean;
  error?: string; invalid: boolean; allowed: string[] | null; className: string;
};
export type Renderer = (c: RenderCtx) => ReactNode;
/** `bare`: the renderer draws its own label (checkbox rows, segmented pickers). */
export type RendererEntry = Renderer | { render: Renderer; bare?: boolean };

const span = { full: 'sm:col-span-6', half: 'sm:col-span-3', third: 'sm:col-span-2' } as const;

export function useErrorText() {
  const t = useTranslations('forms');
  const locale = useLocale();
  return (code: string | undefined, f?: EffField) => {
    if (!code) return undefined;
    if (code === 'pattern' && f && l10n(f.patternMessage, locale)) return l10n(f.patternMessage, locale);
    if (code === 'out_of_range' && f) return t('err_range', { min: f.min ?? '−∞', max: f.max ?? '∞' });
    if (code === 'length' && f) return t('err_length', { min: f.minLength ?? 0, max: f.maxLength ?? '∞' });
    return t.has(`err_${code}`) ? t(`err_${code}` as never) : code;
  };
}

/** Fill the configured defaults once, when creating a record. */
export function useFormDefaults(eff: Effective | undefined, creating: boolean, values: Record<string, unknown>,
  apply: (patch: Record<string, unknown>) => void, ctx: { userId?: string; parent?: Record<string, unknown> | null }) {
  const done = useRef(false);
  useEffect(() => {
    if (!eff || !creating || done.current) return;
    done.current = true;
    const patch = defaultsFor(eff, values, ctx);
    if (Object.keys(patch).length) apply(patch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eff, creating]);
}

export function FormLoading({ error, onRetry }: { error?: boolean; onRetry?: () => void }) {
  const t = useTranslations('forms');
  if (error) {
    return (
      <div className="card flex items-center gap-3 p-4 text-sm text-danger">
        <AlertCircle size={18} /> <span className="flex-1">{t('loadError')}</span>
        {onRetry && <button type="button" onClick={onRetry} className="flex items-center gap-1 font-semibold"><RotateCw size={14} /> {t('retry')}</button>}
      </div>
    );
  }
  return <div className="grid place-items-center p-10"><Loader2 className="animate-spin text-muted" /></div>;
}

export function FormFields({ eff, values, onChange, renderers = {}, errors = {}, variant = 'cards', sectionExtras, idPrefix = 'ff' }: {
  eff: Effective;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  renderers?: Record<string, RendererEntry | undefined>;
  errors?: Record<string, string>;
  variant?: 'cards' | 'plain';
  /** Extra content at the end of a section (e.g. a lookup button). */
  sectionExtras?: Record<string, ReactNode>;
  idPrefix?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('forms');
  const errText = useErrorText();
  const states = useMemo(() => new Map(eff.fields.map((f) => [f.key, fieldState(f, values)])), [eff, values]);
  const visibleSections = eff.sections.filter((s) => !s.hidden && eff.fields.some((f) => f.section === s.key && !states.get(f.key)!.hidden));
  // Sub-tabs: sections that name a tab are grouped; the rest go to the first ("General") tab
  const tabs = useMemo(() => {
    if (!visibleSections.some((s) => s.tab)) return null;
    const names: string[] = [];
    for (const s of visibleSections) { const n = s.tab ?? ''; if (!names.includes(n)) names.push(n); }
    return names;
  }, [visibleSections]);
  const [tab, setTab] = useState<string | null>(null);
  const activeTab = tabs ? (tab !== null && tabs.includes(tab) ? tab : tabs[0]) : null;
  // Jump to the tab of the first error
  const errKeys = Object.keys(errors).join(',');
  useEffect(() => {
    if (!tabs || !errKeys) return;
    const first = eff.fields.find((f) => errors[f.key]);
    const sec = first && eff.sections.find((s) => s.key === first.section);
    if (sec) setTab(sec.tab ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errKeys]);

  const renderField = (f: EffField) => {
    const st = states.get(f.key)!;
    if (st.hidden) return null;
    const entry = renderers[f.key];
    const render = typeof entry === 'function' ? entry : entry?.render;
    const bare = typeof entry === 'object' && !!entry?.bare || (!entry && f.type === 'bool');
    const label = l10n(f.label, locale, f.baseLabel);
    const error = errText(errors[f.key], f);
    const ctx: RenderCtx = {
      field: f, id: `${idPrefix}-${f.key}`, label, placeholder: l10n(f.placeholder, locale), required: st.required, readonly: st.readonly,
      error, invalid: !!error, allowed: f.options?.length ? f.options : null, className: formInput,
    };
    const content = render ? render(ctx) : <GenericInput ctx={ctx} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />;
    const help = l10n(f.help, locale);
    return (
      <div key={f.key} className={clsx('min-w-0', span[f.width] ?? span.half)} data-field={f.key}>
        {!bare && (
          <label htmlFor={ctx.id} className="mb-1 flex min-w-0 items-center gap-1 text-xs font-medium text-muted">
            <span className="truncate">{label}</span>{st.required && <span className="text-danger">*</span>}
          </label>
        )}
        <fieldset disabled={st.readonly} className="min-w-0">{content}</fieldset>
        {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : help ? <span className="mt-1 block text-xs text-muted">{help}</span> : null}
      </div>
    );
  };

  const sectionBody = (s: EffSection) => (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-6">
      {eff.fields.filter((f) => f.section === s.key).map(renderField)}
      {sectionExtras?.[s.key]}
    </div>
  );
  const shown = visibleSections.filter((s) => !tabs || (s.tab ?? '') === activeTab);

  return (
    <div className={variant === 'cards' ? 'space-y-4' : 'space-y-3'}>
      {tabs && (
        <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-1">
          {tabs.map((name) => {
            const hasErr = visibleSections.some((s) => (s.tab ?? '') === name && eff.fields.some((f) => f.section === s.key && errors[f.key]));
            return (
              <button key={name || '_'} type="button" onClick={() => setTab(name)}
                className={clsx('relative shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition', activeTab === name ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
                {name || t('generalTab')}
                {hasErr && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />}
              </button>
            );
          })}
        </div>
      )}
      {shown.map((s, i) => (
        <Section key={s.key} section={s} variant={variant} first={i === 0} single={shown.length === 1 && variant === 'plain'}
          title={l10n(s.label, locale, s.baseLabel)}>
          {sectionBody(s)}
        </Section>
      ))}
    </div>
  );
}

function Section({ section, title, variant, first, single, children }: { section: EffSection; title: string; variant: 'cards' | 'plain'; first: boolean; single: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!section.collapsed);
  const head = (
    <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
      className={clsx('flex w-full items-center gap-2 text-left', variant === 'cards' ? 'text-base font-semibold' : 'text-xs font-semibold uppercase tracking-wide text-muted')}>
      <span className="flex-1">{title}</span>
      <ChevronDown size={variant === 'cards' ? 18 : 15} className={clsx('text-muted transition', !open && '-rotate-90')} />
    </button>
  );
  if (variant === 'plain') {
    return (
      <div className={clsx(!first && 'border-t border-border pt-3')}>
        {!single && <div className="mb-2">{head}</div>}
        {(open || single) && children}
      </div>
    );
  }
  return (
    <section className="card p-4 sm:p-5">
      <div className={clsx(open && 'mb-4')}>{head}</div>
      {open && children}
    </section>
  );
}

/** Inputs for custom fields and any field without its own renderer. */
export function GenericInput({ ctx, value, onChange }: { ctx: RenderCtx; value: unknown; onChange: (v: unknown) => void }) {
  const locale = useLocale();
  const t = useTranslations('forms');
  const f = ctx.field;
  const common = { id: ctx.id, className: ctx.className, 'aria-invalid': ctx.invalid, placeholder: ctx.placeholder || undefined };
  const s = value === null || value === undefined ? '' : String(value);
  const choices = (f.choices ?? []).filter((c) => !ctx.allowed || ctx.allowed.includes(c.value) || c.value === s);
  switch (f.type) {
    case 'textarea': return <textarea rows={3} {...common} value={s} onChange={(e) => onChange(e.target.value)} />;
    case 'number': return <input type="number" step="any" {...common} className={clsx(ctx.className, 'tabular')} value={s} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} />;
    case 'date': return <input type="date" {...common} value={s.slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />;
    case 'email': return <input type="email" {...common} value={s} onChange={(e) => onChange(e.target.value)} />;
    case 'url': return <input type="url" {...common} placeholder={ctx.placeholder || 'https://'} value={s} onChange={(e) => onChange(e.target.value)} />;
    case 'phone': return <input type="tel" {...common} value={s} onChange={(e) => onChange(e.target.value)} />;
    case 'bool': return (
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input id={ctx.id} type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{ctx.label}{ctx.required && <span className="text-danger"> *</span>}</span>
      </label>
    );
    case 'select': return (
      <select {...common} value={s} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('none')}</option>
        {choices.map((c) => <option key={c.value} value={c.value}>{l10n(c.label, locale) || c.value}</option>)}
      </select>
    );
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div id={ctx.id} className="flex flex-wrap gap-1.5" role="group" aria-label={ctx.label}>
          {choices.map((c) => {
            const on = arr.includes(c.value);
            return (
              <button key={c.value} type="button" aria-pressed={on} onClick={() => onChange(on ? arr.filter((x) => x !== c.value) : [...arr, c.value])}
                className={clsx('rounded-full border px-3 py-1.5 text-sm transition', on ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border')}>
                {l10n(c.label, locale) || c.value}
              </button>
            );
          })}
        </div>
      );
    }
    case 'list': return <NameSelect id={ctx.id} list={f.list as NameList} className={ctx.className} value={s} allowed={ctx.allowed} onChange={(x) => onChange(x)} />;
    case 'lookup': return <LookupSelect id={ctx.id} list={f.list as IdList} className={ctx.className} value={s || null} allowed={ctx.allowed} onChange={(x) => onChange(x)} />;
    default: return <input {...common} value={s} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Scroll to the first field with an error. */
export function scrollToError() {
  requestAnimationFrame(() => document.querySelector('[aria-invalid=true], [data-field] .text-danger')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
}
