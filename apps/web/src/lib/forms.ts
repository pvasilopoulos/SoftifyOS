// Module Forms on the client: the effective configuration of a form, conditions, defaults and checks.
// The same rules are enforced by the API; this side only drives the UI.
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type L10n = { el?: string; en?: string };
export type FormKey = 'customer' | 'branch' | 'space' | 'contact' | 'activity' | 'offer' | 'offer_item';
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'bool' | 'select' | 'multiselect' | 'email' | 'url' | 'phone'
  | 'list' | 'lookup' | 'user' | 'tags' | 'country' | 'ref' | 'group';
export type Width = 'full' | 'half' | 'third';
export type Rule = { field: string; op: 'eq' | 'neq' | 'in' | 'not_in' | 'empty' | 'not_empty' | 'gt' | 'lt'; value?: string; then: 'show' | 'hide' | 'require' | 'readonly' };
export type DefaultValue =
  | { kind: 'static'; value: string | number | boolean | string[] | null }
  | { kind: 'today'; days: number }
  | { kind: 'me' }
  | { kind: 'parent'; field: string };
export type Prop = 'hidden' | 'readonly' | 'required' | 'default' | 'label' | 'placeholder' | 'help' | 'section' | 'order' | 'width'
  | 'min' | 'max' | 'minLength' | 'maxLength' | 'pattern' | 'patternMessage' | 'options' | 'rules';
export type Scope = 'organization' | 'role' | 'user';

export type EffField = {
  key: string; type: FieldType; core: boolean; custom: boolean; fixedLayout: boolean; list: string | null;
  choices: { value: string; label: L10n }[] | null;
  section: string; order: number; width: Width;
  hidden: boolean; readonly: boolean; required: boolean; default: DefaultValue | null;
  label: L10n; baseLabel: L10n; placeholder: L10n; help: L10n;
  min: number | null; max: number | null; minLength: number | null; maxLength: number | null; pattern: string | null; patternMessage: L10n;
  options: string[] | null; rules: Rule[]; locked: Prop[]; source: Partial<Record<Prop, Scope>>;
};
export type EffSection = { key: string; label: L10n; baseLabel: L10n; order: number; collapsed: boolean; tab: string | null; hidden: boolean; custom: boolean };
export type Effective = { form: FormKey; fields: EffField[]; sections: EffSection[] };

export type FieldCfg = Partial<{
  hidden: boolean; readonly: boolean; required: boolean; default: DefaultValue | null;
  label: L10n; placeholder: L10n; help: L10n; section: string; order: number; width: Width;
  min: number | null; max: number | null; minLength: number | null; maxLength: number | null; pattern: string | null; patternMessage: L10n;
  options: string[] | null; rules: Rule[]; locked: Prop[];
}>;
export type SectionCfg = Partial<{ label: L10n; order: number; collapsed: boolean; tab: string | null; hidden: boolean }>;
export type LevelConfig = { fields: Record<string, FieldCfg>; sections: Record<string, SectionCfg> };

export const l10n = (x: L10n | undefined, locale: string, fallback?: L10n): string =>
  (locale === 'en' ? x?.en || x?.el : x?.el || x?.en) || (fallback ? l10n(fallback, locale) : '') || '';

/** The signed-in user's configuration of a form (cached; the API enforces the same rules). */
export function useFormConfig(form: FormKey) {
  return useQuery({ queryKey: ['form-config', form], queryFn: () => api<Effective>(`/forms/${form}/effective`), staleTime: 60_000 });
}

// ------------------------------------------------------------------ conditions (same as the API)
const str = (v: unknown) => (Array.isArray(v) ? v.join(',') : v === null || v === undefined ? '' : String(v)).trim();
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function ruleMatches(r: Rule, values: Record<string, unknown>) {
  const v = values[r.field];
  const s = norm(str(v));
  const target = norm(r.value ?? '');
  const list = target.split(',').map((x) => x.trim()).filter(Boolean);
  switch (r.op) {
    case 'eq': return Array.isArray(v) ? v.some((x) => norm(String(x)) === target) : s === target;
    case 'neq': return Array.isArray(v) ? !v.some((x) => norm(String(x)) === target) : s !== target;
    case 'in': return Array.isArray(v) ? v.some((x) => list.includes(norm(String(x)))) : list.includes(s);
    case 'not_in': return Array.isArray(v) ? !v.some((x) => list.includes(norm(String(x)))) : !list.includes(s);
    case 'empty': return !s || s === 'false';
    case 'not_empty': return !!s && s !== 'false';
    case 'gt': return s !== '' && Number(s) > Number(target);
    case 'lt': return s !== '' && Number(s) < Number(target);
  }
}
export function fieldState(fl: EffField, values: Record<string, unknown>) {
  let { hidden, readonly, required } = fl;
  const shows = fl.rules.filter((r) => r.then === 'show');
  if (shows.length) hidden = !shows.some((r) => ruleMatches(r, values));
  for (const r of fl.rules) {
    if (r.then === 'show' || !ruleMatches(r, values)) continue;
    if (r.then === 'hide') hidden = true;
    if (r.then === 'require') required = true;
    if (r.then === 'readonly') readonly = true;
  }
  if (fl.core) { hidden = false; readonly = false; required = true; }
  return { hidden, readonly, required: required && !hidden && !readonly };
}

