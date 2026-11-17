'use client';
// Settings → Module Forms: per organisation / role / user configuration of every form (visibility, required,
// read-only, defaults, captions, order, sections & sub-tabs, validation, allowed values, conditions, locks),
// custom fields, live preview ("view as"), history with restore, export / import.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowDown, ArrowUp, Asterisk, Check, ChevronDown, Download, Eye, EyeOff, FileInput, GripVertical, History, Loader2, Lock,
  PencilOff, Plus, RotateCcw, Search, Settings2, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import {
  applyLevel, l10n, type DefaultValue, type EffField, type Effective, type FieldCfg, type FormKey, type L10n, type LevelConfig, type Prop, type Rule,
  type Scope, type SectionCfg,
} from '@/lib/forms';
import { matchRank, phonetic } from '@/lib/search';
import { Dialog } from './customer-dialogs';
import { appConfirm, appPrompt } from './confirm';
import { useToast } from './providers';
import { useMe } from './app-shell';
import { FormFields, formInput } from './form-engine';
import { useLookup, ID_LISTS, type LookupList } from './lookup-select';
import { useCrmMeta } from '@/lib/crm';
import { DisplayPreview } from './display-views';
import type { Surface } from './display';

const isDisp = (f: string) => f.startsWith('disp_');
const DISP_LOCKS: Prop[] = ['hidden', 'label', 'section', 'format', 'showLabel', 'showEmpty', 'mobile'];

type Overview = {
  can_manage: boolean; me: { id: string; role: string };
  roles: { key: string; name: string }[]; users: { id: string; full_name: string; email: string; role: string }[];
  forms: { key: FormKey; label: L10n; module: string; custom_allowed: boolean; fields: number; custom: number;
    changes: { organization: number; roles: Record<string, number>; users: Record<string, number> } }[];
};
type CustomField = { id: string; key: string; type: string; label: L10n; options: string[]; sort: number; active: boolean; filterable: boolean };
type Detail = {
  form: FormKey; scope: Scope; key: string; personal: boolean; personal_props: Prop[];
  level: LevelConfig; version: number; updated_at: string | null; updated_by_name: string | null;
  base: Effective; effective: Effective; custom_fields: CustomField[];
};

const btn = 'flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium transition hover:bg-surface-2 disabled:opacity-50';
const primary = 'flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60';
const small = 'mb-1 block text-xs font-medium text-muted';
const TEXT_TYPES = ['text', 'textarea', 'email', 'url', 'phone'];
const CHOICE_TYPES = ['select', 'multiselect', 'list', 'lookup', 'user', 'country'];
const COUNTRIES = ['GR', 'CY', 'BG', 'RO', 'IT', 'DE', 'FR', 'GB', 'US'];

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const emptyLevel = (): LevelConfig => ({ fields: {}, sections: {} });
/** A level without empty entries (what gets saved / compared). */
function tidy(level: LevelConfig): LevelConfig {
  const fields: LevelConfig['fields'] = {};
  for (const [k, v] of Object.entries(level.fields)) {
    const e = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && !(Array.isArray(x) && x.length === 0 && false)));
    if (Object.keys(e).length) fields[k] = e as FieldCfg;
  }
  const sections: LevelConfig['sections'] = {};
  for (const [k, v] of Object.entries(level.sections)) {
    const e = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
    if (Object.keys(e).length) sections[k] = e as SectionCfg;
  }
  return { fields, sections };
}

