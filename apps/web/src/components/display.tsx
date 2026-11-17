'use client';
// Display surfaces (Settings → Module Forms → Display): which fields read-only screens show, in which order and how
// (chip / text / badge, with or without label, on phones or not). Organisation → role → user, like the forms.
// A field the user's role cannot see in the form (Module Forms) is never shown here either.
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, RotateCcw, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { applyLevel, l10n, useFormConfig, type EffField, type Effective, type FormKey, type LevelConfig } from '@/lib/forms';
import { Dialog } from './customer-dialogs';
import { useToast } from './providers';
import { useMe } from './app-shell';
import { canDo } from './roles-settings';
import { StatusBadge } from './ui';

export type Surface = 'disp_customer_row' | 'disp_store_row' | 'disp_store_details' | 'disp_space' | 'disp_customer_card';
export const SURFACES: Surface[] = ['disp_customer_row', 'disp_store_row', 'disp_store_details', 'disp_space', 'disp_customer_card'];
const DATA_FORM: Record<Surface, FormKey> = {
  disp_customer_row: 'customer', disp_store_row: 'branch', disp_store_details: 'branch', disp_space: 'space', disp_customer_card: 'customer',
};
/** A value for a field: text (or a node), optional icon and link. Empty values are skipped unless "show empty". */
export type DVal = { value: ReactNode; icon?: LucideIcon; status?: string } | null | undefined;
export type DValues = Record<string, DVal>;

/** The surface config for this user, with fields hidden in the data form removed. `override` = settings preview. */
export function useDisplay(surface: Surface, override?: Effective) {
  const cfg = useFormConfig(surface);
  const data = useFormConfig(DATA_FORM[surface]);
  const eff = override ?? cfg.data;
  return useMemo(() => {
    if (!eff) return null;
    const hiddenInForm = new Set((data.data?.fields ?? []).filter((f) => f.hidden).map((f) => f.key));
    const fields = eff.fields.filter((f) => !f.hidden && !(f.src && hiddenInForm.has(f.src)));
    const bySection = (section: string) => fields.filter((f) => f.section === section);
    const sections = eff.sections.filter((s) => !s.hidden);
    return { eff, fields, bySection, sections };
  }, [eff, data.data]);
}

/** Custom field value → text. */
export function customText(f: EffField, v: unknown, locale: string, yes: string, no: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? yes : no;
  if (f.type === 'date') return new Date(String(v)).toLocaleDateString(locale);
  if (f.type === 'number') return Number(v).toLocaleString(locale);
  return String(v);
}
export function useValues(surface: Surface, base: DValues, custom: Record<string, unknown> | undefined | null, override?: Effective) {
  const d = useDisplay(surface, override);
  const locale = useLocale();
  const t = useTranslations('forms');
  if (!d) return base;
  const out: DValues = { ...base };
  for (const f of d.eff.fields) if (f.custom) {
    const text = customText(f, custom?.[f.key.slice(3)], locale, t('yes'), t('no'));
    out[f.key] = text ? { value: text } : null;
  }
  return out;
}

const empty = (v: DVal) => !v || v.value === null || v.value === undefined || v.value === '' || v.value === false;

/** One field as chip / badge / text. */
function Item({ f, v, locale }: { f: EffField; v: DVal; locale: string }) {
  const label = l10n(f.label, locale, f.baseLabel);
  const shown = empty(v) ? '—' : v!.value;
  const Icon = v?.icon;
  const mobile = f.mobile ? '' : 'hidden sm:inline-flex';
  if (v?.status && f.format === 'badge') return <span className={clsx('inline-flex', mobile)}><StatusBadge status={v.status} /></span>;
  if (f.format === 'badge') {
    return <span className={clsx('inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary', mobile)}>
      {f.showLabel && <span className="opacity-70">{label}:</span>}{shown}</span>;
  }
  if (f.format === 'chip') {
    return (
      <span className={clsx('inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs', mobile)}>
        {Icon && <Icon size={12} className="shrink-0 text-primary" />}
        {f.showLabel && <span className="shrink-0 text-muted">{label}:</span>}
        <span className="truncate font-medium">{shown}</span>
      </span>
    );
  }
  return <span className={clsx('inline-flex min-w-0 items-center gap-1', mobile)}>{Icon && <Icon size={12} className="shrink-0" />}{f.showLabel && <span className="opacity-70">{label}:</span>}<span className="truncate">{shown}</span></span>;
}