export function resolveDefault(d: DefaultValue | null, ctx: { userId?: string; parent?: Record<string, unknown> | null }): unknown {
  if (!d) return undefined;
  switch (d.kind) {
    case 'static': return d.value;
    case 'today': return new Date(Date.now() + d.days * 864e5).toISOString().slice(0, 10);
    case 'me': return ctx.userId;
    case 'parent': return ctx.parent?.[d.field] ?? null;
  }
}

export const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)
  || (typeof v === 'object' && !Array.isArray(v) && v !== null && !Object.values(v).some((x) => x !== null && x !== '' && x !== undefined));

/** Defaults of a new record: fills fields that are still empty. Returns the changed keys (custom as cf_<key>). */
export function defaultsFor(eff: Effective, values: Record<string, unknown>, ctx: { userId?: string; parent?: Record<string, unknown> | null }) {
  const out: Record<string, unknown> = {};
  for (const f of eff.fields) {
    if (!f.default) continue;
    const v = resolveDefault(f.default, ctx);
    if (v === undefined || v === null || v === '') continue;
    if (!isEmpty(values[f.key])) continue;
    out[f.key] = f.type === 'number' || f.type === 'select' || f.type === 'list' ? (typeof v === 'number' ? String(v) : v) : v;
  }
  return out;
}

/** Client-side checks before saving (same codes as the API). */
export function validateForm(eff: Effective, values: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  for (const f of eff.fields) {
    if (f.core) continue;
    const st = fieldState(f, values);
    if (st.hidden || st.readonly) continue;
    const v = values[f.key];
    if (isEmpty(v)) { if (st.required) errors[f.key] = 'required'; continue; }
    if (f.min !== null || f.max !== null) {
      const n = Number(v);
      if (Number.isFinite(n) && ((f.min !== null && n < f.min) || (f.max !== null && n > f.max))) { errors[f.key] = 'out_of_range'; continue; }
    }
    if (typeof v === 'string') {
      if ((f.minLength !== null && v.trim().length < f.minLength) || (f.maxLength !== null && v.trim().length > f.maxLength)) { errors[f.key] = 'length'; continue; }
      if (f.pattern) { try { if (!new RegExp(f.pattern, 'u').test(v.trim())) { errors[f.key] = 'pattern'; continue; } } catch { /* invalid pattern: ignore */ } }
    }
    if (f.type === 'email' && typeof v === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) errors[f.key] = 'invalid';
  }
  return errors;
}

/** Record values + custom values in one object (custom as cf_<key>). */
export function flatValues(v: Record<string, unknown>, custom?: Record<string, unknown> | null) {
  return { ...v, ...Object.fromEntries(Object.entries(custom ?? {}).map(([k, x]) => [`cf_${k}`, x])) };
}

// ------------------------------------------------------------------ one level applied on top of another (live preview in settings)
const LAYOUT: Prop[] = ['section', 'order', 'width'];
const clean = (x: L10n | undefined) => Object.fromEntries(Object.entries(x ?? {}).filter(([, v]) => typeof v === 'string' && v.trim())) as L10n;
export function applyLevel(base: Effective, level: LevelConfig, scope: Scope): Effective {
  const sections = new Map(base.sections.map((s) => [s.key, { ...s }]));
  for (const [key, sc] of Object.entries(level.sections ?? {})) {
    const s = sections.get(key) ?? { key, label: {}, baseLabel: {}, order: 10_000, collapsed: false, tab: null, hidden: false, custom: true };
    if (sc.label) s.label = { ...s.label, ...clean(sc.label) };
    if (sc.order !== undefined) s.order = sc.order;
    if (sc.collapsed !== undefined) s.collapsed = sc.collapsed;
    if (sc.tab !== undefined) s.tab = sc.tab?.trim() || null;
    if (sc.hidden !== undefined) s.hidden = sc.hidden;
    sections.set(key, s);
  }
  const fields = base.fields.map((f) => ({ ...f, locked: [...f.locked], source: { ...f.source } }));
  for (const fl of fields) {
    const c = level.fields?.[fl.key];
    if (!c) continue;
    for (const prop of Object.keys(c) as (Prop | 'locked')[]) {
      if (prop === 'locked' || fl.locked.includes(prop)) continue;
      if (fl.core && (prop === 'hidden' || prop === 'readonly' || prop === 'required')) continue;
      if (fl.fixedLayout && LAYOUT.includes(prop)) continue;
      const val = c[prop];
      if (prop === 'required' && val === false && fl.required && fl.source.required) continue;
      if (prop === 'label' || prop === 'placeholder' || prop === 'help' || prop === 'patternMessage') (fl as Record<string, unknown>)[prop] = { ...(fl[prop] as L10n), ...clean(val as L10n) };
      else (fl as Record<string, unknown>)[prop] = val;
      fl.source[prop] = scope;
    }
    if (scope !== 'user') for (const p of c.locked ?? []) if (!fl.locked.includes(p)) fl.locked.push(p);
  }
  for (const fl of fields) if (!sections.has(fl.section)) fl.section = base.fields.find((x) => x.key === fl.key)?.section ?? base.sections[0]?.key;
  const secList = [...sections.values()].sort((a, b) => a.order - b.order);
  const secOrder = new Map(secList.map((s, i) => [s.key, i]));
  fields.sort((a, b) => ((secOrder.get(a.section) ?? 0) - (secOrder.get(b.section) ?? 0)) || a.order - b.order);
  return { form: base.form, fields, sections: secList };
}
