'use client';
import { appConfirm } from './confirm';
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Loader2, Mail, NotebookPen, Phone, Users, X } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import type { Branch, Contact, Space } from '@/lib/customers';
import { IconButton } from './ui';
import { LookupSelect, NameSelect } from './lookup-select';

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none focus:border-primary';

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}
        className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-t-3xl bg-surface p-5 sheet-pb sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <IconButton label="close" onClick={onClose}><X size={20} /></IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function F({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={clsx('block min-w-0', wide && 'sm:col-span-2')}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Actions({ busy, error, onCancel, onDelete }: { busy: boolean; error?: string | null; onCancel: () => void; onDelete?: () => void }) {
  const t = useTranslations('customer');
  return (
    <div className="mt-1 flex items-center gap-2 border-t border-border pt-4 sm:col-span-2">
      {onDelete && <button type="button" onClick={onDelete} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-danger hover:bg-danger-soft">{t('delete')}</button>}
      {error && <span className="text-sm text-danger">{error}</span>}
      <span className="flex-1" />
      <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('cancel')}</button>
      <button disabled={busy} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">
        {busy && <Loader2 size={16} className="animate-spin" />} {t('save')}
      </button>
    </div>
  );
}

/** Shared mutation helper: runs the request, refreshes the customer, closes the dialog. */
function useSave(customerId: string, onDone: () => void) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      qc.invalidateQueries({ queryKey: ['activities', customerId] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? (e.status === 403 ? '403' : e.code) : 'error'),
  });
  return { run: m.mutate, busy: m.isPending, error };
}

type BranchForm = {
  name: string; trade_name: string; address: string; city: string; postal_code: string; region: string;
  geo_zone_id: string | null; fee_schedule_id: string | null; tour_id: string | null; ongoing_status_id: string | null;
  seasonality: Branch['seasonality']; season_months: number[];
  phone: string; manager_name: string; status: 'active' | 'inactive';
};

/** Store record used by the dialog: the customer card and the tree send what they have. */
export type BranchLike = Partial<Branch> & { id: string; name: string };

