'use client';
import { appConfirm } from './confirm';
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Loader2, Mail, NotebookPen, Phone, Users, X } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import type { Branch, Contact, CustomerDetail, Space } from '@/lib/customers';
import { flatValues, useFormConfig, validateForm, type Effective } from '@/lib/forms';
import { IconButton } from './ui';
import { LookupSelect, NameSelect } from './lookup-select';
import { FormFields, FormLoading, scrollToError, useFormDefaults, type RendererEntry } from './form-engine';
import { useMe } from './app-shell';

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}
        className={clsx('max-h-[90dvh] w-full overflow-auto', wide ? 'max-w-2xl' : 'max-w-lg', ' rounded-t-3xl bg-surface p-5 sheet-pb sm:rounded-3xl sm:p-6')}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="line-clamp-3 min-w-0 pt-1.5 text-lg font-bold leading-snug [overflow-wrap:anywhere]">{title}</h2>
          <span className="shrink-0"><IconButton label="close" onClick={onClose}><X size={20} /></IconButton></span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Actions({ busy, error, onCancel, onDelete, disabled }: { busy: boolean; error?: string | null; onCancel: () => void; onDelete?: () => void; disabled?: boolean }) {
  const t = useTranslations('customer');
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
      {onDelete && <button type="button" onClick={onDelete} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-danger hover:bg-danger-soft">{t('delete')}</button>}
      {error && <span className="text-sm text-danger">{error}</span>}
      <span className="flex-1" />
      <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('cancel')}</button>
      <button disabled={busy || disabled} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">
        {busy && <Loader2 size={16} className="animate-spin" />} {t('save')}
      </button>
    </div>
  );
}

/** Shared mutation helper: runs the request, refreshes the customer, closes the dialog; field errors from the API go to the form. */
function useSave(customerId: string, onDone: () => void, setFieldErrors?: (e: Record<string, string>) => void) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      qc.invalidateQueries({ queryKey: ['activities', customerId] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['branches'] });
      onDone();
    },
    onError: (e) => {
      const fields = e instanceof ApiError ? (e.body as { fields?: Record<string, string> })?.fields : undefined;
      if (fields && setFieldErrors) { setFieldErrors(fields); setError(null); scrollToError(); return; }
      setError(e instanceof ApiError ? (e.status === 403 ? '403' : e.code) : 'error');
    },
  });
  return { run: m.mutate, busy: m.isPending, error };
}

/**
 * Common logic of the record dialogs: form configuration, values incl. custom fields, defaults on create,
 * client checks before saving.
 */
function useRecordForm<T extends Record<string, unknown>>(form: Parameters<typeof useFormConfig>[0], initial: T, initialCustom: Record<string, unknown> | undefined,
  creating: boolean, parent?: Record<string, unknown> | null) {
  const cfg = useFormConfig(form);
  const { data: me } = useMe();
  const [v, setV] = useState<T>(initial);
  const [custom, setCustom] = useState<Record<string, unknown>>(initialCustom ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const values = useMemo(() => flatValues(v, custom), [v, custom]);
  useFormDefaults(cfg.data, creating, values, (patch) => {
    const c: Record<string, unknown> = {}, rest: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) (k.startsWith('cf_') ? (c[k.slice(3)] = val) : (rest[k] = typeof val === 'number' ? String(val) : val));
    setV((x) => ({ ...x, ...Object.fromEntries(Object.entries(rest).filter(([k]) => k in x)) }));
    setCustom((x) => ({ ...x, ...c }));
  }, { userId: me?.user.id, parent });
  const onChange = (k: string, val: unknown) => {
    if (k.startsWith('cf_')) setCustom((x) => ({ ...x, [k.slice(3)]: val }));
    else setV((x) => ({ ...x, [k]: val }));
  };
  const check = (extra: Record<string, string> = {}) => {
    const errs = { ...(cfg.data ? validateForm(cfg.data, values) : {}), ...extra };
    setErrors(errs);
    if (Object.keys(errs).length) { scrollToError(); return false; }
    return true;
  };
  return { cfg, v, setV, custom, values, errors, setErrors, onChange, check };
}

function Body({ eff, isError, retry, children }: { eff?: Effective; isError: boolean; retry: () => void; children: (eff: Effective) => ReactNode }) {
  return eff ? <>{children(eff)}</> : <FormLoading error={isError} onRetry={retry} />;
}

type BranchForm = {
  name: string; trade_name: string; address: string; city: string; postal_code: string; region: string;
  geo_zone_id: string | null; fee_schedule_id: string | null; tour_id: string | null; ongoing_status_id: string | null;
  seasonality: Branch['seasonality']; season_months: number[];
  phone: string; manager_name: string; status: 'active' | 'inactive';
};