/** Fields of one section, laid out as a line ("a · b · c"), a wrap of chips/badges, or a column. */
export function DisplaySection({ surface, section, values, layout = 'wrap', className, override }: {
  surface: Surface; section: string; values: DValues; layout?: 'line' | 'wrap' | 'column'; className?: string; override?: Effective;
}) {
  const d = useDisplay(surface, override);
  const locale = useLocale();
  if (!d) return null;
  const list = d.bySection(section).filter((f) => f.showEmpty || !empty(values[f.key]));
  if (!list.length) return null;
  if (layout === 'line') {
    return (
      <span className={clsx('flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5', className)}>
        {list.map((f, i) => (
          <span key={f.key} className={clsx('inline-flex min-w-0 items-center gap-1', !f.mobile && 'hidden sm:inline-flex')}>
            {i > 0 && <span className="opacity-50">·</span>}<Item f={f} v={values[f.key]} locale={locale} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={clsx(layout === 'column' ? 'flex flex-col items-end gap-1' : 'flex flex-wrap gap-1.5', className)}>
      {list.map((f) => <Item key={f.key} f={f} v={values[f.key]} locale={locale} />)}
    </span>
  );
}

/** Label / value rows (customer card), one block per section in the configured order. */
export function DisplayRows({ surface, values, render, override }: {
  surface: Surface; values: DValues; override?: Effective;
  render: (section: { key: string; title: string }, rows: { key: string; label: string; value: ReactNode; icon?: LucideIcon }[]) => ReactNode;
}) {
  const d = useDisplay(surface, override);
  const locale = useLocale();
  if (!d) return null;
  return (
    <>
      {d.sections.map((s) => {
        const rows = d.bySection(s.key).filter((f) => f.showEmpty || !empty(values[f.key]))
          .map((f) => ({ key: f.key, label: f.showLabel ? l10n(f.label, locale, f.baseLabel) : '', value: empty(values[f.key]) ? null : values[f.key]!.value, icon: values[f.key]?.icon }));
        if (!rows.length) return null;
        return <span key={s.key} className="contents">{render({ key: s.key, title: l10n(s.label, locale, s.baseLabel) }, rows)}</span>;
      })}
    </>
  );
}

// ============================================================ quick customise (⚙)
export function DisplayCustomizeButton({ surface, className, label }: { surface: Surface; className?: string; label?: string }) {
  const t = useTranslations('display');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} title={t('customise')} aria-label={t('customise')}
        className={clsx('inline-flex items-center gap-1.5', className ?? 'grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-primary')}>
        <Settings2 size={label ? 16 : 13} />{label && <span className="hidden sm:inline">{label}</span>}
      </button>
      {open && createPortal(<span className="normal-case tracking-normal" onClick={(e) => e.stopPropagation()}><DisplayCustomizer initial={surface} onClose={() => setOpen(false)} /></span>, document.body)}
    </>
  );
}

export function DisplayCustomizer({ initial, onClose }: { initial: Surface; onClose: () => void }) {
  const t = useTranslations('display');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const manage = canDo(me, 'forms.manage');
  const [surface, setSurface] = useState<Surface>(initial);
  const uid = me?.user.id ?? '';
  const level = useQuery({
    queryKey: ['settings', 'forms', surface, 'user', uid], enabled: !!uid,
    queryFn: () => api<{ level: LevelConfig; base: Effective; version: number }>(`/settings/forms/${surface}?scope=user&key=${uid}`),
  });
  const [draft, setDraft] = useState<LevelConfig | null>(null);
  const cur = draft ?? level.data?.level ?? null;
  const eff = useMemo(() => (level.data && cur ? applyLevel(level.data.base, cur, 'user') : null), [level.data, cur]);
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['form-config'] }); qc.invalidateQueries({ queryKey: ['settings', 'forms'] }); };

  const setField = (k: string, patch: Record<string, unknown>) => setDraft((d) => {
    const c = d ?? level.data!.level;
    return { ...c, fields: { ...c.fields, [k]: { ...(c.fields[k] ?? {}), ...patch } } };
  });
  const move = (section: string, k: string, dir: -1 | 1) => {
    if (!eff) return;
    const list = eff.fields.filter((f) => f.section === section).map((f) => f.key);
    const i = list.indexOf(k), j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setDraft((d) => {
      const c = d ?? level.data!.level;
      const fields = { ...c.fields };
      list.forEach((fk, n) => { fields[fk] = { ...(fields[fk] ?? {}), order: (n + 1) * 10 }; });
      return { ...c, fields };
    });
  };
  const savePersonal = async () => {
    if (!cur) return;
    setBusy(true);
    try { await api(`/settings/forms/${surface}?scope=user&key=${uid}`, { method: 'PUT', json: { config: cur } }); toast({ title: t('saved') }); setDraft(null); refresh(); level.refetch(); }
    catch { toast({ title: t('saveError') }); }
    setBusy(false);
  };
  const resetPersonal = async () => {
    setBusy(true);
    await api(`/settings/forms/${surface}?scope=user&key=${uid}`, { method: 'DELETE' }).catch(() => {});
    setDraft(null); refresh(); await level.refetch(); setBusy(false);
  };
  /** Make what I see now the default for my role / everyone (and drop my own changes). */
  const saveAsDefault = async (scope: 'role' | 'organization') => {
    if (!eff) return;
    setBusy(true);
    try {
      const key = scope === 'role' ? me!.tenant.role : '';
      const target = await api<{ level: LevelConfig; version: number }>(`/settings/forms/${surface}?scope=${scope}&key=${encodeURIComponent(key)}`);
      const fields = { ...target.level.fields };
      for (const f of eff.fields) fields[f.key] = { ...(fields[f.key] ?? {}), hidden: f.hidden, order: f.order, section: f.section };
      await api(`/settings/forms/${surface}?scope=${scope}&key=${encodeURIComponent(key)}`, { method: 'PUT', json: { config: { ...target.level, fields }, note: t('fromQuick') } });
      await api(`/settings/forms/${surface}?scope=user&key=${uid}`, { method: 'DELETE' }).catch(() => {});
      toast({ title: scope === 'role' ? t('savedForRole') : t('savedForAll') }); setDraft(null); refresh(); await level.refetch();
    } catch { toast({ title: t('saveError') }); }
    setBusy(false);
  };

  return (
    <Dialog title={t('customise')} onClose={onClose}>
      <div className="space-y-3">
        <select className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm" value={surface} onChange={(e) => { setSurface(e.target.value as Surface); setDraft(null); }}>
          {SURFACES.map((s) => <option key={s} value={s}>{t(`s_${s}`)}</option>)}
        </select>
        <p className="text-xs text-muted">{t('quickHint')}</p>
        {!eff ? <Loader2 className="mx-auto animate-spin text-muted" /> : (
          <div className="max-h-[50dvh] space-y-3 overflow-auto">
            {eff.sections.map((s) => {
              const list = eff.fields.filter((f) => f.section === s.key);
              if (!list.length) return null;
              return (
                <div key={s.key}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{l10n(s.label, locale, s.baseLabel)}</div>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {list.map((f, i) => (
                      <li key={f.key} className={clsx('flex items-center gap-2 px-3 py-2 text-sm', f.hidden && 'text-muted')}>
                        <span className="flex flex-col">
                          <button type="button" disabled={i === 0} onClick={() => move(s.key, f.key, -1)} className="text-muted disabled:opacity-20" aria-label={t('up')}><ArrowUp size={13} /></button>
                          <button type="button" disabled={i === list.length - 1} onClick={() => move(s.key, f.key, 1)} className="text-muted disabled:opacity-20" aria-label={t('down')}><ArrowDown size={13} /></button>
                        </span>
                        <span className={clsx('min-w-0 flex-1 truncate', f.hidden && 'line-through')}>{l10n(f.label, locale, f.baseLabel)}</span>
                        <button type="button" disabled={f.core || f.locked.includes('hidden')} onClick={() => setField(f.key, { hidden: !f.hidden })}
                          className={clsx('grid h-8 w-8 place-items-center rounded-lg disabled:opacity-30', f.hidden ? 'text-muted hover:bg-surface-2' : 'text-primary hover:bg-primary-soft')}
                          aria-label={f.hidden ? t('show') : t('hide')} aria-pressed={!f.hidden}>{f.hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button type="button" disabled={busy} onClick={resetPersonal} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium"><RotateCcw size={14} /> {t('reset')}</button>
          <span className="flex-1" />
          {manage && (
            <>
              <button type="button" disabled={busy} onClick={() => saveAsDefault('role')} className="rounded-xl border border-border px-3 py-2 text-sm font-medium">{t('forMyRole')}</button>
              <button type="button" disabled={busy} onClick={() => saveAsDefault('organization')} className="rounded-xl border border-border px-3 py-2 text-sm font-medium">{t('forAll')}</button>
            </>
          )}
          <button type="button" disabled={busy || !draft} onClick={savePersonal} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />} {t('saveMine')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