export function BranchDialog({ customerId, branch, onClose }: { customerId: string; branch?: BranchLike; onClose: () => void }) {
  const t = useTranslations('customer');
  const months = useTranslations('customer').raw('months') as string[];
  const [v, setV] = useState<BranchForm>({
    name: branch?.name ?? '', trade_name: branch?.trade_name ?? '', address: branch?.address ?? '', city: branch?.city ?? '',
    postal_code: branch?.postal_code ?? '', region: branch?.region ?? '',
    geo_zone_id: branch?.geo_zone_id ?? null, fee_schedule_id: branch?.fee_schedule_id ?? null, tour_id: branch?.tour_id ?? null, ongoing_status_id: branch?.ongoing_status_id ?? null,
    seasonality: branch?.seasonality ?? 'all_year', season_months: branch?.season_months ?? [],
    phone: branch?.phone ?? '', manager_name: branch?.manager_name ?? '', status: (branch?.status ?? 'active') as 'active' | 'inactive',
  });
  const { run, busy, error } = useSave(customerId, onClose);
  const set = (k: keyof BranchForm) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const toggleMonth = (m: number) => setV((x) => ({ ...x, season_months: x.season_months.includes(m) ? x.season_months.filter((y) => y !== m) : [...x.season_months, m] }));
  const Head = ({ children }: { children: ReactNode }) => <div className="mt-2 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted sm:col-span-2">{children}</div>;
  return (
    <Dialog title={branch ? t('editBranch') : t('addBranch')} onClose={onClose}>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        run(() => branch ? api(`/branches/${branch.id}`, { method: 'PUT', json: v }) : api(`/customers/${customerId}/branches`, { method: 'POST', json: v }));
      }}>
        <F label={`${t('branchName')} *`} wide><input required autoFocus className={input} value={v.name} onChange={set('name')} /></F>
        <F label={t('branchTradeName')} wide><input className={input} value={v.trade_name} onChange={set('trade_name')} /></F>

        <Head>{t('sLocation')}</Head>
        <F label={t('street')} wide><input className={input} value={v.address} onChange={set('address')} /></F>
        <F label={t('city')}><input className={input} value={v.city} onChange={set('city')} /></F>
        <F label={t('postal')}><input className={input} inputMode="numeric" value={v.postal_code} onChange={set('postal_code')} /></F>
        <F label={t('prefecture')}><NameSelect list="prefecture" className={input} value={v.region} onChange={(x) => setV((s) => ({ ...s, region: x }))} /></F>
        <F label={t('geoZone')}><LookupSelect list="geo_zone" className={input} value={v.geo_zone_id} onChange={(id) => setV((x) => ({ ...x, geo_zone_id: id }))} /></F>

        <Head>{t('sCommercial')}</Head>
        <F label={t('ongoingStatus')} wide><LookupSelect list="ongoing_status" className={input} value={v.ongoing_status_id} onChange={(id) => setV((x) => ({ ...x, ongoing_status_id: id }))} /></F>
        <F label={t('feeSchedule')}><LookupSelect list="fee_schedule" className={input} value={v.fee_schedule_id} onChange={(id) => setV((x) => ({ ...x, fee_schedule_id: id }))} /></F>
        <F label={t('tour')}><LookupSelect list="tour" className={input} value={v.tour_id} onChange={(id) => setV((x) => ({ ...x, tour_id: id }))} /></F>
        <F label={t('seasonality')} wide>
          <select className={input} value={v.seasonality} onChange={(e) => setV((x) => ({ ...x, seasonality: e.target.value as BranchForm['seasonality'] }))}>
            {(['all_year', 'summer', 'winter', 'custom'] as const).map((s) => <option key={s} value={s}>{t(`seasons.${s}`)}</option>)}
          </select>
        </F>
        {v.seasonality === 'custom' && (
          <div className="grid grid-cols-6 gap-1.5 sm:col-span-2">
            {months.map((m, i) => (
              <button key={m} type="button" onClick={() => toggleMonth(i + 1)} aria-pressed={v.season_months.includes(i + 1)}
                className={clsx('rounded-lg border py-2 text-xs font-medium', v.season_months.includes(i + 1) ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>
                {m}
              </button>
            ))}
          </div>
        )}

        <Head>{t('sContact')}</Head>
        <F label={t('phone')}><input type="tel" className={input} value={v.phone} onChange={set('phone')} /></F>
        <F label={t('branchManager')}><input className={input} value={v.manager_name} onChange={set('manager_name')} /></F>
        <Actions busy={busy} error={error} onCancel={onClose}
          onDelete={branch ? async () => { if (await appConfirm(t('confirmDeleteBranch', { name: branch.name }))) run(() => api(`/branches/${branch.id}`, { method: 'DELETE' })); } : undefined} />
      </form>
    </Dialog>
  );
}

export function SpaceDialog({ customerId, branchId, space, onClose }: { customerId: string; branchId: string; space?: Space; onClose: () => void }) {
  const t = useTranslations('customer');
  const [v, setV] = useState({ name: space?.name ?? '', kind: space?.kind ?? '', area_sqm: space?.area_sqm ?? '', notes: space?.notes ?? '' });
  const { run, busy, error } = useSave(customerId, onClose);
  return (
    <Dialog title={space ? t('editSpace') : t('addSpace')} onClose={onClose}>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        const body = { ...v, area_sqm: v.area_sqm === '' ? null : Number(v.area_sqm) };
        run(() => space ? api(`/spaces/${space.id}`, { method: 'PUT', json: body }) : api(`/branches/${branchId}/spaces`, { method: 'POST', json: body }));
      }}>
        <F label={`${t('spaceName')} *`} wide><input required autoFocus className={input} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></F>
        <F label={t('spaceKind')}>
          <NameSelect list="space_kind" className={input} value={v.kind} onChange={(x) => setV({ ...v, kind: x })} />
        </F>
        <F label={t('area')}><input type="number" min={0} step="0.5" className={input} value={v.area_sqm} onChange={(e) => setV({ ...v, area_sqm: e.target.value })} /></F>
        <F label={t('notes')} wide><input className={input} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></F>
        <Actions busy={busy} error={error} onCancel={onClose}
          onDelete={space ? async () => { if (await appConfirm(t('confirmDelete'))) run(() => api(`/spaces/${space.id}`, { method: 'DELETE' })); } : undefined} />
      </form>
    </Dialog>
  );
}