/** Store record used by the dialog: the customer card and the tree send what they have. */
export type BranchLike = Partial<Branch> & { id: string; name: string };

function useCustomer(customerId: string) {
  const qc = useQueryClient();
  return (qc.getQueryData(['customer', customerId]) as CustomerDetail | undefined)?.customer as Record<string, unknown> | undefined;
}

export function BranchDialog({ customerId, branch, onClose }: { customerId: string; branch?: BranchLike; onClose: () => void }) {
  const t = useTranslations('customer');
  const months = useTranslations('customer').raw('months') as string[];
  const parent = useCustomer(customerId);
  const f = useRecordForm<BranchForm>('branch', {
    name: branch?.name ?? '', trade_name: branch?.trade_name ?? '', address: branch?.address ?? '', city: branch?.city ?? '',
    postal_code: branch?.postal_code ?? '', region: branch?.region ?? '',
    geo_zone_id: branch?.geo_zone_id ?? null, fee_schedule_id: branch?.fee_schedule_id ?? null, tour_id: branch?.tour_id ?? null, ongoing_status_id: branch?.ongoing_status_id ?? null,
    seasonality: branch?.seasonality ?? 'all_year', season_months: branch?.season_months ?? [],
    phone: branch?.phone ?? '', manager_name: branch?.manager_name ?? '', status: (branch?.status ?? 'active') as 'active' | 'inactive',
  }, branch?.custom, !branch, parent);
  const { v, setV } = f;
  const { run, busy, error } = useSave(customerId, onClose, f.setErrors);
  const txt = (k: keyof BranchForm, extra?: string) => (c: Parameters<Exclude<RendererEntry, { render: unknown }>>[0]) =>
    <input id={c.id} className={clsx(c.className, extra)} placeholder={c.placeholder} aria-invalid={c.invalid} value={(v[k] as string) ?? ''} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />;
  const toggleMonth = (m: number) => setV((x) => ({ ...x, season_months: x.season_months.includes(m) ? x.season_months.filter((y) => y !== m) : [...x.season_months, m] }));
  const renderers: Record<string, RendererEntry> = {
    name: (c) => <input id={c.id} autoFocus className={c.className} placeholder={c.placeholder} aria-invalid={c.invalid} value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} />,
    trade_name: txt('trade_name'), address: txt('address'), city: txt('city'), postal_code: txt('postal_code', 'tabular'),
    phone: txt('phone'), manager_name: txt('manager_name'),
    region: (c) => <NameSelect id={c.id} list="prefecture" className={c.className} allowed={c.allowed} value={v.region} onChange={(x) => setV((s) => ({ ...s, region: x }))} />,
    geo_zone_id: (c) => <LookupSelect id={c.id} list="geo_zone" className={c.className} allowed={c.allowed} value={v.geo_zone_id} onChange={(id) => setV((x) => ({ ...x, geo_zone_id: id }))} />,
    ongoing_status_id: (c) => <LookupSelect id={c.id} list="ongoing_status" className={c.className} allowed={c.allowed} value={v.ongoing_status_id} onChange={(id) => setV((x) => ({ ...x, ongoing_status_id: id }))} />,
    fee_schedule_id: (c) => <LookupSelect id={c.id} list="fee_schedule" className={c.className} allowed={c.allowed} value={v.fee_schedule_id} onChange={(id) => setV((x) => ({ ...x, fee_schedule_id: id }))} />,
    tour_id: (c) => <LookupSelect id={c.id} list="tour" className={c.className} allowed={c.allowed} value={v.tour_id} onChange={(id) => setV((x) => ({ ...x, tour_id: id }))} />,
    seasonality: (c) => (
      <>
        <select id={c.id} className={c.className} value={v.seasonality} onChange={(e) => setV((x) => ({ ...x, seasonality: e.target.value as BranchForm['seasonality'] }))}>
          {(['all_year', 'summer', 'winter', 'custom'] as const).filter((s) => !c.allowed || c.allowed.includes(s) || s === v.seasonality).map((s) => <option key={s} value={s}>{t(`seasons.${s}`)}</option>)}
        </select>
        {v.seasonality === 'custom' && (
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {months.map((m, i) => (
              <button key={m} type="button" onClick={() => toggleMonth(i + 1)} aria-pressed={v.season_months.includes(i + 1)}
                className={clsx('rounded-lg border py-2 text-xs font-medium', v.season_months.includes(i + 1) ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>
                {m}
              </button>
            ))}
          </div>
        )}
      </>
    ),
  };
  return (
    <Dialog title={branch ? t('editBranch') : t('addBranch')} onClose={onClose}>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!f.check(v.name.trim() ? {} : { name: 'required' })) return;
        const json = { ...v, custom: f.custom };
        run(() => branch ? api(`/branches/${branch.id}`, { method: 'PUT', json }) : api(`/customers/${customerId}/branches`, { method: 'POST', json }));
      }}>
        <Body eff={f.cfg.data} isError={f.cfg.isError} retry={() => f.cfg.refetch()}>
          {(eff) => <FormFields eff={eff} values={f.values} errors={f.errors} onChange={f.onChange} renderers={renderers} variant="plain" idPrefix="branch" />}
        </Body>
        <Actions busy={busy} error={error} onCancel={onClose} disabled={!f.cfg.data}
          onDelete={branch ? async () => { if (await appConfirm(t('confirmDeleteBranch', { name: branch.name }))) run(() => api(`/branches/${branch.id}`, { method: 'DELETE' })); } : undefined} />
      </form>
    </Dialog>
  );
}

