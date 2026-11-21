'use client';
// CRM activity editor (create / edit / log), completion with outcome + follow-up, and a customer picker.
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Building, Check, CheckCircle2, Loader2, Repeat, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { api, ApiError, type Customer, type Page } from '@/lib/api';
import {
  daysFromNow, fromLocalInput, iconOf, toLocalInput, tone, useCrmMeta, useCrmRefresh, type ActivityDetail, type ActivityStatus, type Recurrence,
} from '@/lib/crm';
import { flatValues, useFormConfig, validateForm, type Effective } from '@/lib/forms';
import { Dialog } from './customer-dialogs';
import { appConfirm } from './confirm';
import { useToast } from './providers';
import { FormFields, FormLoading, scrollToError, useFormDefaults, type RendererEntry } from './form-engine';

type Links = { branches: { id: string; name: string; city: string | null }[]; contacts: { id: string; full_name: string; role_title: string | null; is_primary: boolean }[];
  offers: { id: string; number: string; status: string }[] };
export type EditorPreset = {
  type?: string; status?: ActivityStatus; customer_id?: string | null; customer_name?: string | null; branch_id?: string | null;
  contact_id?: string | null; offer_id?: string | null; due_at?: string | null; subject?: string;
};
type V = {
  type: string; subject: string; body: string; status: ActivityStatus; priority: string; due_at: string; duration_min: string; all_day: boolean;
  location: string; owner_id: string; remind_before_min: string; customer_id: string | null; customer_name: string | null;
  branch_id: string | null; contact_id: string | null; offer_id: string | null; outcome: string; outcome_note: string;
  ends_at: string; requested_by: string; characterization: string; erp_status: string;
};

const REMINDERS = [null, 0, 5, 15, 30, 60, 120, 1440, 2880] as const;

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

/** Create, log or edit an activity. `id` = edit. */
export function ActivityEditor({ id, preset, onClose, onSaved }: { id?: string; preset?: EditorPreset; onClose: () => void; onSaved?: (id: string) => void }) {
  const detail = useQuery({ queryKey: ['crm', 'activity', id], enabled: !!id, queryFn: () => api<ActivityDetail>(`/crm/activities/${id}`) });
  if (id && !detail.data) return <Dialog title="…" onClose={onClose}><FormLoading error={detail.isError} onRetry={() => detail.refetch()} /></Dialog>;
  return <EditorBody key={id ?? 'new'} a={detail.data} preset={preset} onClose={onClose} onSaved={onSaved} />;
}