export function ContactDialog({ customerId, contact, onClose }: { customerId: string; contact?: Contact; onClose: () => void }) {
  const t = useTranslations('customer');
  const [v, setV] = useState({
    full_name: contact?.full_name ?? '', role_title: contact?.role_title ?? '', email: contact?.email ?? '', phone: contact?.phone ?? '',
    mobile: contact?.mobile ?? '', is_primary: contact?.is_primary ?? false, notes: contact?.notes ?? '',
  });
  const { run, busy, error } = useSave(customerId, onClose);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog title={contact ? t('editContact') : t('addContact')} onClose={onClose}>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        run(() => contact ? api(`/contacts/${contact.id}`, { method: 'PUT', json: v }) : api(`/customers/${customerId}/contacts`, { method: 'POST', json: v }));
      }}>
        <F label={`${t('fullName')} *`}><input required minLength={2} autoFocus className={input} value={v.full_name} onChange={set('full_name')} /></F>
        <F label={t('roleTitle')}><input className={input} value={v.role_title} onChange={set('role_title')} /></F>
        <F label={t('email')} wide><input type="email" className={input} value={v.email} onChange={set('email')} /></F>
        <F label={t('phone')}><input type="tel" className={input} value={v.phone} onChange={set('phone')} /></F>
        <F label={t('mobile')}><input type="tel" className={input} value={v.mobile} onChange={set('mobile')} /></F>
        <F label={t('notes')} wide><input className={input} value={v.notes} onChange={set('notes')} /></F>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.is_primary} onChange={(e) => setV({ ...v, is_primary: e.target.checked })} />
          {t('primary')}
        </label>
        <Actions busy={busy} error={error} onCancel={onClose}
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

export function ActivityDialog({ customerId, initialKind = 'call', onClose }: { customerId: string; initialKind?: (typeof KINDS)[number]['value']; onClose: () => void }) {
  const t = useTranslations('customer');
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>(initialKind);
  const defaultTitle = (k: string) => t(KINDS.find((x) => x.value === k)!.key);
  const [title, setTitle] = useState(defaultTitle(initialKind));
  const [body, setBody] = useState('');
  const { run, busy, error } = useSave(customerId, onClose);
  return (
    <Dialog title={t('logActivity')} onClose={onClose}>
      {/* One column on every screen; the kind picker is a full-width segmented control */}
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/customers/${customerId}/activities`, { method: 'POST', json: { kind, title, body } })); }}>
        <div role="radiogroup" aria-label={t('activityTitle')} className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1 sm:col-span-2">
          {KINDS.map(({ value, icon: Icon, key }) => (
            <button key={value} type="button" role="radio" aria-checked={kind === value}
              onClick={() => { if (title === defaultTitle(kind)) setTitle(t(key)); setKind(value); }}
              className={clsx('flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[12px] font-semibold leading-tight transition',
                kind === value ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
              <Icon size={19} className="shrink-0" />
              <span className="w-full truncate text-center">{t(key)}</span>
            </button>
          ))}
        </div>
        <F label={t('activityTitle')} wide><input required className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></F>
        <F label={t('activityBody')} wide><textarea rows={5} autoFocus className={clsx(input, 'resize-y')} value={body} onChange={(e) => setBody(e.target.value)} /></F>
        <Actions busy={busy} error={error} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