export function SpaceDialog({ customerId, branchId, space, onClose }: { customerId: string; branchId: string; space?: Space; onClose: () => void }) {
  const t = useTranslations('customer');
  const customer = useQueryClient().getQueryData(['customer', customerId]) as CustomerDetail | undefined;
  const parent = customer?.branches.find((b) => b.id === branchId) as Record<string, unknown> | undefined;
  const f = useRecordForm('space', { name: space?.name ?? '', kind: space?.kind ?? '', area_sqm: space?.area_sqm ?? '', notes: space?.notes ?? '' }, space?.custom, !space, parent);
  const { v, setV } = f;
  const { run, busy, error } = useSave(customerId, onClose, f.setErrors);
  const renderers: Record<string, RendererEntry> = {
    name: (c) => <input id={c.id} autoFocus className={c.className} placeholder={c.placeholder} aria-invalid={c.invalid} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />,
    kind: (c) => <NameSelect id={c.id} list="space_kind" className={c.className} allowed={c.allowed} value={v.kind} onChange={(x) => setV({ ...v, kind: x })} />,
    area_sqm: (c) => <input id={c.id} type="number" min={0} step="0.5" className={clsx(c.className, 'tabular')} aria-invalid={c.invalid} value={v.area_sqm} onChange={(e) => setV({ ...v, area_sqm: e.target.value })} />,
    notes: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />,
  };
  return (
    <Dialog title={space ? t('editSpace') : t('addSpace')} onClose={onClose}>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!f.check(v.name.trim() ? {} : { name: 'required' })) return;
        const body = { ...v, area_sqm: v.area_sqm === '' ? null : Number(v.area_sqm), custom: f.custom };
        run(() => space ? api(`/spaces/${space.id}`, { method: 'PUT', json: body }) : api(`/branches/${branchId}/spaces`, { method: 'POST', json: body }));
      }}>
        <Body eff={f.cfg.data} isError={f.cfg.isError} retry={() => f.cfg.refetch()}>
          {(eff) => <FormFields eff={eff} values={f.values} errors={f.errors} onChange={f.onChange} renderers={renderers} variant="plain" idPrefix="space" />}
        </Body>
        <Actions busy={busy} error={error} onCancel={onClose} disabled={!f.cfg.data}
          onDelete={space ? async () => { if (await appConfirm(t('confirmDelete'))) run(() => api(`/spaces/${space.id}`, { method: 'DELETE' })); } : undefined} />
      </form>
    </Dialog>
  );
}