function EditorBody({ a, preset, onClose, onSaved }: { a?: ActivityDetail; preset?: EditorPreset; onClose: () => void; onSaved?: (id: string) => void }) {
  const t = useTranslations('crm');
  const locale = useLocale();
  const toast = useToast();
  const refresh = useCrmRefresh();
  const meta = useCrmMeta();
  const cfg = useFormConfig('activity');
  const creating = !a;
  const logMode = creating && preset?.status === 'done';
  const [v, setV] = useState<V>(() => ({
    type: a?.type ?? preset?.type ?? 'call', subject: a?.subject ?? preset?.subject ?? '', body: a?.body ?? '',
    status: a?.status ?? preset?.status ?? 'planned', priority: String(a?.priority ?? 2),
    due_at: toLocalInput(a ? a.due_at : preset?.due_at ?? (logMode ? new Date() : daysFromNow(1, 10))),
    duration_min: a ? String(a.duration_min || '') : '', all_day: a?.all_day ?? false, location: a?.location ?? '',
    owner_id: a?.owner_id ?? '', remind_before_min: a?.remind_before_min == null ? '' : String(a.remind_before_min),
    customer_id: a?.customer_id ?? preset?.customer_id ?? null, customer_name: a?.customer_name ?? preset?.customer_name ?? null,
    branch_id: a?.branch_id ?? preset?.branch_id ?? null, contact_id: a?.contact_id ?? preset?.contact_id ?? null, offer_id: a?.offer_id ?? preset?.offer_id ?? null,
    outcome: a?.outcome ?? '', outcome_note: a?.outcome_note ?? '',
    ends_at: toLocalInput(a?.ends_at ?? null), requested_by: a?.requested_by ?? '', characterization: a?.characterization ?? '', erp_status: a?.erp_status ?? '',
  }));
  const [custom, setCustom] = useState<Record<string, unknown>>(a?.custom ?? {});
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  useEffect(() => { if (meta.data && !v.owner_id && creating) setV((x) => ({ ...x, owner_id: meta.data!.me })); }, [meta.data, v.owner_id, creating]);
  const links = useQuery({ queryKey: ['crm', 'links', v.customer_id], enabled: !!v.customer_id, queryFn: () => api<Links>(`/crm/links/${v.customer_id}`) });
  const set = <K extends keyof V>(k: K, val: V[K]) => setV((x) => ({ ...x, [k]: val }));

  const values = useMemo(() => flatValues({ ...v, priority: v.priority, due_at: v.due_at || null } as unknown as Record<string, unknown>, custom), [v, custom]);
  useFormDefaults(cfg.data, creating, values, (patch) => {
    for (const [k, val] of Object.entries(patch)) {
      if (k.startsWith('cf_')) setCustom((x) => ({ ...x, [k.slice(3)]: val }));
      else if (k === 'due_at') set('due_at', toLocalInput(String(val).length === 10 ? `${val}T09:00` : String(val)));
      else if (k in v) setV((x) => ({ ...x, [k]: typeof val === 'number' ? String(val) : val }));
    }
  }, { userId: meta.data?.me });

  // ERP lists (Soft1 characterisation / status): only the active ones, plus the current value
  const erpValues = meta.data?.erp_values ?? [];
  const charList = erpValues.filter((x) => x.kind === 'characterization' && ((x.active && (!x.types?.length || x.types.includes(v.type))) || x.code === v.characterization));
  const statusList = erpValues.filter((x) => x.kind === 'status' && (x.active || x.code === v.erp_status));
  /** The ERP status (or, without one, the characterisation) decides the core status: show it at once. */
  const pickErp = (k: 'characterization' | 'erp_status', code: string) => setV((x) => {
    const next = { ...x, [k]: code };
    const st = erpValues.find((e) => e.kind === 'status' && e.code === next.erp_status)?.maps_to
      ?? (!next.erp_status ? erpValues.find((e) => e.kind === 'characterization' && e.code === next.characterization)?.maps_to : null);
    return st ? { ...next, status: st } : next;
  });

  // The "Outcome" section only makes sense once the activity is done
  const eff: Effective | undefined = useMemo(() => cfg.data && ({
    ...cfg.data, sections: cfg.data.sections.map((s) => (s.key === 'result' && v.status !== 'done' ? { ...s, hidden: true } : s)),
    fields: cfg.data.fields.map((f) => ((f.key === 'characterization' && !charList.length) || (f.key === 'erp_status' && !statusList.length) ? { ...f, hidden: true } : f)),
  }), [cfg.data, v.status, charList.length, statusList.length]);

  const types = (meta.data?.types ?? []).filter((x) => x.active || x.key === v.type);
  const typeOf = types.find((x) => x.key === v.type);
  const pickType = (k: string) => setV((x) => {
    const ty = meta.data?.types.find((y) => y.key === k);
    return { ...x, type: k, duration_min: x.duration_min || (ty?.default_duration ? String(ty.default_duration) : ''), subject: x.subject };
  });
  const applyTemplate = (tid: string) => {
    const tp = meta.data?.templates.find((x) => x.id === tid);
    if (!tp) return;
    setV((x) => ({
      ...x, type: tp.type, subject: tp.subject, body: tp.body ?? x.body, priority: String(tp.priority), duration_min: tp.duration_min ? String(tp.duration_min) : x.duration_min,
      due_at: tp.due_in_days != null && !logMode ? toLocalInput(daysFromNow(tp.due_in_days, 10)) : x.due_at,
      remind_before_min: tp.remind_before_min == null ? x.remind_before_min : String(tp.remind_before_min),
    }));
  };

  const save = useMutation({
    mutationFn: async (apply: 'one' | 'following') => {
      const body = {
        type: v.type, subject: v.subject.trim(), body: v.body || null, status: v.status, priority: Number(v.priority),
        due_at: fromLocalInput(v.due_at), duration_min: Number(v.duration_min || 0), all_day: v.all_day, location: v.location || null,
        owner_id: v.owner_id || null, remind_before_min: v.remind_before_min === '' ? null : Number(v.remind_before_min),
        customer_id: v.customer_id, branch_id: v.branch_id, contact_id: v.contact_id, offer_id: v.offer_id,
        outcome: v.status === 'done' ? v.outcome || null : null, outcome_note: v.status === 'done' ? v.outcome_note || null : null,
        recurrence: creating && v.status !== 'done' ? recurrence : null, custom,
        ends_at: fromLocalInput(v.ends_at), requested_by: v.requested_by || null, characterization: v.characterization || null, erp_status: v.erp_status || null,
      };
      if (a) { await api(`/crm/activities/${a.id}?apply=${apply}`, { method: 'PUT', json: body }); return a.id; }
      return (await api<{ id: string; created: number }>('/crm/activities', { method: 'POST', json: body })).id;
    },
    onSuccess: (newId) => { refresh(); toast({ title: t('saved') }); onSaved?.(newId); onClose(); },
    onError: (e) => {
      const fields = e instanceof ApiError ? (e.body as { fields?: Record<string, string> })?.fields : undefined;
      if (fields) { setErrors(fields); scrollToError(); return; }
      toast({ title: t('saveError'), body: e instanceof ApiError ? (t.has(`err_${e.code}`) ? t(`err_${e.code}` as never) : e.code) : undefined });
    },
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = cfg.data ? validateForm(cfg.data, values) : {};
    if (!v.subject.trim()) errs.subject = 'required';
    setErrors(errs);
    if (Object.keys(errs).length) { scrollToError(); return; }
    let apply: 'one' | 'following' = 'one';
    if (a?.series_id && a.series.length > 1) apply = (await appConfirm(t('applyFollowing'), { confirmLabel: t('applyFollowingYes') })) ? 'following' : 'one';
    save.mutate(apply);
  };
  const remove = async () => {
    if (!a) return;
    let series = 'one';
    if (a.series_id && a.series.length > 1) series = (await appConfirm(t('deleteFollowing'), { danger: true, confirmLabel: t('deleteFollowingYes') })) ? 'following' : 'one';
    if (series === 'one' && !(await appConfirm(t('deleteConfirm'), { danger: true }))) return;
    await api(`/crm/activities/${a.id}?series=${series}`, { method: 'DELETE' });
    refresh(); toast({ title: t('deleted') }); onClose();
  };
  const reopen = async () => { if (!a) return; await api(`/crm/activities/${a.id}/reopen`, { method: 'POST' }); refresh(); onClose(); };

  const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none focus:border-primary aria-[invalid=true]:border-danger';
  const users = meta.data?.users ?? [];
  const renderers: Record<string, RendererEntry> = {
    type: { bare: true, render: (c) => (
      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">{c.label}{c.required && <span className="text-danger">*</span>}</div>
        <div role="radiogroup" aria-label={c.label} className="flex flex-wrap justify-center gap-1 rounded-2xl bg-surface-2 p-1">
          {types.filter((x) => !c.allowed || c.allowed.includes(x.key) || x.key === v.type).map((x) => {
            const Icon = iconOf(x.icon);
            return (
              <button key={x.key} type="button" role="radio" aria-checked={v.type === x.key} disabled={c.readonly} onClick={() => pickType(x.key)}
                className={clsx('flex w-[calc((100%-0.75rem)/4)] min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold leading-tight transition sm:w-[calc((100%-1.75rem)/8)]',
                  v.type === x.key ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
                <Icon size={18} className="shrink-0" /><span className="w-full truncate text-center">{x.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    ) },
    subject: (c) => <input id={c.id} autoFocus={creating} className={c.className} placeholder={c.placeholder || typeOf?.name} aria-invalid={c.invalid} value={v.subject} maxLength={200} onChange={(e) => set('subject', e.target.value)} />,
    body: (c) => <textarea id={c.id} rows={3} className={clsx(c.className, 'resize-y')} placeholder={c.placeholder} aria-invalid={c.invalid} value={v.body} onChange={(e) => set('body', e.target.value)} />,
    status: (c) => (
      <select id={c.id} className={c.className} value={v.status} onChange={(e) => set('status', e.target.value as ActivityStatus)}>
        {(['planned', 'in_progress', 'done', 'cancelled'] as const).filter((s) => !c.allowed || c.allowed.includes(s) || s === v.status).map((s) => <option key={s} value={s}>{t(`st_${s}`)}</option>)}
      </select>
    ),
    priority: (c) => (
      <select id={c.id} className={c.className} value={v.priority} onChange={(e) => set('priority', e.target.value)}>
        {['1', '2', '3'].filter((p) => !c.allowed || c.allowed.includes(p) || p === v.priority).map((p) => <option key={p} value={p}>{t(`prio_${p}`)}</option>)}
      </select>
    ),
    due_at: (c) => (
      <div className="space-y-1.5">
        <input id={c.id} type={v.all_day ? 'date' : 'datetime-local'} className={c.className} aria-invalid={c.invalid}
          value={v.all_day ? v.due_at.slice(0, 10) : v.due_at} onChange={(e) => set('due_at', v.all_day ? (e.target.value ? `${e.target.value}T09:00` : '') : e.target.value)} />
        <div className="flex flex-wrap items-center gap-1">
          {!logMode && [[0, 'today'], [1, 'tomorrow'], [3, 'in3'], [7, 'in7']].map(([n, k]) => (
            <button key={k} type="button" onClick={() => set('due_at', toLocalInput(daysFromNow(n as number, v.due_at ? new Date(v.due_at).getHours() : 10, v.due_at ? new Date(v.due_at).getMinutes() : 0)))}
              className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-surface-2">{t(`q_${k}`)}</button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-xs text-muted"><input type="checkbox" className="accent-[var(--primary)]" checked={v.all_day} onChange={(e) => set('all_day', e.target.checked)} /> {t('allDay')}</label>
        </div>
      </div>
    ),
    ends_at: (c) => <input id={c.id} type="datetime-local" className={c.className} aria-invalid={c.invalid} min={v.due_at || undefined} value={v.ends_at} onChange={(e) => set('ends_at', e.target.value)} />,
    requested_by: (c) => (
      <select id={c.id} className={c.className} value={v.requested_by} onChange={(e) => set('requested_by', e.target.value)}>
        <option value="">{t('none')}</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
    ),
    characterization: (c) => (
      <select id={c.id} className={c.className} value={v.characterization} onChange={(e) => pickErp('characterization', e.target.value)}>
        <option value="">{t('none')}</option>
        {charList.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
      </select>
    ),
    erp_status: (c) => (
      <select id={c.id} className={c.className} value={v.erp_status} onChange={(e) => pickErp('erp_status', e.target.value)}>
        <option value="">{t('none')}</option>
        {statusList.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
      </select>
    ),
    duration_min: (c) => <input id={c.id} type="number" min={0} step={5} className={clsx(c.className, 'tabular')} aria-invalid={c.invalid} placeholder="0" value={v.duration_min} onChange={(e) => set('duration_min', e.target.value)} />,
    owner_id: (c) => (
      <select id={c.id} className={c.className} value={v.owner_id} disabled={!meta.data?.can.all && !!v.owner_id && v.owner_id !== meta.data?.me} onChange={(e) => set('owner_id', e.target.value)}>
        {users.filter((u) => meta.data?.can.all || u.id === meta.data?.me || u.id === v.owner_id).filter((u) => !c.allowed || c.allowed.includes(u.id) || u.id === v.owner_id)
          .map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
    ),
    remind_before_min: (c) => (
      <select id={c.id} className={c.className} value={v.remind_before_min} onChange={(e) => set('remind_before_min', e.target.value)}>
        {REMINDERS.map((m) => <option key={String(m)} value={m === null ? '' : String(m)}>{m === null ? t('noReminder') : m === 0 ? t('atTime') : m < 60 ? t('minBefore', { n: m }) : m < 1440 ? t('hoursBefore', { n: m / 60 }) : t('daysBefore', { n: m / 1440 })}</option>)}
      </select>
    ),
    location: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.location} onChange={(e) => set('location', e.target.value)} />,
    customer_id: (c) => (
      <CustomerPicker value={v.customer_id ? { id: v.customer_id, name: v.customer_name ?? '' } : null} disabled={c.readonly}
        onChange={(p) => setV((x) => ({ ...x, customer_id: p?.id ?? null, customer_name: p?.name ?? null, branch_id: null, contact_id: null, offer_id: null }))} />
    ),
    branch_id: (c) => (
      <select id={c.id} className={c.className} value={v.branch_id ?? ''} disabled={!v.customer_id} onChange={(e) => set('branch_id', e.target.value || null)}>
        <option value="">{t('none')}</option>
        {links.data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.city ? ` · ${b.city}` : ''}</option>)}
      </select>
    ),
    contact_id: (c) => (
      <select id={c.id} className={c.className} value={v.contact_id ?? ''} disabled={!v.customer_id} onChange={(e) => set('contact_id', e.target.value || null)}>
        <option value="">{t('none')}</option>
        {links.data?.contacts.map((x) => <option key={x.id} value={x.id}>{x.full_name}{x.role_title ? ` · ${x.role_title}` : ''}</option>)}
      </select>
    ),
    offer_id: (c) => (
      <select id={c.id} className={c.className} value={v.offer_id ?? ''} disabled={!v.customer_id} onChange={(e) => set('offer_id', e.target.value || null)}>
        <option value="">{t('none')}</option>
        {links.data?.offers.map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}
      </select>
    ),
    outcome: (c) => <OutcomePicker value={v.outcome} allowed={c.allowed} onChange={(x) => set('outcome', x)} />,
    outcome_note: (c) => <textarea id={c.id} rows={2} className={c.className} placeholder={c.placeholder} value={v.outcome_note} onChange={(e) => set('outcome_note', e.target.value)} />,
  };

  const title = a ? t('editTitle') : logMode ? t('logTitle') : t('newTitle');
  return (
    <Dialog title={title} onClose={onClose} wide>
      {completing && a && <CompleteDialog activity={a} onClose={() => setCompleting(false)} onDone={() => { setCompleting(false); onClose(); }} />}
      <form noValidate onSubmit={submit} className="space-y-3">
        {a && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className={clsx('rounded-md px-2 py-0.5 font-semibold', a.status === 'done' ? 'bg-success-soft text-success' : a.overdue ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted')}>
              {a.overdue ? t('overdue') : t(`st_${a.status}`)}
            </span>
            {a.series_id && <span className="flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 font-semibold text-primary"><Repeat size={11} /> {t('seriesN', { n: a.series.length })}</span>}
            {a.rule_id && <span className="rounded-md bg-info-soft px-2 py-0.5 font-semibold text-info">{t('auto')}</span>}
            {a.created_by_name && <span className="text-muted">{t('createdBy', { name: a.created_by_name })}</span>}
            {a.erp_code && <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono font-semibold">{a.erp_code}</span>}
            {a.erp_state && <ErpBadge state={a.erp_state} error={a.erp_error} />}
          </div>
        )}
        {creating && !!meta.data?.templates.length && (
          <select className={clsx(input, 'py-2 text-sm')} defaultValue="" onChange={(e) => applyTemplate(e.target.value)} aria-label={t('template')}>
            <option value="">{t('fromTemplate')}</option>
            {meta.data.templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
          </select>
        )}
        {eff && meta.data ? (
          <FormFields eff={eff} values={values} errors={errors} renderers={renderers} variant="plain" idPrefix="act"
            onChange={(k, val) => (k.startsWith('cf_') ? setCustom((x) => ({ ...x, [k.slice(3)]: val })) : setV((x) => ({ ...x, [k]: val })))}
            sectionExtras={creating && v.status !== 'done' ? { when: <RecurrenceEditor key="rec" value={recurrence} onChange={setRecurrence} /> } : undefined} />
        ) : <FormLoading error={cfg.isError || meta.isError} onRetry={() => { cfg.refetch(); meta.refetch(); }} />}
        {a && (a.follow_ups.length > 0 || a.parent_id) && (
          <div className="rounded-xl bg-surface-2 p-3 text-xs text-muted">
            {a.parent_id && <div>{t('isFollowUp')}</div>}
            {a.follow_ups.map((f) => <div key={f.id}>↳ {f.subject} · {t(`st_${f.status}`)}</div>)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {a?.can_edit && <button type="button" onClick={remove} className="grid h-10 w-10 place-items-center rounded-xl text-danger hover:bg-danger-soft" aria-label={t('delete')}><Trash2 size={18} /></button>}
          {a?.can_edit && a.status === 'done' && <button type="button" onClick={reopen} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium"><RotateCcw size={15} /> {t('reopen')}</button>}
          {a?.can_edit && (a.status === 'planned' || a.status === 'in_progress') && (
            <button type="button" onClick={() => setCompleting(true)} className="flex items-center gap-1.5 rounded-xl bg-success-soft px-3 py-2 text-sm font-semibold text-success"><CheckCircle2 size={16} /> {t('complete')}</button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('cancel')}</button>
          {(!a || a.can_edit) && (
            <button disabled={save.isPending || !cfg.data} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

export function RecurrenceEditor({ value, onChange }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void }) {
  const t = useTranslations('crm');
  const input = 'min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';
  return (
    <div className="space-y-2 sm:col-span-6">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={!!value} onChange={(e) => onChange(e.target.checked ? { freq: 'weekly', interval: 1, count: 4 } : null)} />
        <Repeat size={15} className="text-muted" /> {t('repeat')}
      </label>
      {value && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-2 text-sm">
          {t('every')}
          <input type="number" min={1} max={30} className={clsx(input, 'w-16 bg-surface')} value={value.interval} onChange={(e) => onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })} />
          <select className={clsx(input, 'bg-surface')} value={value.freq} onChange={(e) => onChange({ ...value, freq: e.target.value as Recurrence['freq'] })}>
            {(['daily', 'weekly', 'monthly'] as const).map((f) => <option key={f} value={f}>{t(`freq_${f}`)}</option>)}
          </select>
          {t('times')}
          <input type="number" min={2} max={100} className={clsx(input, 'w-16 bg-surface')} value={value.count ?? ''} placeholder="∞"
            onChange={(e) => onChange({ ...value, count: e.target.value ? Math.min(100, Math.max(2, Number(e.target.value))) : undefined })} />
          <span className="text-xs text-muted">{t('repeatHint')}</span>
        </div>
      )}
    </div>
  );
}

function OutcomePicker({ value, onChange, allowed }: { value: string; onChange: (v: string) => void; allowed?: string[] | null }) {
  const meta = useCrmMeta();
  return (
    <div className="flex flex-wrap gap-1.5">
      {(meta.data?.outcomes ?? []).filter((o) => (o.active && (!allowed || allowed.includes(o.key))) || o.key === value).map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(value === o.key ? '' : o.key)}
          className={clsx('rounded-full border px-3 py-1.5 text-sm transition', value === o.key ? `${tone(o.color)} border-transparent font-semibold` : 'border-border hover:bg-surface-2')}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

/** Mark done: outcome, note, real duration, and the next step (follow-up). */
export function CompleteDialog({ activity: a, onClose, onDone }: { activity: Pick<ActivityDetail, 'id' | 'subject' | 'type' | 'duration_min' | 'owner_id' | 'customer_name'>; onClose: () => void; onDone?: () => void }) {
  const t = useTranslations('crm');
  const toast = useToast();
  const refresh = useCrmRefresh();
  const meta = useCrmMeta();
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState(a.duration_min ? String(a.duration_min) : '');
  const [fu, setFu] = useState(false);
  const [fuType, setFuType] = useState(a.type);
  const [fuSubject, setFuSubject] = useState(`${t('followUpPrefix')} ${a.subject}`.slice(0, 200));
  const [fuDue, setFuDue] = useState(toLocalInput(daysFromNow(3, 10)));
  const [fuOwner, setFuOwner] = useState(a.owner_id ?? '');
  // "Call back" outcomes suggest a follow-up
  useEffect(() => { if (outcome === 'callback' || outcome === 'no_answer' || outcome === 'meeting_booked') setFu(true); }, [outcome]);
  const run = useMutation({
    mutationFn: () => api<{ follow_up_id: string | null }>(`/crm/activities/${a.id}/complete`, { method: 'POST', json: {
      outcome: outcome || null, outcome_note: note || null, duration_min: duration ? Number(duration) : undefined,
      follow_up: fu ? { type: fuType, subject: fuSubject.trim() || a.subject, due_at: fromLocalInput(fuDue), owner_id: fuOwner || null } : null,
    } }),
    onSuccess: (r) => { refresh(); toast({ title: t('completed'), body: r.follow_up_id ? t('followUpCreated') : undefined }); onDone?.(); },
    onError: () => toast({ title: t('saveError') }),
  });
  const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none focus:border-primary';
  return (
    <Dialog title={t('completeTitle')} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">{a.subject}{a.customer_name ? ` · ${a.customer_name}` : ''}</p>
        <div><div className="mb-1.5 text-xs font-medium text-muted">{t('outcome')}</div><OutcomePicker value={outcome} onChange={setOutcome} /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{t('outcomeNote')}</span>
            <textarea rows={2} className={input} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{t('durationMin')}</span>
            <input type="number" min={0} className={clsx(input, 'tabular')} value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        </div>
        <div className="rounded-2xl border border-border p-3">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={fu} onChange={(e) => setFu(e.target.checked)} /> {t('nextStep')}
          </label>
          {fu && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
                <select className={input} value={fuType} onChange={(e) => setFuType(e.target.value)}>
                  {(meta.data?.types ?? []).filter((x) => x.active).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                </select>
                <input className={input} value={fuSubject} maxLength={200} onChange={(e) => setFuSubject(e.target.value)} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[[1, 'tomorrow'], [3, 'in3'], [7, 'in7'], [14, 'in14'], [30, 'in30']].map(([n, k]) => (
                  <button key={k} type="button" onClick={() => setFuDue(toLocalInput(daysFromNow(n as number, 10)))}
                    className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-2">{t(`q_${k}`)}</button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input type="datetime-local" className={input} value={fuDue} onChange={(e) => setFuDue(e.target.value)} />
                <select className={input} value={fuOwner} onChange={(e) => setFuOwner(e.target.value)}>
                  {(meta.data?.users ?? []).filter((u) => meta.data?.can.all || u.id === meta.data?.me || u.id === a.owner_id).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('cancel')}</button>
          <button type="button" disabled={run.isPending} onClick={() => run.mutate()} className="flex items-center gap-2 rounded-xl bg-success px-5 py-2.5 font-semibold text-white disabled:opacity-60">
            {run.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {t('complete')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Searchable customer picker (greeklish aware on the server). */
export function CustomerPicker({ value, onChange, disabled }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void; disabled?: boolean }) {
  const t = useTranslations('crm');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q.trim());
  const res = useQuery({
    queryKey: ['customer-search', dq], enabled: open && dq.length >= 2,
    queryFn: ({ signal }) => api<Page<Customer>>(`/customers?limit=8&q=${encodeURIComponent(dq)}`, { signal }),
  });
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
        <Building size={16} className="text-primary" />
        <span className="flex-1 truncate font-medium">{value.name}</span>
        {!disabled && <button type="button" onClick={() => onChange(null)} aria-label="clear"><X size={16} className="text-muted" /></button>}
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
        <Search size={16} className="text-muted" />
        <input className="w-full bg-transparent py-2.5 outline-none" placeholder={t('searchCustomer')} value={q} disabled={disabled}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} />
        {res.isFetching && <Loader2 size={15} className="animate-spin text-muted" />}
      </div>
      {open && !!res.data?.items.length && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-xl border border-border bg-surface shadow-xl">
          {res.data.items.map((c) => (
            <li key={c.id}>
              <button type="button" onMouseDown={() => { onChange({ id: c.id, name: c.name }); setQ(''); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-2">
                <span className="flex-1 truncate">{c.name}</span><span className="text-xs text-muted">{c.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Type tile (icon in the type's colour). */
export function TypeIcon({ icon, color, size = 36 }: { icon?: string | null; color?: string | null; size?: number }) {
  const Icon = iconOf(icon);
  return <span className={clsx('grid shrink-0 place-items-center rounded-xl', tone(color))} style={{ width: size, height: size }}><Icon size={size * 0.5} /></span>;
}

/** Sync state with the ERP: synced / waiting / error (tooltip with the reason). */
export function ErpBadge({ state, error, compact }: { state: import('@/lib/crm').ErpState; error?: string | null; compact?: boolean }) {
  const t = useTranslations('crm');
  const cls = state === 'synced' ? 'bg-success-soft text-success' : state === 'pending' ? 'bg-info-soft text-info' : state === 'skipped' ? 'bg-surface-2 text-muted' : 'bg-danger-soft text-danger';
  const Icon = state === 'synced' ? Check : state === 'pending' ? Loader2 : X;
  return (
    <span title={error ?? t(`erp_${state}`)} className={clsx('inline-flex shrink-0 items-center gap-1 rounded-md font-semibold', compact ? 'px-1 py-0.5 text-[10px]' : 'px-2 py-0.5', cls)}>
      <Icon size={compact ? 10 : 11} className={clsx(state === 'pending' && 'animate-spin [animation-duration:2s]')} /> {compact ? 'ERP' : t(`erp_${state}`)}
    </span>
  );
}