export function ModuleFormsSection() {
  const t = useTranslations('forms');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const overview = useQuery({ queryKey: ['settings', 'forms'], queryFn: () => api<Overview>('/settings/forms') });
  const manage = !!overview.data?.can_manage;
  const [form, setForm] = useState<FormKey>('customer');
  const [scope, setScope] = useState<Scope>('organization');
  const [key, setKey] = useState('');
  useEffect(() => { if (overview.data && !manage && me) { setScope('user'); setKey(me.user.id); } }, [overview.data, manage, me]);
  const levelKey = scope === 'organization' ? '' : key;
  const ready = scope === 'organization' || !!key;

  const detail = useQuery({
    queryKey: ['settings', 'forms', form, scope, levelKey], enabled: !!overview.data && ready,
    queryFn: () => api<Detail>(`/settings/forms/${form}?scope=${scope}&key=${encodeURIComponent(levelKey)}`),
  });
  const [draft, setDraft] = useState<LevelConfig>(emptyLevel());
  const loadedFor = useRef('');
  useEffect(() => {
    if (!detail.data) return;
    const id = `${form}:${scope}:${levelKey}:${detail.data.version}`;
    if (loadedFor.current === id) return;
    loadedFor.current = id;
    setDraft(clone(detail.data.level));
  }, [detail.data, form, scope, levelKey]);
  const dirty = !!detail.data && JSON.stringify(tidy(draft)) !== JSON.stringify(tidy(detail.data.level));
  const live = useMemo(() => (detail.data ? applyLevel(detail.data.base, tidy(draft), scope) : null), [detail.data, draft, scope]);

  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/settings/forms/${form}?scope=${scope}&key=${encodeURIComponent(levelKey)}`, { method: 'PUT', json: { config: tidy(draft), note: note.trim() || null, version: detail.data?.version } }),
    onSuccess: () => {
      toast({ title: t('saved') }); setNote('');
      qc.invalidateQueries({ queryKey: ['settings', 'forms'] });
      qc.invalidateQueries({ queryKey: ['form-config'] });
    },
    onError: (e) => toast({ title: e instanceof ApiError && e.code === 'conflict' ? t('conflict') : t('saveError') }),
  });
  const reset = async () => {
    if (!(await appConfirm(t('resetConfirm'), { danger: true }))) return;
    await api(`/settings/forms/${form}?scope=${scope}&key=${encodeURIComponent(levelKey)}`, { method: 'DELETE' });
    toast({ title: t('resetDone') });
    qc.invalidateQueries({ queryKey: ['settings', 'forms'] }); qc.invalidateQueries({ queryKey: ['form-config'] });
  };
  // Switching form / level with unsaved changes
  const guard = async (fn: () => void) => { if (!dirty || (await appConfirm(t('discardConfirm')))) fn(); };

  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [sectionEdit, setSectionEdit] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'custom' | 'history' | 'import' | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  if (!overview.data) return <div className="grid place-items-center p-10"><Loader2 className="animate-spin text-muted" /></div>;
  const ov = overview.data;
  const formInfo = ov.forms.find((f) => f.key === form)!;
  const levelChanges = (fk: FormKey) => {
    const f = ov.forms.find((x) => x.key === fk)!;
    return scope === 'organization' ? f.changes.organization : scope === 'role' ? f.changes.roles[key] ?? 0 : f.changes.users[key] ?? 0;
  };
  const personal = !manage;
  const can = (p: Prop) => !personal || detail.data?.personal_props.includes(p);

  // ------------------------------------------------ draft helpers
  const setField = (k: string, patch: FieldCfg | ((c: FieldCfg) => FieldCfg)) => setDraft((d) => {
    const cur = d.fields[k] ?? {};
    const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
    for (const p of Object.keys(next) as (keyof FieldCfg)[]) if (next[p] === undefined) delete next[p];
    const fields = { ...d.fields, [k]: next };
    if (!Object.keys(next).length) delete fields[k];
    return { ...d, fields };
  });
  const setSection = (k: string, patch: SectionCfg | null) => setDraft((d) => {
    const sections = { ...d.sections };
    if (patch === null) delete sections[k];
    else {
      const next = { ...(sections[k] ?? {}), ...patch };
      for (const p of Object.keys(next) as (keyof SectionCfg)[]) if (next[p] === undefined) delete next[p];
      if (Object.keys(next).length) sections[k] = next; else delete sections[k];
    }
    return { ...d, sections };
  });
  /** Put `k` before `before` (or at the end of `section`), renumbering that section. */
  const moveField = (k: string, section: string, before: string | null) => {
    if (!live) return;
    const list = live.fields.filter((f) => f.section === section && f.key !== k).map((f) => f.key);
    const at = before ? list.indexOf(before) : -1;
    list.splice(at < 0 ? list.length : at, 0, k);
    setDraft((d) => {
      const fields = { ...d.fields };
      list.forEach((fk, i) => {
        const f = live.fields.find((x) => x.key === fk)!;
        if (f.fixedLayout) return;
        fields[fk] = { ...(fields[fk] ?? {}), order: (i + 1) * 10, ...(fk === k && f.section !== section ? { section } : {}) };
      });
      return { ...d, fields };
    });
  };
  const moveSection = (k: string, dir: -1 | 1) => {
    if (!live) return;
    const list = live.sections.map((s) => s.key);
    const i = list.indexOf(k), j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setDraft((d) => ({ ...d, sections: Object.fromEntries([...Object.entries(d.sections), ...list.map((sk, n) => [sk, { ...(d.sections[sk] ?? {}), order: (n + 1) * 10 }] as const)]) }));
  };
  const addSection = async () => {
    const name = (await appPrompt(t('newSectionName')))?.trim();
    if (!name || !live) return;
    let base = phonetic(name).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'section';
    if (!/^[a-z]/.test(base)) base = `s_${base}`;
    let k = base, n = 2;
    while (live.sections.some((s) => s.key === k)) k = `${base}_${n++}`;
    setSection(k, { label: { [locale === 'en' ? 'en' : 'el']: name }, order: (live.sections.at(-1)?.order ?? 0) + 10 });
  };

  const levelName = scope === 'organization' ? t('scope_organization')
    : scope === 'role' ? ov.roles.find((r) => r.key === key)?.name ?? key
      : ov.users.find((u) => u.id === key)?.full_name ?? t('myForm');

  return (
    <div className="space-y-4">
      {/* Form picker */}
      <section className="card p-3 sm:p-4">
        {(['customers', 'offers', 'crm', 'display'] as const).map((mod) => (
          <div key={mod} className="mb-3 last:mb-0">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t(`module_${mod}`)}</div>
            <div className="no-scrollbar flex gap-2 overflow-x-auto sm:flex-wrap">
              {ov.forms.filter((f) => f.module === mod).map((f) => {
                const n = levelChanges(f.key);
                return (
                  <button key={f.key} type="button" onClick={() => guard(() => { setForm(f.key); setEditing(null); })}
                    className={clsx('flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                      form === f.key ? 'border-primary bg-primary text-white' : 'border-border bg-surface hover:bg-surface-2')}>
                    {l10n(f.label, locale)}
                    {n > 0 && <span className={clsx('rounded-full px-1.5 text-[11px] font-bold', form === f.key ? 'bg-white/25' : 'bg-primary-soft text-primary')}>{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* Level */}
      <section className="card space-y-3 p-3 sm:p-4">
        {manage ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1 sm:w-auto">
              {(['organization', 'role', 'user'] as const).map((sc) => (
                <button key={sc} type="button" onClick={() => guard(() => {
                  setScope(sc);
                  setKey(sc === 'role' ? ov.roles[0]?.key ?? '' : sc === 'user' ? me?.user.id ?? ov.users[0]?.id ?? '' : '');
                })}
                  className={clsx('rounded-xl px-3 py-2 text-sm font-semibold transition', scope === sc ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
                  {t(`scope_${sc}`)}
                </button>
              ))}
            </div>
            {scope === 'role' && (
              <select className={clsx(formInput, 'sm:max-w-xs')} value={key} onChange={(e) => { const v = e.target.value; guard(() => setKey(v)); }}>
                {ov.roles.map((r) => <option key={r.key} value={r.key}>{r.name}{formInfo.changes.roles[r.key] ? ` · ${formInfo.changes.roles[r.key]}` : ''}</option>)}
              </select>
            )}
            {scope === 'user' && (
              <select className={clsx(formInput, 'sm:max-w-xs')} value={key} onChange={(e) => { const v = e.target.value; guard(() => setKey(v)); }}>
                {ov.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}{formInfo.changes.users[u.id] ? ` · ${formInfo.changes.users[u.id]}` : ''}</option>)}
              </select>
            )}
          </div>
        ) : (
          <p className="rounded-xl bg-primary-soft/60 p-3 text-sm text-primary">{t('personalInfo')}</p>
        )}
        <p className="text-sm text-muted">{t(`scopeHint_${scope}`)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchFields')} className={clsx(formInput, 'py-2 pl-9')} />
          </label>
          {manage && formInfo.custom_allowed && <button type="button" className={btn} onClick={() => setDialog('custom')}><Plus size={15} /> {t('customFields')}{formInfo.custom ? ` (${formInfo.custom})` : ''}</button>}
          {manage && <button type="button" className={btn} onClick={addSection}><Plus size={15} /> {t('newSection')}</button>}
          <button type="button" className={btn} onClick={() => setDialog('history')}><History size={15} /> {t('history')}</button>
          <button type="button" className={btn} onClick={reset} disabled={!detail.data?.version}><RotateCcw size={15} /> {t('resetLevel')}</button>
          {manage && <ExportImport onImport={() => setDialog('import')} />}
          <button type="button" className={clsx(btn, 'xl:hidden')} onClick={() => setShowPreview((x) => !x)}><Eye size={15} /> {t('preview')}</button>
        </div>
        {detail.data?.updated_at && (
          <p className="text-xs text-muted">{t('lastChange', { who: detail.data.updated_by_name ?? '—', when: new Date(detail.data.updated_at).toLocaleString(locale) })} · v{detail.data.version}</p>
        )}
      </section>

      {!live || !detail.data ? (
        <div className="grid place-items-center p-10"><Loader2 className="animate-spin text-muted" /></div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className={clsx('space-y-3', showPreview && 'hidden xl:block')}>
            {live.sections.map((s, si) => {
              const fields = live.fields.filter((f) => f.section === s.key && (!q.trim() || matchRank(`${l10n(f.label, locale)} ${f.key}`, q) !== null));
              if (q.trim() && !fields.length) return null;
              const own = draft.sections[s.key];
              return (
                <section key={s.key} className={clsx('card overflow-hidden', s.hidden && 'opacity-60')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { const k = e.dataTransfer.getData('text/field'); if (k) moveField(k, s.key, null); }}>
                  <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-2.5 sm:px-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-semibold">
                        <span className="truncate">{l10n(s.label, locale, s.baseLabel) || s.key}</span>
                        {own && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" title={t('changedHere')} />}
                      </div>
                      <div className="flex flex-wrap gap-1 text-[11px] text-muted">
                        {s.tab && <Chip>{t('tab')}: {s.tab}</Chip>}
                        {s.collapsed && <Chip>{t('collapsed')}</Chip>}
                        {s.hidden && <Chip tone="danger">{t('hiddenSection')}</Chip>}
                        {s.custom && <Chip>{t('customSection')}</Chip>}
                      </div>
                    </div>
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface disabled:opacity-30" disabled={si === 0} onClick={() => moveSection(s.key, -1)} aria-label={t('moveUp')}><ArrowUp size={16} /></button>
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface disabled:opacity-30" disabled={si === live.sections.length - 1} onClick={() => moveSection(s.key, 1)} aria-label={t('moveDown')}><ArrowDown size={16} /></button>
                    {manage && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface" onClick={() => setSectionEdit(s.key)} aria-label={t('editSection')}><Settings2 size={16} /></button>}
                  </header>
                  {!fields.length && <p className="p-4 text-sm text-muted">{t('emptySection')}</p>}
                  <ul className="divide-y divide-border">
                    {fields.map((f, i) => (
                      <FieldRow key={f.key} f={f} own={draft.fields[f.key]} personal={personal} disp={isDisp(form)}
                        first={i === 0} last={i === fields.length - 1}
                        onOpen={() => setEditing(f.key)}
                        onToggle={(p, v) => setField(f.key, { [p]: v })}
                        onMove={(dir) => { const list = fields.map((x) => x.key); const j = list.indexOf(f.key) + dir; moveField(f.key, s.key, dir < 0 ? list[j] : list[j + 1] ?? null); }}
                        onDrop={(k) => moveField(k, s.key, f.key)} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <div className={clsx('xl:sticky xl:top-4', !showPreview && 'hidden xl:block')}>
            <Preview form={form} live={live} manage={manage} ov={ov} levelName={levelName} />
          </div>
        </div>
      )}

      {/* Save bar */}
      {dirty && (
        <div className="card sticky bottom-24 z-20 flex flex-col gap-2 p-3 sm:flex-row sm:items-center lg:bottom-4">
          <span className="text-sm font-medium">{t('unsaved', { level: levelName })}</span>
          <input className={clsx(formInput, 'py-2 sm:flex-1')} placeholder={t('notePlaceholder')} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => detail.data && setDraft(clone(detail.data.level))}><X size={15} /> {t('discard')}</button>
            <button type="button" className={primary} disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}
            </button>
          </div>
        </div>
      )}

      {editing && live && (() => {
        const f = live.fields.find((x) => x.key === editing);
        const baseF = detail.data!.base.fields.find((x) => x.key === editing);
        if (!f || !baseF) return null;
        return <FieldDialog f={f} base={baseF} own={draft.fields[editing] ?? {}} scope={scope} personal={personal} can={can} live={live}
          onChange={(c) => setField(editing, () => c)} onClose={() => setEditing(null)} />;
      })()}
      {sectionEdit && live && (() => {
        const s = live.sections.find((x) => x.key === sectionEdit);
        if (!s) return null;
        return <SectionDialog s={s} own={draft.sections[sectionEdit] ?? {}} hasFields={live.fields.some((f) => f.section === s.key)}
          onChange={(c) => setSection(sectionEdit, c)} onClose={() => setSectionEdit(null)} />;
      })()}
      {dialog === 'custom' && <CustomFieldsDialog form={form} onClose={() => setDialog(null)} />}
      {dialog === 'history' && <HistoryDialog form={form} scope={scope} levelKey={levelKey} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'danger' | 'primary' | 'warning' }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
    tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'primary' ? 'bg-primary-soft text-primary' : tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted')}>{children}</span>;
}

// ============================================================ field row
function FieldRow({ f, own, personal, disp, first, last, onOpen, onToggle, onMove, onDrop }: {
  f: EffField; own?: FieldCfg; personal: boolean; disp?: boolean; first: boolean; last: boolean;
  onOpen: () => void; onToggle: (p: 'hidden' | 'readonly' | 'required', v: boolean | undefined) => void; onMove: (dir: -1 | 1) => void; onDrop: (k: string) => void;
}) {
  const t = useTranslations('forms');
  const locale = useLocale();
  const [over, setOver] = useState(false);
  const toggle = (p: 'hidden' | 'readonly' | 'required') => {
    // Back to the inherited value when it matches; otherwise set it here
    const next = !f[p];
    onToggle(p, own?.[p] !== undefined && own[p] !== next ? undefined : next);
  };
  const lockedQuick = (p: Prop) => f.core || f.locked.includes(p) || personal;
  const ownCount = own ? Object.keys(own).length : 0;
  return (
    <li draggable={!f.fixedLayout} onDragStart={(e) => { e.dataTransfer.setData('text/field', f.key); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const k = e.dataTransfer.getData('text/field'); if (k && k !== f.key) onDrop(k); }}
      className={clsx('flex items-center gap-2 px-2 py-2 transition sm:px-3', over && 'bg-primary-soft/50', f.hidden && 'bg-surface-2/50')}>
      <span className={clsx('hidden cursor-grab text-muted sm:block', f.fixedLayout && 'invisible')}><GripVertical size={16} /></span>
      <div className="flex flex-col sm:hidden">
        <button type="button" disabled={first || f.fixedLayout} onClick={() => onMove(-1)} className="text-muted disabled:opacity-20" aria-label={t('moveUp')}><ArrowUp size={14} /></button>
        <button type="button" disabled={last || f.fixedLayout} onClick={() => onMove(1)} className="text-muted disabled:opacity-20" aria-label={t('moveDown')}><ArrowDown size={14} /></button>
      </div>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <span className={clsx('truncate text-sm font-medium', f.hidden && 'text-muted line-through')}>{l10n(f.label, locale, f.baseLabel)}</span>
          {f.required && <span className="text-danger">*</span>}
          {ownCount > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" title={t('changedHere')} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <code className="text-[11px] text-muted">{f.key}</code>
          <Chip>{t(`type_${f.type}`)}</Chip>
          {f.core && <Chip tone="primary">{t('core')}</Chip>}
          {f.custom && <Chip tone="primary">{t('custom')}</Chip>}
          {f.readonly && <Chip tone="warning">{t('readonly')}</Chip>}
          {f.default && <Chip>{t('hasDefault')}</Chip>}
          {!!f.options?.length && <Chip>{t('optionsCount', { n: f.options.length })}</Chip>}
          {!!f.rules.length && <Chip tone="primary">{t('rulesCount', { n: f.rules.length })}</Chip>}
          {f.locked.length > 0 && <Chip><Lock size={10} /> {f.locked.length}</Chip>}
          {!disp && f.width !== 'half' && !f.fixedLayout && <Chip>{t(`width_${f.width}`)}</Chip>}
          {disp && <Chip tone="primary">{t(`format_${f.format}`)}</Chip>}
          {disp && !f.mobile && <Chip>{t('notOnMobile')}</Chip>}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <Quick on={!f.hidden} disabled={lockedQuick('hidden')} label={f.hidden ? t('show') : t('hide')} onClick={() => toggle('hidden')}>{f.hidden ? <EyeOff size={16} /> : <Eye size={16} />}</Quick>
        {!disp && <Quick on={f.required} disabled={lockedQuick('required')} label={t('required')} onClick={() => toggle('required')} tone="danger"><Asterisk size={16} /></Quick>}
        {!disp && <Quick on={f.readonly} disabled={lockedQuick('readonly')} label={t('readonly')} onClick={() => toggle('readonly')} tone="warning"><PencilOff size={16} /></Quick>}
      </div>
    </li>
  );
}

function Quick({ on, disabled, label, onClick, children, tone }: { on: boolean; disabled?: boolean; label: string; onClick: () => void; children: ReactNode; tone?: 'danger' | 'warning' }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}
      className={clsx('grid h-8 w-8 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-30',
        on ? (tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'warning' ? 'bg-warning-soft text-warning' : 'text-primary') : 'text-muted hover:bg-surface-2')}>
      {children}
    </button>
  );
}

// ============================================================ preview
function Preview({ form, live, manage, ov, levelName }: { form: FormKey; live: Effective; manage: boolean; ov: Overview; levelName: string }) {
  const t = useTranslations('forms');
  const [as, setAs] = useState('');
  const viewAs = useQuery({
    queryKey: ['form-preview', form, as], enabled: !!as,
    queryFn: () => api<Effective>(`/forms/${form}/effective?${as.startsWith('r:') ? `as_role=${encodeURIComponent(as.slice(2))}` : `as_user=${as.slice(2)}`}`),
  });
  const eff = as ? viewAs.data : live;
  const [values, setValues] = useState<Record<string, unknown>>({});
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Eye size={17} className="text-primary" />
        <span className="flex-1 font-semibold">{t('preview')}</span>
        {manage && (
          <select className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm" value={as} onChange={(e) => setAs(e.target.value)} aria-label={t('viewAs')}>
            <option value="">{t('viewAsDraft', { level: levelName })}</option>
            <optgroup label={t('scope_role')}>{ov.roles.map((r) => <option key={r.key} value={`r:${r.key}`}>{r.name}</option>)}</optgroup>
            <optgroup label={t('scope_user')}>{ov.users.map((u) => <option key={u.id} value={`u:${u.id}`}>{u.full_name}</option>)}</optgroup>
          </select>
        )}
      </header>
      <div className="max-h-[75dvh] overflow-auto p-4">
        <p className="mb-3 text-xs text-muted">{as ? t('previewSaved') : t('previewHint')}</p>
        {!eff ? <Loader2 className="mx-auto animate-spin text-muted" /> : (
          isDisp(form) ? <DisplayPreview surface={form as Surface} eff={eff} />
            : <FormFields eff={eff} values={values} variant="plain" idPrefix="pv" onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))} />
        )}
        {!!Object.keys(values).length && <button type="button" onClick={() => setValues({})} className="mt-3 text-xs font-medium text-primary">{t('clearPreview')}</button>}
      </div>
    </section>
  );
}

// ============================================================ field dialog
type Tab = 'basic' | 'display' | 'texts' | 'values' | 'validation' | 'rules' | 'layout' | 'locks';

function FieldDialog({ f, base, own, scope, personal, can, live, onChange, onClose }: {
  f: EffField; base: EffField; own: FieldCfg; scope: Scope; personal: boolean; can: (p: Prop) => boolean | undefined; live: Effective;
  onChange: (c: FieldCfg) => void; onClose: () => void;
}) {
  const t = useTranslations('forms');
  const locale = useLocale();
  const isText = TEXT_TYPES.includes(f.type);
  const isChoice = CHOICE_TYPES.includes(f.type) || f.key === 'company_id';
  const disp = isDisp(live.form);
  const tabs: Tab[] = disp
    ? (['display', 'texts', 'layout', 'locks'] as Tab[]).filter((x) => !(x === 'locks' && (scope === 'user' || personal)) && !(personal && !['display', 'layout'].includes(x)))
    : (['basic', 'texts', 'values', 'validation', 'rules', 'layout', 'locks'] as Tab[]).filter((x) =>
      !(x === 'locks' && (scope === 'user' || personal)) && !(x === 'layout' && f.fixedLayout)
      && !(x === 'validation' && !(isText || f.type === 'number')) && !(personal && !['values', 'layout'].includes(x)));
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const set = (p: keyof FieldCfg, v: unknown) => { const next = { ...own, [p]: v } as FieldCfg; if (v === undefined) delete next[p]; onChange(next); };
  const lockedAbove = (p: Prop) => base.locked.includes(p);
  const disabled = (p: Prop) => lockedAbove(p) || !can(p) || (f.core && ['hidden', 'readonly', 'required'].includes(p));
  const Inherit = ({ p }: { p: Prop }) => own[p] !== undefined
    ? <button type="button" onClick={() => set(p, undefined)} className="text-xs font-medium text-primary">{t('inherit')}</button>
    : lockedAbove(p) ? <span className="flex items-center gap-1 text-xs text-muted"><Lock size={11} /> {t('lockedAbove')}</span>
      : <span className="text-xs text-muted">{t('inherited')}</span>;
  return (
    <Dialog title={`${l10n(f.label, locale, f.baseLabel)} · ${f.key}`} onClose={onClose}>
      <div className="no-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto px-1">
        {tabs.map((x) => (
          <button key={x} type="button" onClick={() => setTab(x)}
            className={clsx('shrink-0 rounded-full px-3 py-1.5 text-sm font-medium', tab === x ? 'bg-primary text-white' : 'bg-surface-2 text-muted')}>
            {t(`tab_${x}`)}
          </button>
        ))}
      </div>

      {tab === 'basic' && (
        <div className="space-y-3">
          {f.core && <p className="rounded-xl bg-primary-soft/60 p-3 text-sm text-primary">{t('coreInfo')}</p>}
          {(['hidden', 'required', 'readonly'] as const).map((p) => (
            <div key={p} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t(`p_${p}`)}</div>
                <div className="text-xs text-muted">{t(`h_${p}`)}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <TriState value={own[p]} inherited={base[p]} disabled={disabled(p)} onChange={(v) => set(p, v)} />
                <Inherit p={p} />
              </div>
            </div>
          ))}
          {base.required && base.source.required && <p className="text-xs text-muted">{t('requiredAbove')}</p>}
        </div>
      )}

      {tab === 'display' && (
        <div className="space-y-3">
          {f.core && <p className="rounded-xl bg-primary-soft/60 p-3 text-sm text-primary">{t('coreInfo')}</p>}
          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between"><span className="font-medium">{t('p_format')}</span><Inherit p="format" /></div>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1">
              {(['text', 'chip', 'badge'] as const).map((w) => (
                <button key={w} type="button" disabled={disabled('format')} onClick={() => set('format', w === base.format ? undefined : w)}
                  className={clsx('rounded-xl py-2 text-sm font-medium', (own.format ?? base.format) === w ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
                  {t(`format_${w}`)}
                </button>
              ))}
            </div>
          </div>
          {(['hidden', 'showLabel', 'showEmpty', 'mobile'] as const).map((p) => (
            <div key={p} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t(`p_${p}`)}</div>
                <div className="text-xs text-muted">{t(p === 'hidden' ? 'h_hiddenDisplay' : `h_${p}`)}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <TriState value={own[p]} inherited={base[p]} disabled={disabled(p)} onChange={(v) => set(p, v)} />
                <Inherit p={p} />
              </div>
            </div>
          ))}
          {f.src && <p className="text-xs text-muted">{t('srcHint')}</p>}
        </div>
      )}

      {tab === 'texts' && (
        <div className="space-y-4">
          {((disp ? ['label'] : ['label', 'placeholder', 'help']) as ('label' | 'placeholder' | 'help')[]).map((p) => (
            <div key={p}>
              <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">{t(`p_${p}`)}</span><Inherit p={p} /></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['el', 'en'] as const).map((lang) => (
                  <label key={lang} className="block">
                    <span className={small}>{lang.toUpperCase()}</span>
                    <input className={formInput} disabled={disabled(p)} maxLength={300}
                      placeholder={(base[p] as L10n)[lang] ?? ''} value={(own[p] as L10n | undefined)?.[lang] ?? ''}
                      onChange={(e) => { const cur = { ...((own[p] as L10n) ?? {}), [lang]: e.target.value || undefined }; set(p, Object.values(cur).some(Boolean) ? cur : undefined); }} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'values' && (
        <div className="space-y-5">
          <div>
            <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">{t('p_default')}</span><Inherit p="default" /></div>
            <p className="mb-2 text-xs text-muted">{t('h_default')}</p>
            <DefaultEditor f={f} value={own.default !== undefined ? own.default : base.default} disabled={disabled('default')} onChange={(v) => set('default', v)} />
          </div>
          {isChoice && !personal && (
            <div>
              <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">{t('p_options')}</span><Inherit p="options" /></div>
              <p className="mb-2 text-xs text-muted">{t('h_options')}</p>
              <OptionsEditor f={f} value={own.options !== undefined ? own.options : base.options} disabled={disabled('options')} onChange={(v) => set('options', v)} />
            </div>
          )}
        </div>
      )}

      {tab === 'validation' && (
        <div className="space-y-4">
          {f.type === 'number' ? (
            <div className="grid grid-cols-2 gap-3">
              {(['min', 'max'] as const).map((p) => (
                <label key={p} className="block">
                  <span className="mb-1 flex items-center justify-between text-sm font-medium">{t(`p_${p}`)} <Inherit p={p} /></span>
                  <input type="number" step="any" className={formInput} disabled={disabled(p)} placeholder={base[p] === null ? '—' : String(base[p])}
                    value={own[p] ?? ''} onChange={(e) => set(p, e.target.value === '' ? undefined : Number(e.target.value))} />
                </label>
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {(['minLength', 'maxLength'] as const).map((p) => (
                  <label key={p} className="block">
                    <span className="mb-1 flex items-center justify-between text-sm font-medium">{t(`p_${p}`)} <Inherit p={p} /></span>
                    <input type="number" min={0} className={formInput} disabled={disabled(p)} placeholder={base[p] === null ? '—' : String(base[p])}
                      value={own[p] ?? ''} onChange={(e) => set(p, e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))))} />
                  </label>
                ))}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">{t('p_pattern')}</span><Inherit p="pattern" /></div>
                <input className={clsx(formInput, 'font-mono text-sm')} disabled={disabled('pattern')} placeholder={base.pattern ?? '^…$'} value={own.pattern ?? ''}
                  onChange={(e) => set('pattern', e.target.value || undefined)} aria-invalid={!!own.pattern && !validRegex(own.pattern)} />
                {!!own.pattern && !validRegex(own.pattern) && <span className="mt-1 block text-xs text-danger">{t('badPattern')}</span>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PATTERNS.map((p) => (
                    <button key={p.key} type="button" disabled={disabled('pattern')} onClick={() => onChange({ ...own, pattern: p.re, patternMessage: { el: p.el, en: p.en } })}
                      className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-2"><Wand2 size={11} /> {t(`pat_${p.key}`)}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">{t('p_patternMessage')}</span><Inherit p="patternMessage" /></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['el', 'en'] as const).map((lang) => (
                    <input key={lang} className={formInput} disabled={disabled('patternMessage')} placeholder={`${lang.toUpperCase()} · ${base.patternMessage[lang] ?? ''}`}
                      value={own.patternMessage?.[lang] ?? ''} onChange={(e) => { const cur = { ...(own.patternMessage ?? {}), [lang]: e.target.value || undefined }; set('patternMessage', Object.values(cur).some(Boolean) ? cur : undefined); }} />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'rules' && (
        <RulesEditor f={f} live={live} value={own.rules !== undefined ? own.rules : base.rules} overridden={own.rules !== undefined}
          disabled={disabled('rules')} onChange={(v) => set('rules', v)} onInherit={() => set('rules', undefined)} />
      )}

      {tab === 'layout' && (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-sm font-medium">{t('p_section')} <Inherit p="section" /></span>
            <select className={formInput} disabled={disabled('section')} value={own.section ?? f.section} onChange={(e) => set('section', e.target.value === base.section ? undefined : e.target.value)}>
              {live.sections.map((s) => <option key={s.key} value={s.key}>{l10n(s.label, locale, s.baseLabel) || s.key}</option>)}
            </select>
          </label>
          {!disp && <div>
            <span className="mb-1 flex items-center justify-between text-sm font-medium">{t('p_width')} <Inherit p="width" /></span>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1">
              {(['third', 'half', 'full'] as const).map((w) => (
                <button key={w} type="button" disabled={disabled('width')} onClick={() => set('width', w === base.width ? undefined : w)}
                  className={clsx('rounded-xl py-2 text-sm font-medium', (own.width ?? base.width) === w ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
                  {t(`width_${w}`)}
                </button>
              ))}
            </div>
          </div>}
          <p className="text-xs text-muted">{t('orderHint')}</p>
        </div>
      )}

      {tab === 'locks' && (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t('locksHint')}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(disp ? DISP_LOCKS : ['hidden', 'required', 'readonly', 'default', 'label', 'options', 'rules', 'section', 'width', 'pattern'] as Prop[]).map((p) => {
              const on = !!own.locked?.includes(p) || base.locked.includes(p);
              return (
                <label key={p} className={clsx('flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm', base.locked.includes(p) && 'opacity-60')}>
                  <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={on} disabled={base.locked.includes(p)}
                    onChange={(e) => { const cur = new Set(own.locked ?? []); if (e.target.checked) cur.add(p); else cur.delete(p); set('locked', cur.size ? [...cur] : undefined); }} />
                  <Lock size={13} className="text-muted" /> {t(`p_${p}`)}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-between gap-2 border-t border-border pt-4">
        <button type="button" className={btn} disabled={!Object.keys(own).length} onClick={() => onChange({})}><RotateCcw size={15} /> {t('resetField')}</button>
        <button type="button" className={primary} onClick={onClose}><Check size={16} /> {t('done')}</button>
      </div>
    </Dialog>
  );
}

const validRegex = (p: string) => { try { new RegExp(p, 'u'); return true; } catch { return false; } };
const PATTERNS = [
  { key: 'mobile', re: '^(\\+30)?69\\d{8}$', el: 'Ελληνικό κινητό (69xxxxxxxx)', en: 'Greek mobile number (69xxxxxxxx)' },
  { key: 'phone', re: '^(\\+30)?2\\d{9}$', el: 'Ελληνικό σταθερό (2xxxxxxxxx)', en: 'Greek landline (2xxxxxxxxx)' },
  { key: 'postal', re: '^\\d{3}\\s?\\d{2}$', el: 'ΤΚ με 5 ψηφία', en: '5-digit postal code' },
  { key: 'digits', re: '^\\d+$', el: 'Μόνο αριθμοί', en: 'Digits only' },
  { key: 'upper', re: '^[^a-zα-ω]*$', el: 'Μόνο κεφαλαία', en: 'Upper case only' },
  { key: 'gemi', re: '^\\d{9,12}$', el: 'Αρ. ΓΕΜΗ 9–12 ψηφία', en: 'Registry no. 9–12 digits' },
];

function TriState({ value, inherited, disabled, onChange }: { value: boolean | undefined; inherited: boolean; disabled: boolean; onChange: (v: boolean | undefined) => void }) {
  const t = useTranslations('forms');
  const cur = value === undefined ? 'inherit' : value ? 'yes' : 'no';
  return (
    <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-surface-2 p-0.5 text-xs">
      {(['inherit', 'yes', 'no'] as const).map((o) => (
        <button key={o} type="button" disabled={disabled} onClick={() => onChange(o === 'inherit' ? undefined : o === 'yes')}
          className={clsx('rounded-lg px-2 py-1.5 font-medium disabled:opacity-50', cur === o ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
          {o === 'inherit' ? t('inheritShort', { v: inherited ? t('yes') : t('no') }) : t(o)}
        </button>
      ))}
    </div>
  );
}

/** Possible values of a choice field (for defaults, allowed values and conditions). */
function useChoices(f: EffField | undefined) {
  const locale = useLocale();
  const list = f && (f.type === 'list' || f.type === 'lookup') && !f.list?.startsWith('crm_') ? (f.list as LookupList) : null;
  const lookup = useLookup((list ?? 'prefecture') as LookupList);
  const users = useQuery({ queryKey: ['users'], enabled: f?.type === 'user', queryFn: () => api<{ id: string; full_name: string }[]>('/users'), staleTime: 300_000 });
  const companies = useQuery({ queryKey: ['companies'], enabled: f?.key === 'company_id', queryFn: () => api<{ id: string; name: string }[]>('/companies') });
  const crm = useCrmMeta();
  if (!f) return null;
  if (f.choices) return f.choices.map((c) => ({ value: c.value, label: l10n(c.label, locale) || c.value }));
  if (f.list === 'crm_type') return (crm.data?.types ?? []).map((x) => ({ value: x.key, label: x.name }));
  if (f.list === 'crm_outcome') return (crm.data?.outcomes ?? []).map((x) => ({ value: x.key, label: x.name }));
  if (list) return (lookup.data ?? []).map((v) => ({ value: (ID_LISTS as readonly string[]).includes(list) ? v.id : v.name, label: v.name }));
  if (f.type === 'user') return (users.data ?? []).map((u) => ({ value: u.id, label: u.full_name }));
  if (f.type === 'country') return COUNTRIES.map((c) => ({ value: c, label: c }));
  if (f.key === 'company_id') return (companies.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  return null;
}

function DefaultEditor({ f, value, disabled, onChange }: { f: EffField; value: DefaultValue | null | undefined; disabled: boolean; onChange: (v: DefaultValue | null | undefined) => void }) {
  const t = useTranslations('forms');
  const choices = useChoices(f);
  const kind = value?.kind ?? 'none';
  const kinds = ['none', 'static', ...(f.type === 'date' ? ['today'] : []), ...(f.type === 'user' ? ['me'] : []), ...(['branch', 'space', 'contact', 'activity'].includes(f.key) || true ? ['parent'] : [])];
  const staticVal = value?.kind === 'static' ? value.value : null;
  return (
    <div className="space-y-2">
      <select className={formInput} disabled={disabled} value={kind} onChange={(e) => {
        const k = e.target.value;
        onChange(k === 'none' ? null : k === 'static' ? { kind: 'static', value: null } : k === 'today' ? { kind: 'today', days: 0 } : k === 'me' ? { kind: 'me' } : { kind: 'parent', field: '' });
      }}>
        {kinds.map((k) => <option key={k} value={k}>{t(`def_${k}`)}</option>)}
      </select>
      {value?.kind === 'static' && (
        choices ? (
          f.type === 'multiselect' ? (
            <div className="flex flex-wrap gap-1.5">
              {choices.map((c) => {
                const arr = Array.isArray(staticVal) ? staticVal : [];
                const on = arr.includes(c.value);
                return <button key={c.value} type="button" disabled={disabled} onClick={() => onChange({ kind: 'static', value: on ? arr.filter((x) => x !== c.value) : [...arr, c.value] })}
                  className={clsx('rounded-full border px-3 py-1 text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>{c.label}</button>;
              })}
            </div>
          ) : (
            <select className={formInput} disabled={disabled} value={String(staticVal ?? '')} onChange={(e) => onChange({ kind: 'static', value: e.target.value || null })}>
              <option value="">—</option>
              {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          )
        ) : f.type === 'bool' ? (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" disabled={disabled} checked={staticVal === true} onChange={(e) => onChange({ kind: 'static', value: e.target.checked })} /> {t('yes')}</label>
        ) : (
          <input className={formInput} disabled={disabled} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={staticVal === null ? '' : String(staticVal)}
            onChange={(e) => onChange({ kind: 'static', value: f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })} />
        )
      )}
      {value?.kind === 'today' && (
        <label className="flex items-center gap-2 text-sm">{t('todayPlus')}
          <input type="number" className={clsx(formInput, 'w-28')} disabled={disabled} value={value.days} onChange={(e) => onChange({ kind: 'today', days: Math.round(Number(e.target.value) || 0) })} /> {t('days')}
        </label>
      )}
      {value?.kind === 'parent' && (
        <>
          <input className={clsx(formInput, 'font-mono text-sm')} disabled={disabled} placeholder="address_city" value={value.field} onChange={(e) => onChange({ kind: 'parent', field: e.target.value.trim() })} />
          <p className="text-xs text-muted">{t('parentHint')}</p>
        </>
      )}
    </div>
  );
}

function OptionsEditor({ f, value, disabled, onChange }: { f: EffField; value: string[] | null | undefined; disabled: boolean; onChange: (v: string[] | null | undefined) => void }) {
  const t = useTranslations('forms');
  const choices = useChoices(f);
  if (!choices) return <Loader2 className="animate-spin text-muted" />;
  const all = !value?.length;
  const sel = new Set(value ?? []);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" disabled={disabled} checked={all} onChange={(e) => onChange(e.target.checked ? null : choices.map((c) => c.value))} />
        {t('allValues')}
      </label>
      {!all && (
        <div className="max-h-64 space-y-1 overflow-auto rounded-xl border border-border p-2">
          {choices.map((c) => (
            <label key={c.value} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" disabled={disabled} checked={sel.has(c.value)}
                onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(c.value); else s.delete(c.value); onChange(s.size ? [...s] : null); }} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function RulesEditor({ f, live, value, overridden, disabled, onChange, onInherit }: {
  f: EffField; live: Effective; value: Rule[]; overridden: boolean; disabled: boolean; onChange: (v: Rule[]) => void; onInherit: () => void;
}) {
  const t = useTranslations('forms');
  const locale = useLocale();
  const others = live.fields.filter((x) => x.key !== f.key);
  const upd = (i: number, patch: Partial<Rule>) => onChange(value.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{t('rulesHint')}</p>
        {overridden && <button type="button" onClick={onInherit} className="shrink-0 text-xs font-medium text-primary">{t('inherit')}</button>}
      </div>
      {value.map((r, i) => {
        const target = others.find((x) => x.key === r.field);
        return (
          <div key={i} className="space-y-2 rounded-2xl border border-border p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted">{t('when')} <span className="flex-1" />
              <button type="button" disabled={disabled} onClick={() => onChange(value.filter((_, n) => n !== i))} className="text-danger" aria-label={t('remove')}><Trash2 size={15} /></button>
            </div>
            <select className={formInput} disabled={disabled} value={r.field} onChange={(e) => upd(i, { field: e.target.value, value: '' })}>
              {others.map((x) => <option key={x.key} value={x.key}>{l10n(x.label, locale, x.baseLabel)} ({x.key})</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select className={formInput} disabled={disabled} value={r.op} onChange={(e) => upd(i, { op: e.target.value as Rule['op'] })}>
                {(['eq', 'neq', 'in', 'not_in', 'empty', 'not_empty', 'gt', 'lt'] as const).map((op) => <option key={op} value={op}>{t(`op_${op}`)}</option>)}
              </select>
              {!['empty', 'not_empty'].includes(r.op) ? <RuleValue field={target} op={r.op} value={r.value ?? ''} disabled={disabled} onChange={(v) => upd(i, { value: v })} /> : <span />}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-muted">{t('then')}</span>
              <select className={formInput} disabled={disabled} value={r.then} onChange={(e) => upd(i, { then: e.target.value as Rule['then'] })}>
                {(['show', 'hide', 'require', 'readonly'] as const).map((x) => <option key={x} value={x}>{t(`then_${x}`)}</option>)}
              </select>
            </div>
          </div>
        );
      })}
      <button type="button" className={btn} disabled={disabled || !others.length || value.length >= 20}
        onClick={() => onChange([...value, { field: others[0].key, op: 'eq', value: '', then: 'show' }])}><Plus size={15} /> {t('addRule')}</button>
    </div>
  );
}

function RuleValue({ field, op, value, disabled, onChange }: { field?: EffField; op: Rule['op']; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const t = useTranslations('forms');
  const choices = useChoices(field);
  if (choices && (op === 'eq' || op === 'neq')) {
    return (
      <select className={formInput} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    );
  }
  if (field?.type === 'bool') {
    return <select className={formInput} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}><option value="true">{t('yes')}</option><option value="false">{t('no')}</option></select>;
  }
  return <input className={formInput} disabled={disabled} value={value} placeholder={op === 'in' || op === 'not_in' ? 'A, B, C' : ''} onChange={(e) => onChange(e.target.value)} />;
}

// ============================================================ section dialog
function SectionDialog({ s, own, hasFields, onChange, onClose }: { s: Effective['sections'][number]; own: SectionCfg; hasFields: boolean; onChange: (c: SectionCfg | null) => void; onClose: () => void }) {
  const t = useTranslations('forms');
  const set = (p: keyof SectionCfg, v: unknown) => onChange({ ...own, [p]: v } as SectionCfg);
  return (
    <Dialog title={t('editSection')} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {(['el', 'en'] as const).map((lang) => (
            <label key={lang} className="block">
              <span className={small}>{t('p_label')} · {lang.toUpperCase()}</span>
              <input className={formInput} placeholder={s.baseLabel[lang] ?? ''} value={own.label?.[lang] ?? ''}
                onChange={(e) => { const cur = { ...(own.label ?? {}), [lang]: e.target.value || undefined }; set('label', Object.values(cur).some(Boolean) ? cur : undefined); }} />
            </label>
          ))}
        </div>
        <label className="block">
          <span className={small}>{t('tab')}</span>
          <input className={formInput} placeholder={t('tabPlaceholder')} value={own.tab ?? s.tab ?? ''} onChange={(e) => set('tab', e.target.value.trim() ? e.target.value : null)} />
          <span className="mt-1 block text-xs text-muted">{t('tabHint')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={own.collapsed ?? s.collapsed} onChange={(e) => set('collapsed', e.target.checked)} /> {t('collapsedHint')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={own.hidden ?? s.hidden} onChange={(e) => set('hidden', e.target.checked)} /> {t('hideSectionHint')}
        </label>
        <div className="flex justify-between gap-2 border-t border-border pt-4">
          {s.custom ? (
            <button type="button" className={clsx(btn, 'text-danger')} disabled={hasFields} title={hasFields ? t('sectionNotEmpty') : undefined}
              onClick={() => { onChange(null); onClose(); }}><Trash2 size={15} /> {t('deleteSection')}</button>
          ) : <button type="button" className={btn} disabled={!Object.keys(own).length} onClick={() => onChange(null)}><RotateCcw size={15} /> {t('resetField')}</button>}
          <button type="button" className={primary} onClick={onClose}><Check size={16} /> {t('done')}</button>
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================ custom fields
const CF_TYPES = ['text', 'textarea', 'number', 'date', 'bool', 'select', 'multiselect', 'email', 'url', 'phone'] as const;

function CustomFieldsDialog({ form, onClose }: { form: FormKey; onClose: () => void }) {
  const t = useTranslations('forms');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['settings', 'custom-fields', form], queryFn: () => api<CustomField[]>(`/settings/custom-fields?form=${form}`) });
  const [edit, setEdit] = useState<CustomField | 'new' | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['form-config'] }); };
  const move = async (i: number, dir: -1 | 1) => {
    const ids = (list.data ?? []).map((c) => c.id);
    const j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('/settings/custom-fields-order', { method: 'PUT', json: { ids } }); refresh();
  };
  const remove = async (c: CustomField) => {
    if (!(await appConfirm(t('cfDeleteConfirm', { name: l10n(c.label, locale) }), { danger: true }))) return;
    const purge = await appConfirm(t('cfPurgeConfirm'), { danger: true, confirmLabel: t('cfPurge') });
    const r = await api<{ purged: number }>(`/settings/custom-fields/${c.id}?purge=${purge ? 1 : 0}`, { method: 'DELETE' });
    toast({ title: t('cfDeleted'), body: purge ? t('cfPurged', { n: r.purged }) : undefined }); refresh();
  };
  return (
    <Dialog title={t('customFields')} onClose={onClose}>
      {edit ? <CustomFieldForm form={form} cf={edit === 'new' ? null : edit} onDone={() => { setEdit(null); refresh(); }} /> : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('cfHint')}</p>
          {!list.data ? <Loader2 className="mx-auto animate-spin text-muted" /> : !list.data.length ? <p className="py-4 text-center text-sm text-muted">{t('cfEmpty')}</p> : (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {list.data.map((c, i) => (
                <li key={c.id} className={clsx('flex items-center gap-2 px-3 py-2.5', !c.active && 'opacity-60')}>
                  <div className="flex flex-col">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-muted disabled:opacity-20" aria-label={t('moveUp')}><ArrowUp size={14} /></button>
                    <button type="button" disabled={i === list.data!.length - 1} onClick={() => move(i, 1)} className="text-muted disabled:opacity-20" aria-label={t('moveDown')}><ArrowDown size={14} /></button>
                  </div>
                  <button type="button" onClick={() => setEdit(c)} className="min-w-0 flex-1 text-left">
                    <div className="truncate font-medium">{l10n(c.label, locale)}</div>
                    <div className="flex flex-wrap gap-1"><code className="text-[11px] text-muted">cf_{c.key}</code><Chip>{t(`type_${c.type}`)}</Chip>{!c.active && <Chip tone="warning">{t('inactive')}</Chip>}</div>
                  </button>
                  <button type="button" onClick={() => remove(c)} className="grid h-8 w-8 place-items-center rounded-lg text-danger hover:bg-danger-soft" aria-label={t('remove')}><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={primary} onClick={() => setEdit('new')}><Plus size={16} /> {t('cfAdd')}</button>
        </div>
      )}
    </Dialog>
  );
}

function CustomFieldForm({ form, cf, onDone }: { form: FormKey; cf: CustomField | null; onDone: () => void }) {
  const t = useTranslations('forms');
  const toast = useToast();
  const [v, setV] = useState({
    el: cf?.label.el ?? '', en: cf?.label.en ?? '', key: cf?.key ?? '', type: cf?.type ?? 'text',
    options: (cf?.options ?? []).join('\n'), active: cf?.active ?? true, filterable: cf?.filterable ?? true,
  });
  const [keyTouched, setKeyTouched] = useState(!!cf);
  const autoKey = (label: string) => { let k = phonetic(label).replace(/8/g, 'th').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 39); if (k && !/^[a-z]/.test(k)) k = `f_${k}`; return k; };
  const save = useMutation({
    mutationFn: () => {
      const options = v.options.split('\n').map((x) => x.trim()).filter(Boolean);
      const label = { el: v.el.trim() || undefined, en: v.en.trim() || undefined };
      return cf
        ? api(`/settings/custom-fields/${cf.id}`, { method: 'PUT', json: { label, options, active: v.active, filterable: v.filterable } })
        : api('/settings/custom-fields', { method: 'POST', json: { form, key: v.key, type: v.type, label, options, filterable: v.filterable } });
    },
    onSuccess: () => { toast({ title: t('saved') }); onDone(); },
    onError: (e) => toast({ title: e instanceof ApiError ? (t.has(`cfErr_${e.code}`) ? t(`cfErr_${e.code}` as never) : e.code) : t('saveError') }),
  });
  const needsOptions = v.type === 'select' || v.type === 'multiselect';
  const keyOk = /^[a-z][a-z0-9_]{1,39}$/.test(v.key);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className={small}>{t('p_label')} · EL</span>
          <input className={formInput} required={!v.en} value={v.el} autoFocus onChange={(e) => { const el = e.target.value; setV((x) => ({ ...x, el, key: keyTouched ? x.key : autoKey(el) })); }} /></label>
        <label className="block"><span className={small}>{t('p_label')} · EN</span>
          <input className={formInput} value={v.en} onChange={(e) => setV((x) => ({ ...x, en: e.target.value }))} /></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className={small}>{t('cfKey')}</span>
          <input className={clsx(formInput, 'font-mono text-sm')} disabled={!!cf} value={v.key} aria-invalid={!!v.key && !keyOk}
            onChange={(e) => { setKeyTouched(true); setV((x) => ({ ...x, key: e.target.value.toLowerCase() })); }} />
          <span className="mt-1 block text-xs text-muted">{t('cfKeyHint')}</span></label>
        <label className="block"><span className={small}>{t('cfType')}</span>
          <select className={formInput} disabled={!!cf} value={v.type} onChange={(e) => setV((x) => ({ ...x, type: e.target.value }))}>
            {CF_TYPES.map((x) => <option key={x} value={x}>{t(`type_${x}`)}</option>)}
          </select></label>
      </div>
      {needsOptions && (
        <label className="block"><span className={small}>{t('cfOptions')}</span>
          <textarea rows={5} className={formInput} value={v.options} placeholder={'A\nB\nC'} onChange={(e) => setV((x) => ({ ...x, options: e.target.value }))} /></label>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.filterable} onChange={(e) => setV((x) => ({ ...x, filterable: e.target.checked }))} /> {t('cfFilterable')}</label>
      {cf && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.active} onChange={(e) => setV((x) => ({ ...x, active: e.target.checked }))} /> {t('cfActive')}</label>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className={btn} onClick={onDone}>{t('cancel')}</button>
        <button className={primary} disabled={save.isPending || !keyOk || !(v.el.trim() || v.en.trim()) || (needsOptions && !v.options.trim())}>
          {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}
        </button>
      </div>
    </form>
  );
}

// ============================================================ history / export / import
function HistoryDialog({ form, scope, levelKey, onClose }: { form: FormKey; scope: Scope; levelKey: string; onClose: () => void }) {
  const t = useTranslations('forms');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['settings', 'forms-history', form, scope, levelKey],
    queryFn: () => api<{ id: string; version: number; note: string | null; created_at: string; created_by_name: string | null; changes: number }[]>(`/settings/forms/${form}/history?scope=${scope}&key=${encodeURIComponent(levelKey)}`),
  });
  const restore = async (id: string, v: number) => {
    if (!(await appConfirm(t('restoreConfirm', { v })))) return;
    await api(`/settings/forms/history/${id}/restore`, { method: 'POST' });
    toast({ title: t('restored') });
    qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['form-config'] });
    onClose();
  };
  return (
    <Dialog title={t('history')} onClose={onClose}>
      {!list.data ? <Loader2 className="mx-auto animate-spin text-muted" /> : !list.data.length ? <p className="py-6 text-center text-sm text-muted">{t('historyEmpty')}</p> : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {list.data.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-xs font-bold text-primary">v{h.version}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{h.note || t('changesCount', { n: h.changes })}</div>
                <div className="truncate text-xs text-muted">{new Date(h.created_at).toLocaleString(locale)} · {h.created_by_name ?? '—'}</div>
              </div>
              <button type="button" className={btn} onClick={() => restore(h.id, h.version)}><RotateCcw size={14} /> {t('restore')}</button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{t('historyHint')}</p>
    </Dialog>
  );
}

function ExportImport({ onImport }: { onImport: () => void }) {
  const t = useTranslations('forms');
  const [open, setOpen] = useState(false);
  const exportAll = async () => {
    setOpen(false);
    const data = await api<unknown>('/settings/forms-export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `softifyos-forms-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="relative">
      <button type="button" className={btn} onClick={() => setOpen((o) => !o)} aria-expanded={open}><FileInput size={15} /> {t('exportImport')} <ChevronDown size={14} /></button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <button type="button" onClick={exportAll} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2"><Download size={15} /> {t('export')}</button>
          <button type="button" onClick={() => { setOpen(false); onImport(); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2"><Upload size={15} /> {t('import')}</button>
        </div>
      )}
    </div>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('forms');
  const toast = useToast();
  const qc = useQueryClient();
  const [data, setData] = useState<{ configs: unknown[]; custom_fields: unknown[] } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api<{ fields: number; configs: number; skipped: number }>('/settings/forms-import', { method: 'POST', json: { mode, data } }),
    onSuccess: (r) => {
      toast({ title: t('imported'), body: t('importResult', { configs: r.configs, fields: r.fields, skipped: r.skipped }) });
      qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['form-config'] }); onClose();
    },
    onError: () => setErr(t('importError')),
  });
  return (
    <Dialog title={t('import')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('importHint')}</p>
        <input type="file" accept="application/json,.json" className="block w-full text-sm" onChange={async (e) => {
          setErr(null); setData(null);
          const file = e.target.files?.[0]; if (!file) return;
          try {
            const j = JSON.parse(await file.text());
            if (j?.format !== 'softifyos.forms') throw new Error('format');
            setData(j);
          } catch { setErr(t('importBadFile')); }
        }} />
        {data && <p className="rounded-xl bg-surface-2 p-3 text-sm">{t('importPreview', { configs: data.configs.length, fields: data.custom_fields.length })}</p>}
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
          {(['merge', 'replace'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={clsx('rounded-xl py-2 text-sm font-medium', mode === m ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{t(`mode_${m}`)}</button>
          ))}
        </div>
        <p className="text-xs text-muted">{t(`modeHint_${mode}`)}</p>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className={btn} onClick={onClose}>{t('cancel')}</button>
          <button type="button" className={primary} disabled={!data || run.isPending} onClick={() => run.mutate()}>{run.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {t('import')}</button>
        </div>
      </div>
    </Dialog>
  );
}