export function ContactDialog({ customerId, contact, onClose }: { customerId: string; contact?: Contact; onClose: () => void }) {
  const t = useTranslations('customer');
  const parent = useCustomer(customerId);
  const f = useRecordForm('contact', {
    full_name: contact?.full_name ?? '', role_title: contact?.role_title ?? '', email: contact?.email ?? '', phone: contact?.phone ?? '',
    mobile: contact?.mobile ?? '', is_primary: contact?.is_primary ?? false, notes: contact?.notes ?? '',
  }, contact?.custom, !contact, parent);
  const { v, setV } = f;
  const { run, busy, error } = useSave(customerId, onClose, f.setErrors);
  const txt = (k: 'full_name' | 'role_title' | 'email' | 'phone' | 'mobile' | 'notes', type = 'text') => (c: Parameters<Exclude<RendererEntry, { render: unknown }>>[0]) =>
    <input id={c.id} type={type} autoFocus={k === 'full_name'} className={c.className} placeholder={c.placeholder} aria-invalid={c.invalid} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />;
  const renderers: Record<string, RendererEntry> = {
    full_name: txt('full_name'), role_title: txt('role_title'), email: txt('email', 'email'), phone: txt('phone', 'tel'), mobile: txt('mobile', 'tel'), notes: txt('notes'),
    is_primary: { bare: true, render: (c) => (
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input id={c.id} type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.is_primary} onChange={(e) => setV({ ...v, is_primary: e.target.checked })} />
        {c.label}
      </label>
    ) },
  };
  return (
    <Dialog title={contact ? t('editContact') : t('addContact')} onClose={onClose}>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!f.check(v.full_name.trim().length >= 2 ? {} : { full_name: 'required' })) return;
        const json = { ...v, custom: f.custom };
        run(() => contact ? api(`/contacts/${contact.id}`, { method: 'PUT', json }) : api(`/customers/${customerId}/contacts`, { method: 'POST', json }));
      }}>
        <Body eff={f.cfg.data} isError={f.cfg.isError} retry={() => f.cfg.refetch()}>
          {(eff) => <FormFields eff={eff} values={f.values} errors={f.errors} onChange={f.onChange} renderers={renderers} variant="plain" idPrefix="contact" />}
        </Body>
        <Actions busy={busy} error={error} onCancel={onClose} disabled={!f.cfg.data}
          onDelete={contact ? async () => { if (await appConfirm(t('confirmDelete'))) run(() => api(`/contacts/${contact.id}`, { method: 'DELETE' })); } : undefined} />
      </form>
    </Dialog>
  );
}

const KINDS = [
  { value: 'call', icon: Phone, key: 'kindCall' },
  { value: 'email_sent', icon: Mail, key: 'kindEmail' },
  { value: 'meeting_done', icon: Users, key: 'kindMeeting' },
  { value: 'note', icon: NotebookPen, key: 'kindNote' },
] as const;
type Kind = (typeof KINDS)[number]['value'];

export function ActivityDialog({ customerId, initialKind = 'call', onClose }: { customerId: string; initialKind?: Kind; onClose: () => void }) {
  const t = useTranslations('customer');
  const defaultTitle = (k: string) => t(KINDS.find((x) => x.value === k)!.key);
  const parent = useCustomer(customerId);
  const f = useRecordForm('activity', { kind: initialKind as string, title: defaultTitle(initialKind), body: '' }, {}, true, parent);
  const { v, setV } = f;
  const { run, busy, error } = useSave(customerId, onClose, f.setErrors);
  const renderers: Record<string, RendererEntry> = {
    kind: { bare: true, render: (c) => (
      <div role="radiogroup" aria-label={c.label} className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1">
        {KINDS.filter((k) => !c.allowed || c.allowed.includes(k.value) || k.value === v.kind).map(({ value, icon: Icon, key }) => (
          <button key={value} type="button" role="radio" aria-checked={v.kind === value}
            onClick={() => setV((x) => ({ ...x, kind: value, title: x.title === defaultTitle(x.kind) ? t(key) : x.title }))}
            className={clsx('flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[12px] font-semibold leading-tight transition',
              v.kind === value ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
            <Icon size={19} className="shrink-0" />
            <span className="w-full truncate text-center">{t(key)}</span>
          </button>
        ))}
      </div>
    ) },
    title: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} aria-invalid={c.invalid} value={v.title} onChange={(e) => setV((x) => ({ ...x, title: e.target.value }))} />,
    body: (c) => <textarea id={c.id} rows={5} autoFocus className={clsx(c.className, 'resize-y')} placeholder={c.placeholder} aria-invalid={c.invalid} value={v.body} onChange={(e) => setV((x) => ({ ...x, body: e.target.value }))} />,
  };
  return (
    <Dialog title={t('logActivity')} onClose={onClose}>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!f.check(v.title.trim() ? {} : { title: 'required' })) return;
        run(() => api(`/customers/${customerId}/activities`, { method: 'POST', json: { ...v, custom: f.custom } }));
      }}>
        <Body eff={f.cfg.data} isError={f.cfg.isError} retry={() => f.cfg.refetch()}>
          {(eff) => <FormFields eff={eff} values={f.values} errors={f.errors} onChange={f.onChange} renderers={renderers} variant="plain" idPrefix="activity" />}
        </Body>
        <Actions busy={busy} error={error} onCancel={onClose} disabled={!f.cfg.data} />
      </form>
    </Dialog>
  );
}
