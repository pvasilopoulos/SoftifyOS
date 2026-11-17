'use client';
import { appConfirm } from './confirm';
import { ImpersonateButton } from './impersonation';
// Settings module sections. Each section loads its own data; admin-only edits are enforced by the API too.
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowDown, ArrowUp, Building2, Check, Copy, KeyRound, Loader2, Mail, Package, Pencil, Plus, Search, ShieldCheck, Star, Trash2, UserPlus, X,
} from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { money, relative } from '@/lib/format';
import { Avatar } from './ui';
import { Dialog } from './customer-dialogs';
import { useToast } from './providers';
import { useMe } from './app-shell';
import { ID_LISTS, NAME_LISTS } from './lookup-select';
import { canDo, RolesCard, useRoles, type Role } from './roles-settings';
import { Activity as ActivityIcon, MailWarning, Search as SearchIcon, ShieldCheck as RoleIcon, UsersRound, X as XIcon } from 'lucide-react';

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary disabled:opacity-60';
const primaryBtn = 'flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60';
const ghostBtn = 'flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 font-medium';

export function Card({ title, description, children, action }: { title?: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card p-4 sm:p-6">
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={clsx('block min-w-0', wide && 'sm:col-span-2')}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** "Admin" screens need the settings permission of the user's role. */
function useIsAdmin(perm: string = 'settings.manage') {
  const { data: me } = useMe();
  return { isAdmin: canDo(me, perm), me };
}

function AdminNotice() {
  const t = useTranslations('settings');
  return <div className="flex items-center gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info"><ShieldCheck size={16} /> {t('adminOnly')}</div>;
}

const errText = (e: unknown) => (e instanceof ApiError ? e.code : 'error');

// ======================================== Organisation ========================================
type Org = {
  id: string; slug: string; name: string; legal_name: string | null; vat: string | null; email: string | null; phone: string | null;
  website: string | null; address: string | null; locale: 'el' | 'en'; timezone: string; currency: string; default_vat_rate: string;
  offer_prefix: string; offer_validity_days: number; offer_terms: string | null; counts: { users: number; customers: string | null; offers: string };
  can_edit: boolean;
};

export function OrganizationSection() { return <OrgForm part="org" />; }
export function OffersSettingsSection() { return <OrgForm part="offers" />; }

/** Organisation and offer settings share one record (tenants), shown in two sections. */
function OrgForm({ part }: { part: 'org' | 'offers' }) {
  const t = useTranslations('settings.org');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings', 'org'], queryFn: () => api<Org>('/settings/organization') });
  const [v, setV] = useState<Org | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  const save = useMutation({
    mutationFn: () => api('/settings/organization', { method: 'PUT', json: { ...v, default_vat_rate: Number(v!.default_vat_rate) } }),
    onSuccess: () => { toast({ title: ts('saved') }); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => toast({ title: e instanceof ApiError && e.code === 'slug_taken' ? t('slugTaken') : ts('error'), body: e instanceof ApiError && e.code === 'slug_taken' ? undefined : errText(e) }),
  });
  if (!v) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const ro = !v.can_edit;
  const set = (k: keyof Org) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value } as Org);
  const year = new Date().getFullYear();

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {ro && <AdminNotice />}
      {part === 'org' && (<>
      <div className="grid grid-cols-3 gap-3">
        {[[t('users'), v.counts.users], [t('customers'), Number(v.counts.customers ?? 0)], [t('offers'), Number(v.counts.offers)]].map(([k, n]) => (
          <div key={k as string} className="card p-4"><div className="text-xs text-muted">{k}</div><div className="tabular text-xl font-bold">{Number(n).toLocaleString()}</div></div>
        ))}
      </div>
      <Card title={t('sProfile')}>
        <fieldset disabled={ro} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('name')}><input required minLength={2} className={input} value={v.name} onChange={set('name')} /></Field>
          <Field label={t('legalName')}><input className={input} value={v.legal_name ?? ''} onChange={set('legal_name')} /></Field>
          <Field label={t('vat')}><input className={`${input} tabular`} value={v.vat ?? ''} onChange={set('vat')} /></Field>
          <Field label={t('email')}><input type="email" className={input} value={v.email ?? ''} onChange={set('email')} /></Field>
          <Field label={t('phone')}><input type="tel" className={input} value={v.phone ?? ''} onChange={set('phone')} /></Field>
          <Field label={t('website')}><input className={input} value={v.website ?? ''} onChange={set('website')} /></Field>
          <Field label={t('address')} wide><input className={input} value={v.address ?? ''} onChange={set('address')} /></Field>
          <Field label={t('slug')} hint={t('slugHint')}>
            <input required minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" className={`${input} lowercase`} value={v.slug}
              onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
          </Field>
        </fieldset>
      </Card>
      <Card title={t('sDefaults')}>
        <fieldset disabled={ro} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('locale')}>
            <select className={input} value={v.locale} onChange={set('locale')}><option value="el">Ελληνικά</option><option value="en">English</option></select>
          </Field>
          <Field label={t('timezone')}>
            <select className={input} value={v.timezone} onChange={set('timezone')}>
              {['Europe/Athens', 'Europe/Nicosia', 'Europe/London', 'Europe/Berlin', 'Europe/Bucharest', 'Europe/Sofia', 'UTC'].map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
          <Field label={t('currency')}>
            <select className={input} value={v.currency} onChange={set('currency')}>{['EUR', 'USD', 'GBP', 'BGN', 'RON'].map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label={t('vatRate')}><input type="number" min={0} max={100} step="0.5" className={`${input} tabular`} value={v.default_vat_rate} onChange={set('default_vat_rate')} /></Field>
        </fieldset>
      </Card>
      </>)}
      {part === 'offers' && (
      <Card title={t('sOffers')}>
        <fieldset disabled={ro} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('prefix')} hint={t('prefixHint', { example: `${v.offer_prefix || 'OFF'}-${year}-0001` })}>
            <input className={`${input} uppercase tabular`} maxLength={10} pattern="[A-Za-z0-9-]{1,10}" value={v.offer_prefix} onChange={(e) => setV({ ...v, offer_prefix: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t('validity')}><input type="number" min={1} max={365} className={`${input} tabular`} value={v.offer_validity_days} onChange={set('offer_validity_days')} /></Field>
          <Field label={t('terms')} wide><textarea rows={6} className={input} value={v.offer_terms ?? ''} onChange={set('offer_terms')} /></Field>
        </fieldset>
      </Card>
      )}
      {!ro && (
        <div className="card sticky bottom-24 z-20 flex justify-end p-3 lg:bottom-4">
          <button disabled={save.isPending} className={primaryBtn}>{save.isPending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} {ts('save')}</button>
        </div>
      )}
    </form>
  );
}

// ======================================== Companies ========================================
type Company = { id: string; name: string; vat: string | null; tax_office: string | null; address: string | null; phone: string | null; email: string | null; iban: string | null; is_default: boolean; active: boolean; offers: number };

export function CompaniesSection() {
  const t = useTranslations('settings.companies');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { data = [] } = useQuery({ queryKey: ['settings', 'companies'], queryFn: () => api<Company[]>('/settings/companies') });
  const [edit, setEdit] = useState<Partial<Company> | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api(`/settings/companies/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'companies'] }),
    onError: (e) => toast({ title: e instanceof ApiError && e.code === 'in_use' ? t('inUse') : ts('error') }),
  });
  return (
    <div className="space-y-3">
      {!isAdmin && <AdminNotice />}
      {isAdmin && <button onClick={() => setEdit({ active: true, is_default: false })} className={clsx(primaryBtn, 'w-full sm:w-auto')}><Plus size={18} /> {t('add')}</button>}
      {data.map((c) => (
        <div key={c.id} className={clsx('card flex items-center gap-3 p-4', !c.active && 'opacity-60')}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Building2 size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              {c.name}
              {c.is_default && <span className="flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning"><Star size={11} className="fill-current" />{t('default')}</span>}
              {!c.active && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{ts('inactive')}</span>}
            </div>
            <div className="truncate text-sm text-muted">{[c.vat && `${t('vat')} ${c.vat}`, c.tax_office, c.iban].filter(Boolean).join(' · ') || '—'}</div>
            <div className="text-xs text-muted">{t('offers', { count: c.offers })}</div>
          </div>
          {isAdmin && (
            <>
              <button onClick={() => setEdit(c)} aria-label={ts('edit')} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-primary"><Pencil size={16} /></button>
              <button onClick={async () => { if (await appConfirm(t('confirmDelete', { name: c.name }))) del.mutate(c.id); }} aria-label={ts('delete')}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"><Trash2 size={16} /></button>
            </>
          )}
        </div>
      ))}
      {edit && <CompanyDialog company={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CompanyDialog({ company, onClose }: { company: Partial<Company>; onClose: () => void }) {
  const t = useTranslations('settings.companies');
  const ts = useTranslations('settings');
  const qc = useQueryClient();
  const [v, setV] = useState({
    name: company.name ?? '', vat: company.vat ?? '', tax_office: company.tax_office ?? '', address: company.address ?? '',
    phone: company.phone ?? '', email: company.email ?? '', iban: company.iban ?? '', is_default: !!company.is_default, active: company.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => company.id ? api(`/settings/companies/${company.id}`, { method: 'PUT', json: v }) : api('/settings/companies', { method: 'POST', json: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings', 'companies'] }); qc.invalidateQueries({ queryKey: ['companies'] }); onClose(); },
    onError: (e) => setError(errText(e)),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog title={company.id ? t('edit') : t('add')} onClose={onClose}>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label={`${t('name')} *`} wide><input required minLength={2} autoFocus className={input} value={v.name} onChange={set('name')} /></Field>
        <Field label={t('vat')}><input className={`${input} tabular`} value={v.vat} onChange={set('vat')} /></Field>
        <Field label={t('taxOffice')}><input className={input} value={v.tax_office} onChange={set('tax_office')} /></Field>
        <Field label={t('address')} wide><input className={input} value={v.address} onChange={set('address')} /></Field>
        <Field label={t('phone')}><input type="tel" className={input} value={v.phone} onChange={set('phone')} /></Field>
        <Field label={t('email')}><input type="email" className={input} value={v.email} onChange={set('email')} /></Field>
        <Field label={t('iban')} wide><input className={`${input} tabular uppercase`} value={v.iban} onChange={set('iban')} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.is_default} onChange={(e) => setV({ ...v, is_default: e.target.checked })} />{t('isDefault')}</label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />{ts('active')}</label>
        <div className="mt-2 flex items-center justify-end gap-2 sm:col-span-2">
          {error && <span className="mr-auto text-sm text-danger">{error}</span>}
          <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
          <button disabled={save.isPending} className={primaryBtn}>{save.isPending && <Loader2 size={16} className="animate-spin" />}{ts('save')}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ======================================== Users & roles ========================================
type Member = { id: string; email: string; full_name: string; password_set: boolean; role: string; title: string | null; created_at: string; last_seen_at: string | null; pending_invite: string | null };

export function UsersSection() {
  const t = useTranslations('settings.users');
  const ts = useTranslations('settings');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { isAdmin, me } = useIsAdmin('users.manage');
  const myRole = me?.tenant?.role ?? 'viewer';
  const roles = useRoles().data?.roles ?? [];
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  const { data = [] } = useQuery({ queryKey: ['settings', 'users'], queryFn: () => api<Member[]>('/settings/users') });
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ url: string | null; emailed?: boolean; existing?: boolean } | null>(null);
  const onErr = (e: unknown) => toast({ title: e instanceof ApiError && t.has(`errors.${e.code}`) ? t(`errors.${e.code}` as never) : ts('error') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'users'] });
  const role = useMutation({ mutationFn: (x: { id: string; role: string; title: string | null }) => api(`/settings/users/${x.id}`, { method: 'PUT', json: { role: x.role, title: x.title } }), onSuccess: refresh, onError: onErr });
  const remove = useMutation({ mutationFn: (id: string) => api(`/settings/users/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: onErr });
  const resend = useMutation({ mutationFn: (id: string) => api<{ inviteUrl: string }>(`/settings/users/${id}/resend`, { method: 'POST' }), onSuccess: (r) => setLink({ url: r.inviteUrl }), onError: onErr });
  // Only owners can grant (or act on) the owner role
  const assignable = roles.filter((r) => r.key !== 'owner' || myRole === 'owner');

  // Tabs, search and filters; users are grouped by role (in the roles' order)
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [state, setState] = useState<'all' | 'active' | 'pending' | 'inactive'>('all');
  const weekAgo = Date.now() - 7 * 86_400_000;
  const fold = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const needle = fold(q.trim());
  const stateOf = (u: Member) => (!u.password_set ? 'pending' : u.last_seen_at && new Date(u.last_seen_at).getTime() > weekAgo ? 'active' : 'inactive');
  const filtered = data.filter((u) =>
    (!needle || fold(`${u.full_name} ${u.email} ${u.title ?? ''}`).includes(needle))
    && (!roleFilter || u.role === roleFilter)
    && (state === 'all' || stateOf(u) === state));
  const groups = [...roles.map((r) => r.key), ...new Set(data.map((u) => u.role).filter((k) => !roles.some((r) => r.key === k)))]
    .map((key) => ({ key, users: filtered.filter((u) => u.role === key) }))
    .filter((g) => g.users.length);
  const stats = [
    { icon: UsersRound, label: t('statUsers'), value: data.length },
    { icon: ActivityIcon, label: t('statActive'), value: data.filter((u) => stateOf(u) === 'active').length },
    { icon: MailWarning, label: t('statPending'), value: data.filter((u) => !u.password_set).length },
    { icon: RoleIcon, label: t('statRoles'), value: roles.length },
  ];
  const filtersOn = !!(q || roleFilter || state !== 'all');

  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} className="card flex items-center gap-3 p-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon size={17} /></span>
            <div className="min-w-0"><div className="tabular text-lg font-bold leading-tight">{value}</div><div className="truncate text-xs text-muted">{label}</div></div>
          </div>
        ))}
      </div>

      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
        {(['users', 'roles'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={clsx('flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition', tab === k ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
            {k === 'users' ? <UsersRound size={16} /> : <RoleIcon size={16} />}
            {k === 'users' ? t('tabUsers', { count: data.length }) : t('tabRoles', { count: roles.length })}
          </button>
        ))}
      </div>

      {tab === 'roles' ? <RolesCard /> : (
      <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')}
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary" />
        </label>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={t('role')}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary">
          <option value="">{t('allRoles')}</option>
          {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
        {isAdmin && <button onClick={() => setInviting(true)} className={primaryBtn}><UserPlus size={18} /> {t('invite')}</button>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'active', 'inactive', 'pending'] as const).map((k) => (
          <button key={k} onClick={() => setState(k)}
            className={clsx('rounded-full border px-3 py-1.5 text-sm', state === k ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border text-muted hover:text-text')}>
            {t(`state_${k}`)}
          </button>
        ))}
        {filtersOn && (
          <button onClick={() => { setQ(''); setRoleFilter(''); setState('all'); }} className="ml-auto flex items-center gap-1 text-sm font-medium text-primary">
            <XIcon size={14} /> {t('clear')}
          </button>
        )}
      </div>

      {!groups.length && <div className="card p-8 text-center text-sm text-muted">{t('noMatch')}</div>}
      {groups.map((g) => (
      <section key={g.key}>
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{roleName(g.key)}</span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{g.users.length}</span>
        </div>
      <div className="card divide-y divide-border">
        {g.users.map((u) => {
          const isMe = u.id === me?.user.id;
          const editable = isAdmin && !isMe && (u.role !== 'owner' || myRole === 'owner');
          return (
            <div key={u.id} className="flex flex-wrap items-center gap-3 p-4">
              <Avatar name={u.full_name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  {u.full_name}{isMe && <span className="text-xs font-normal text-muted">({t('you')})</span>}
                  {!u.password_set && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">{t('pending')}</span>}
                </div>
                <div className="truncate text-sm text-muted">{u.email}{u.title && ` · ${u.title}`}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <span className={clsx('h-2 w-2 shrink-0 rounded-full', stateOf(u) === 'active' ? 'bg-success' : stateOf(u) === 'pending' ? 'bg-warning' : 'bg-border')} />
                  {t('lastSeen')}: {u.last_seen_at ? relative(u.last_seen_at, locale, { today: ta('today'), yesterday: ta('yesterday') }) : t('never')}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <select aria-label={t('role')} value={u.role} disabled={!editable || role.isPending}
                  onChange={(e) => role.mutate({ id: u.id, role: e.target.value, title: u.title })}
                  className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-medium outline-none focus:border-primary disabled:opacity-70">
                  {!roles.some((r) => r.key === u.role) && <option value={u.role}>{roleName(u.role)}</option>}
                  {(editable ? assignable : roles).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                </select>
                {editable && u.password_set && !me?.impersonator && <ImpersonateButton userId={u.id} name={u.full_name} />}
                {editable && !u.password_set && (
                  <button onClick={() => resend.mutate(u.id)} title={t('resend')} aria-label={t('resend')} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-primary"><Mail size={16} /></button>
                )}
                {editable && (
                  <button onClick={async () => { if (await appConfirm(t('confirmRemove', { name: u.full_name }))) remove.mutate(u.id); }} title={t('remove')} aria-label={t('remove')}
                    className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"><Trash2 size={16} /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </section>
      ))}
      </>
      )}
      {inviting && <InviteDialog roles={assignable} onClose={() => setInviting(false)} onDone={(r) => { setInviting(false); setLink(r); refresh(); }} />}
      {link && <InviteLinkDialog {...link} onClose={() => setLink(null)} />}
    </div>
  );
}

function InviteDialog({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: (r: { url: string | null; emailed: boolean; existing: boolean }) => void }) {
  const t = useTranslations('settings.users');
  const ts = useTranslations('settings');
  const locale = useLocale();
  const [v, setV] = useState({ full_name: '', email: '', role: 'sales', title: '', locale });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ inviteUrl: string | null; emailed: boolean; existing: boolean }>('/settings/users/invite', { method: 'POST', json: v }),
    onSuccess: (r) => onDone({ url: r.inviteUrl, emailed: r.emailed, existing: r.existing }),
    onError: (e) => setError(e instanceof ApiError && t.has(`errors.${e.code}`) ? t(`errors.${e.code}` as never) : errText(e)),
  });
  return (
    <Dialog title={t('invite')} onClose={onClose}>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label={`${t('fullName')} *`}><input required minLength={2} autoFocus className={input} value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
        <Field label={`${t('email')} *`}><input required type="email" className={input} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label={t('role')} hint={roles.find((r) => r.key === v.role)?.description ?? undefined}>
          <select className={input} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
        </Field>
        <Field label={t('title')}><input className={input} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label={t('language')}>
          <select className={input} value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })}><option value="el">Ελληνικά</option><option value="en">English</option></select>
        </Field>
        <div className="mt-2 flex items-center justify-end gap-2 sm:col-span-2">
          {error && <span className="mr-auto text-sm text-danger">{error}</span>}
          <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
          <button disabled={save.isPending} className={primaryBtn}>{save.isPending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}{t('invite')}</button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteLinkDialog({ url, emailed, existing, onClose }: { url: string | null; emailed?: boolean; existing?: boolean; onClose: () => void }) {
  const t = useTranslations('settings.users');
  const ts = useTranslations('settings');
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title={t('inviteLink')} onClose={onClose}>
      {existing || !url ? <p className="text-sm">{t('existingAdded')}</p> : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('inviteHint')} {emailed && t('emailed')}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-2 text-xs">{url}</code>
            <button onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-soft px-3 py-2 text-sm font-semibold text-primary">
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t('copied') : t('copy')}
            </button>
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-end"><button onClick={onClose} className={primaryBtn}>{ts('close')}</button></div>
    </Dialog>
  );
}

// ======================================== Approval flow ========================================
type Step = { title: string; required_role: string; min_amount: string | number };

export function ApprovalsSection() {
  const t = useTranslations('settings.approvals');
  const ts = useTranslations('settings');
  const tu = useTranslations('settings.users');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { data } = useQuery({ queryKey: ['settings', 'approvals'], queryFn: () => api<Step[]>('/approval-flow') });
  const [steps, setSteps] = useState<Step[] | null>(null);
  useEffect(() => { if (data) setSteps(data.map((s) => ({ ...s, min_amount: Number(s.min_amount) }))); }, [data]);
  const save = useMutation({
    mutationFn: () => api('/approval-flow', { method: 'PUT', json: steps!.map((s) => ({ ...s, min_amount: Number(s.min_amount) || 0 })) }),
    onSuccess: () => { toast({ title: ts('saved') }); qc.invalidateQueries({ queryKey: ['settings', 'approvals'] }); },
    onError: (e) => toast({ title: ts('error'), body: errText(e) }),
  });
  if (!steps) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const upd = (i: number, patch: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => { const n = [...steps]; [n[i], n[i + d]] = [n[i + d], n[i]]; setSteps(n); };

  return (
    <div className="space-y-3">
      {!isAdmin && <AdminNotice />}
      <p className="text-sm text-muted">{t('intro')}</p>
      {steps.length === 0 && <div className="card p-6 text-center text-sm text-muted">{t('empty')}</div>}
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-bold text-white">{i + 1}</span>
              <span className="flex-1 font-semibold">{s.title || t('step', { n: i + 1 })}</span>
              <span className="hidden text-xs text-muted sm:inline">{Number(s.min_amount) > 0 ? t('fromAmount', { amount: money(s.min_amount, locale, 0) }) : t('always')}</span>
              {isAdmin && (
                <>
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('moveUp')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowUp size={15} /></button>
                  <button type="button" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={t('moveDown')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowDown size={15} /></button>
                  <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={ts('delete')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"><Trash2 size={15} /></button>
                </>
              )}
            </div>
            <fieldset disabled={!isAdmin} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={t('title')}><input required className={input} value={s.title} onChange={(e) => upd(i, { title: e.target.value })} /></Field>
              <Field label={t('role')}>
                <select className={input} value={s.required_role} onChange={(e) => upd(i, { required_role: e.target.value })}>
                  {(['sales', 'manager', 'admin', 'owner'] as const).map((r) => <option key={r} value={r}>{tu(`roles.${r}`)}</option>)}
                </select>
              </Field>
              <Field label={t('minAmount')}><input type="number" min={0} step="1000" className={`${input} tabular`} value={s.min_amount} onChange={(e) => upd(i, { min_amount: e.target.value })} /></Field>
            </fieldset>
          </li>
        ))}
      </ol>
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={steps.length >= 10} onClick={() => setSteps([...steps, { title: '', required_role: 'manager', min_amount: 0 }])} className={ghostBtn}><Plus size={17} /> {t('addStep')}</button>
          <button type="button" disabled={save.isPending || steps.some((s) => !s.title.trim())} onClick={() => save.mutate()} className={clsx(primaryBtn, 'ml-auto')}>
            {save.isPending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} {ts('save')}
          </button>
        </div>
      )}
    </div>
  );
}

// ======================================== Products ========================================
type Product = { id: string; sku: string; name: string; unit: string; unit_price: string; vat_rate: string; active: boolean };

export function ProductsSection() {
  const t = useTranslations('settings.products');
  const ts = useTranslations('settings');
  const locale = useLocale();
  const { isAdmin } = useIsAdmin();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(id); }, [q]);
  const [inactive, setInactive] = useState(true);
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['settings', 'products', dq, inactive],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<Product>>(`/settings/products?inactive=${inactive ? 1 : 0}${dq.length >= 2 ? `&q=${encodeURIComponent(dq)}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-3">
      {!isAdmin && <AdminNotice />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3.5">
          <Search size={17} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ts('search')} className="w-full min-w-0 bg-transparent outline-none" />
          {q && <button onClick={() => setQ('')} aria-label="clear"><X size={16} className="text-muted" /></button>}
        </div>
        {isAdmin && <button onClick={() => setEdit({ unit: 'τεμ.', vat_rate: '24', active: true })} className={primaryBtn}><Plus size={18} /> <span className="hidden sm:inline">{t('add')}</span></button>}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />{t('showInactive')}</label>
      <div className="card divide-y divide-border">
        {rows.length === 0 && !query.isLoading && <p className="p-6 text-center text-sm text-muted">{t('empty')}</p>}
        {rows.map((p) => (
          <button key={p.id} disabled={!isAdmin} onClick={() => setEdit(p)} className={clsx('flex w-full items-center gap-3 p-3.5 text-left hover:bg-surface-2', !p.active && 'opacity-55')}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Package size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.name}</div>
              <div className="text-xs text-muted">{p.sku} · {p.unit} · {t('vat')} {Number(p.vat_rate)}%{!p.active && ` · ${ts('inactive')}`}</div>
            </div>
            <span className="tabular font-semibold">{money(p.unit_price, locale)}</span>
          </button>
        ))}
      </div>
      {query.hasNextPage && <button onClick={() => query.fetchNextPage()} className={clsx(ghostBtn, 'w-full')}>{ts('loadMore')}</button>}
      {edit && <ProductDialog product={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ProductDialog({ product, onClose }: { product: Partial<Product>; onClose: () => void }) {
  const t = useTranslations('settings.products');
  const ts = useTranslations('settings');
  const qc = useQueryClient();
  const [v, setV] = useState({ sku: product.sku ?? '', name: product.name ?? '', unit: product.unit ?? 'τεμ.', unit_price: product.unit_price ?? '', vat_rate: product.vat_rate ?? '24', active: product.active ?? true });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, unit_price: Number(v.unit_price), vat_rate: Number(v.vat_rate) };
      return product.id ? api(`/settings/products/${product.id}`, { method: 'PUT', json: body }) : api('/settings/products', { method: 'POST', json: body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings', 'products'] }); qc.invalidateQueries({ queryKey: ['products'] }); onClose(); },
    onError: (e) => setError(e instanceof ApiError && e.code === 'sku_taken' ? t('skuTaken') : errText(e)),
  });
  return (
    <Dialog title={product.id ? t('edit') : t('add')} onClose={onClose}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label={`${t('sku')} *`}><input required className={`${input} uppercase`} value={v.sku} onChange={(e) => setV({ ...v, sku: e.target.value })} /></Field>
        <Field label={t('unit')}><input required className={input} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} /></Field>
        <Field label={`${t('name')} *`} wide><input required minLength={2} autoFocus className={input} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label={t('price')}><input required type="number" min={0} step="0.01" className={`${input} tabular`} value={v.unit_price} onChange={(e) => setV({ ...v, unit_price: e.target.value })} /></Field>
        <Field label={t('vat')}><input required type="number" min={0} max={100} step="1" className={`${input} tabular`} value={v.vat_rate} onChange={(e) => setV({ ...v, vat_rate: e.target.value })} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />{ts('active')}</label>
        <div className="col-span-2 mt-2 flex items-center justify-end gap-2">
          {error && <span className="mr-auto text-sm text-danger">{error}</span>}
          <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
          <button disabled={save.isPending} className={primaryBtn}>{save.isPending && <Loader2 size={16} className="animate-spin" />}{ts('save')}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ======================================== Value lists ========================================
type ListValue = { id: string; name: string; sort: number; active: boolean; usage: number };
const LISTS = [...ID_LISTS, ...NAME_LISTS] as const;

export function ListsSection() {
  const t = useTranslations('settings.lists');
  const tl = useTranslations('lookup');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const [list, setList] = useState<(typeof LISTS)[number]>('geo_zone');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const { data = [] } = useQuery({ queryKey: ['settings', 'lists', list], queryFn: () => api<ListValue[]>(`/settings/lookups?list=${list}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['settings', 'lists', list] }); qc.invalidateQueries({ queryKey: ['lookups', list] }); };
  const onErr = (e: unknown) => toast({ title: e instanceof ApiError && e.code === 'in_use' ? t('inUse') : e instanceof ApiError && e.code === 'duplicate' ? t('duplicate') : ts('error') });
  const add = useMutation({ mutationFn: () => api('/lookups', { method: 'POST', json: { list, name: newName } }), onSuccess: () => { setNewName(''); refresh(); }, onError: onErr });
  const upd = useMutation({ mutationFn: (x: ListValue) => api(`/settings/lookups/${x.id}`, { method: 'PUT', json: { name: x.name, active: x.active, sort: x.sort } }), onSuccess: () => { setEditing(null); refresh(); }, onError: onErr });
  const del = useMutation({ mutationFn: (id: string) => api(`/settings/lookups/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: onErr });
  const order = useMutation({ mutationFn: (ids: string[]) => api('/settings/lookups/order', { method: 'PUT', json: { ids } }), onSuccess: refresh, onError: onErr });
  const move = (i: number, d: -1 | 1) => { const ids = data.map((x) => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; order.mutate(ids); };

  return (
    <div className="space-y-3">
      {!isAdmin && <AdminNotice />}
      {/* Phone: one dropdown; larger screens: an even 3×3 grid of tabs */}
      <select value={list} onChange={(e) => setList(e.target.value as (typeof LISTS)[number])} aria-label={t('choose')}
        className={clsx(input, 'font-medium sm:hidden')}>
        {LISTS.map((l) => <option key={l} value={l}>{tl(l)}</option>)}
      </select>
      <div className="hidden grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1 sm:grid">
        {LISTS.map((l) => (
          <button key={l} onClick={() => setList(l)} aria-pressed={list === l}
            className={clsx('truncate rounded-xl px-3 py-2 text-center text-sm font-medium transition', list === l ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>{tl(l)}</button>
        ))}
      </div>
      <p className="text-sm text-muted">{t('intro')}</p>
      {isAdmin && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) add.mutate(); }}>
          <input className={input} placeholder={t('add')} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button disabled={!newName.trim() || add.isPending} className={primaryBtn}><Plus size={18} /></button>
        </form>
      )}
      <ul className="card divide-y divide-border">
        {data.map((x, i) => (
          <li key={x.id} className={clsx('flex items-center gap-2 p-3', !x.active && 'opacity-55')}>
            {editing?.id === x.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); upd.mutate({ ...x, name: editing.name }); }}>
                <input autoFocus className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <button className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-white"><Check size={17} /></button>
                <button type="button" onClick={() => setEditing(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border"><X size={17} /></button>
              </form>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <div className="break-words font-medium leading-snug">{x.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    {isAdmin ? (
                      <button onClick={() => upd.mutate({ ...x, active: !x.active })} className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', x.active ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')}>
                        {x.active ? ts('active') : ts('inactive')}
                      </button>
                    ) : !x.active && <span>{ts('inactive')}</span>}
                    <span className="tabular">{t('usage', { count: x.usage })}</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 items-center">
                    <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="up" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowUp size={15} /></button>
                    <button disabled={i === data.length - 1} onClick={() => move(i, 1)} aria-label="down" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowDown size={15} /></button>
                    <button onClick={() => setEditing({ id: x.id, name: x.name })} aria-label={ts('edit')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-primary"><Pencil size={15} /></button>
                    <button disabled={x.usage > 0} title={x.usage > 0 ? t('inUse') : ts('delete')} onClick={() => del.mutate(x.id)} aria-label={ts('delete')}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30"><Trash2 size={15} /></button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ======================================== My profile ========================================
export function ProfileSection() {
  const t = useTranslations('settings.profile');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useIsAdmin();
  const [name, setName] = useState('');
  const [lang, setLang] = useState<'el' | 'en'>('el');
  useEffect(() => { if (me) { setName(me.user.full_name); setLang((me.user as { locale?: 'el' | 'en' }).locale ?? 'el'); } }, [me]);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [email, setEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  useEffect(() => { if (me) setEmail(me.user.email); }, [me]);
  const emailChanged = !!me && email.trim().toLowerCase() !== me.user.email.toLowerCase();
  const saveEmail = useMutation({
    mutationFn: () => api('/me/email', { method: 'POST', json: { email, password: emailPw } }),
    onSuccess: () => { toast({ title: t('emailChanged') }); setEmailPw(''); setEmailError(null); qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => setEmailError(e instanceof ApiError && e.code === 'wrong_password' ? t('wrong') : e instanceof ApiError && e.code === 'email_taken' ? t('emailTaken') : errText(e)),
  });
  const [pwError, setPwError] = useState<string | null>(null);
  const saveProfile = useMutation({
    mutationFn: () => api('/me', { method: 'PUT', json: { full_name: name, locale: lang } }),
    onSuccess: () => { toast({ title: ts('saved') }); qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => toast({ title: ts('error'), body: errText(e) }),
  });
  const savePw = useMutation({
    mutationFn: () => api('/me/password', { method: 'POST', json: { current: pw.current, next: pw.next } }),
    onSuccess: () => { toast({ title: t('changed') }); setPw({ current: '', next: '', confirm: '' }); setPwError(null); },
    onError: (e) => setPwError(e instanceof ApiError && e.code === 'wrong_password' ? t('wrong') : errText(e)),
  });
  return (
    <div className="space-y-4">
      <Card title={t('sDetails')}>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveProfile.mutate(); }}>
          <Field label={t('fullName')}><input required minLength={2} className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('language')}>
            <select className={input} value={lang} onChange={(e) => setLang(e.target.value as 'el' | 'en')}><option value="el">Ελληνικά</option><option value="en">English</option></select>
          </Field>
          <div className="flex items-end justify-end"><button disabled={saveProfile.isPending} className={primaryBtn}><Check size={17} /> {ts('save')}</button></div>
        </form>
      </Card>
      <Card title={t('sEmail')} description={t('emailIntro')}>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (emailChanged) saveEmail.mutate(); }}>
          <Field label={t('email')}><input required type="email" autoComplete="email" className={input} value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(null); }} /></Field>
          <Field label={t('current')}><input required={emailChanged} disabled={!emailChanged} type="password" autoComplete="current-password" className={input} value={emailPw} onChange={(e) => setEmailPw(e.target.value)} /></Field>
          <div className="flex items-center justify-end gap-3 sm:col-span-2">
            {emailError && <span className="mr-auto text-sm text-danger">{emailError}</span>}
            <button disabled={!emailChanged || !emailPw || saveEmail.isPending} className={primaryBtn}>{saveEmail.isPending ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} {t('emailSave')}</button>
          </div>
        </form>
      </Card>
      <Card title={t('sPassword')}>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-3" onSubmit={(e) => {
          e.preventDefault();
          if (pw.next !== pw.confirm) return setPwError(t('mismatch'));
          savePw.mutate();
        }}>
          <Field label={t('current')}><input required type="password" autoComplete="current-password" className={input} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label={t('next')}><input required minLength={10} type="password" autoComplete="new-password" className={input} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label={t('confirm')}><input required minLength={10} type="password" autoComplete="new-password" className={input} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <div className="flex items-center justify-end gap-3 sm:col-span-3">
            {pwError && <span className="mr-auto text-sm text-danger">{pwError}</span>}
            <button disabled={savePw.isPending} className={primaryBtn}><KeyRound size={17} /> {t('sPassword')}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ======================================== Audit log ========================================
// Change history: ./audit-log.tsx
export { AuditSection } from './audit-log';
