'use client';
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeft, Building, Check, CircleCheck, Loader2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Link, useRouter } from '@/i18n/navigation';
import { IconButton, Segmented } from './ui';
import { LookupSelect, PrefecturesDatalist } from './lookup-select';
import { PREFECTURES_LIST_ID } from '@/lib/greece';

export type CustomerFormValues = {
  kind: 'group' | 'company'; code: string; geo_zone_id: string | null; name: string; trade_name: string; vat: string; tax_office: string; gemi: string; activity: string;
  status: 'active' | 'prospect' | 'negotiation' | 'inactive'; category: string; tags: string[]; source: string;
  parent_id: string | null; parent_name?: string | null; account_manager_id: string | null;
  email: string; phone: string; mobile: string; website: string;
  address_street: string; address_city: string; address_postal: string; address_region: string; address_country: string;
  billing_same: boolean; billing: { street: string; city: string; postal: string; region: string; country: string };
  payment_terms: string; credit_limit: string; discount: string; annual_value: string; notes: string;
};

export const emptyCustomer = (): CustomerFormValues => ({
  kind: 'company', code: '', geo_zone_id: null, name: '', trade_name: '', vat: '', tax_office: '', gemi: '', activity: '',
  status: 'prospect', category: '', tags: [], source: '', parent_id: null, account_manager_id: null,
  email: '', phone: '', mobile: '', website: '',
  address_street: '', address_city: '', address_postal: '', address_region: '', address_country: 'GR',
  billing_same: true, billing: { street: '', city: '', postal: '', region: '', country: 'GR' },
  payment_terms: '', credit_limit: '', discount: '0', annual_value: '0', notes: '',
});

/** Greek ΑΦΜ check digit (same algorithm as the API). */
export function isValidAfm(v: string) {
  if (!/^\d{9}$/.test(v) || v === '000000000') return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(v[i]) * 2 ** (8 - i);
  return (sum % 11) % 10 === Number(v[8]);
}

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary aria-[invalid=true]:border-danger';
const TERMS = ['cash', '15d', '30d', '60d', '90d', 'card', 'transfer'] as const;
const SOURCES = ['referral', 'website', 'exhibition', 'cold', 'partner', 'other'] as const;
const CATEGORIES = ['strategic', 'key', 'regular', 'small'] as const;

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, error, hint, wide, children }: { label: string; error?: string | null; hint?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <label className={clsx('block min-w-0', wide && 'sm:col-span-2')}>
      <span className="mb-1 block truncate text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs">{hint}</span> : null}
    </label>
  );
}

export function CustomerForm({ customerId, initial }: { customerId?: string; initial: CustomerFormValues }) {
  const t = useTranslations('cform');
  const ts = useTranslations('status');
  const router = useRouter();
  const qc = useQueryClient();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState('');
  const set = <K extends keyof CustomerFormValues>(k: K, val: CustomerFormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const setBilling = (k: keyof CustomerFormValues['billing'], val: string) => setV((x) => ({ ...x, billing: { ...x.billing, [k]: val } }));

  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; full_name: string; role: string }[]>('/users'), staleTime: 300_000 });

  // ΑΦΜ: instant checksum + debounced duplicate check against this tenant
  const vat = useDebounced(v.vat.trim());
  const afmOk = v.address_country !== 'GR' || !v.vat.trim() || isValidAfm(v.vat.trim());
  const dup = useQuery({
    queryKey: ['check-vat', vat, customerId], enabled: vat.length >= 5,
    queryFn: () => api<{ valid: boolean; duplicates: { id: string; name: string; code: string }[] }>(
      `/customers/check-vat?vat=${encodeURIComponent(vat)}&country=${v.address_country}${customerId ? `&exclude=${customerId}` : ''}`),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        kind: v.kind, code: v.code.trim(), geo_zone_id: v.geo_zone_id, name: v.name, trade_name: v.trade_name, vat: v.vat.trim(), tax_office: v.tax_office, gemi: v.gemi, activity: v.activity,
        status: v.status, category: v.category, tags: v.tags, source: v.source, parent_id: v.kind === 'company' ? v.parent_id : null,
        account_manager_id: v.account_manager_id, email: v.email, phone: v.phone, mobile: v.mobile, website: v.website,
        address_street: v.address_street, address_city: v.address_city, address_postal: v.address_postal,
        address_region: v.address_region, address_country: v.address_country || 'GR',
        billing_address: v.billing_same ? null : v.billing,
        payment_terms: v.payment_terms, credit_limit: v.credit_limit === '' ? null : Number(v.credit_limit),
        discount: Number(v.discount || 0), annual_value: Number(v.annual_value || 0), notes: v.notes,
      };
      if (customerId) { await api(`/customers/${customerId}`, { method: 'PUT', json: body }); return customerId; }
      return (await api<{ id: string }>('/customers', { method: 'POST', json: body })).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', id] });
      router.replace(`/customers/${id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'invalid_parent') setErrors({ parent_id: 'invalid' });
      else if (e instanceof ApiError && e.code === 'code_taken') { setErrors({ code: t('codeTaken') }); document.getElementById('cust-code')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      else setErrors({ _form: e instanceof ApiError ? e.code : 'error' });
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = t('required');
    if (v.code.trim() && !/^[\p{L}\p{N}._/-]+$/u.test(v.code.trim())) errs.code = t('codeInvalid');
    if (!afmOk) errs.vat = t('afmInvalid');
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errs.email = t('invalidEmail');
    setErrors(errs);
    if (Object.keys(errs).length) { document.querySelector('[aria-invalid=true]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    save.mutate();
  }

  const addTag = () => {
    const tag = tagDraft.trim().toLowerCase();
    if (tag && !v.tags.includes(tag) && v.tags.length < 20) set('tags', [...v.tags, tag]);
    setTagDraft('');
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-4 pb-28" noValidate>
      <header className="flex items-center gap-1">
        <IconButton label="back" onClick={() => router.back()}><ArrowLeft size={22} /></IconButton>
        <h1 className="flex-1 text-xl font-bold">{customerId ? t('editTitle') : t('newTitle')}</h1>
      </header>

      <Section title={t('sIdentity')}>
        <div className="sm:col-span-2">
          <Segmented value={v.kind} onChange={(k) => set('kind', k)} options={[
            { value: 'company', label: t('company') }, { value: 'group', label: t('group') },
          ]} />
        </div>
        <Field label={t('code')} error={errors.code}>
          <input id="cust-code" className={`${input} tabular`} placeholder={customerId ? '' : t('codeAuto')} maxLength={40} value={v.code}
            aria-invalid={!!errors.code} onChange={(e) => set('code', e.target.value.replace(/\s/g, ''))} />
        </Field>
        <div className="hidden sm:block" />
        <Field label={`${t('name')} *`} error={errors.name} wide>
          <input className={input} value={v.name} aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} autoFocus={!customerId} />
        </Field>
        <Field label={t('tradeName')}><input className={input} value={v.trade_name} onChange={(e) => set('trade_name', e.target.value)} /></Field>
        <Field label={t('vat')} error={errors.vat ?? (!afmOk ? t('afmInvalid') : null)} hint={
          dup.data?.duplicates.length ? (
            <span className="flex flex-wrap items-center gap-1 text-warning"><AlertTriangle size={13} /> {t('duplicate')}
              {dup.data.duplicates.map((d) => <Link key={d.id} href={`/customers/${d.id}`} className="font-semibold underline">{d.name}</Link>)}
            </span>
          ) : v.vat.trim() && v.address_country === 'GR' && afmOk ? <span className="flex items-center gap-1 text-success"><CircleCheck size={13} /> {t('afmValid')}</span> : null
        }>
          <input className={`${input} tabular`} inputMode="numeric" maxLength={20} value={v.vat} aria-invalid={!afmOk} onChange={(e) => set('vat', e.target.value.replace(/\s/g, ''))} />
        </Field>
        <Field label={t('taxOffice')}><input className={input} value={v.tax_office} onChange={(e) => set('tax_office', e.target.value)} /></Field>
        <Field label={t('gemi')}><input className={input} value={v.gemi} onChange={(e) => set('gemi', e.target.value)} /></Field>
        <Field label={t('activity')} wide><input className={input} value={v.activity} onChange={(e) => set('activity', e.target.value)} /></Field>
        {v.kind === 'company' && (
          <Field label={t('parent')} wide error={errors.parent_id ? t('required') : null}>
            <ParentPicker value={v.parent_id ? { id: v.parent_id, name: v.parent_name ?? '' } : null} exclude={customerId}
              onChange={(p) => setV((x) => ({ ...x, parent_id: p?.id ?? null, parent_name: p?.name ?? null }))} />
          </Field>
        )}
      </Section>

      <Section title={t('sContact')}>
        <Field label={t('email')} error={errors.email}><input type="email" className={input} value={v.email} aria-invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={t('website')}><input className={input} placeholder="https://" value={v.website} onChange={(e) => set('website', e.target.value)} /></Field>
        <Field label={t('phone')}><input type="tel" className={input} value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={t('mobile')}><input type="tel" className={input} value={v.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
      </Section>

      <Section title={t('sAddress')}>
        <Field label={t('street')} wide><input className={input} value={v.address_street} onChange={(e) => set('address_street', e.target.value)} /></Field>
        <Field label={t('city')}><input className={input} value={v.address_city} onChange={(e) => set('address_city', e.target.value)} /></Field>
        <Field label={t('postal')}><input className={`${input} tabular`} inputMode="numeric" value={v.address_postal} onChange={(e) => set('address_postal', e.target.value)} /></Field>
        <Field label={t('prefecture')}><input className={input} list={PREFECTURES_LIST_ID} value={v.address_region} onChange={(e) => set('address_region', e.target.value)} /></Field>
        <Field label={t('geoZone')}><LookupSelect list="geo_zone" className={input} value={v.geo_zone_id} onChange={(id) => set('geo_zone_id', id)} /></Field>
        <Field label={t('country')}>
          <select className={input} value={v.address_country} onChange={(e) => set('address_country', e.target.value)}>
            {['GR', 'CY', 'BG', 'RO', 'IT', 'DE', 'FR', 'GB', 'US'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.billing_same} onChange={(e) => set('billing_same', e.target.checked)} />
          {t('billingSame')}
        </label>
        {!v.billing_same && (
          <>
            <div className="text-sm font-semibold sm:col-span-2">{t('sBilling')}</div>
            <Field label={t('street')} wide><input className={input} value={v.billing.street} onChange={(e) => setBilling('street', e.target.value)} /></Field>
            <Field label={t('city')}><input className={input} value={v.billing.city} onChange={(e) => setBilling('city', e.target.value)} /></Field>
            <Field label={t('postal')}><input className={input} value={v.billing.postal} onChange={(e) => setBilling('postal', e.target.value)} /></Field>
          </>
        )}
      </Section>

      <Section title={t('sTerms')}>
        <Field label={t('paymentTerms')}>
          <select className={input} value={v.payment_terms} onChange={(e) => set('payment_terms', e.target.value)}>
            <option value="">—</option>
            {TERMS.map((x) => <option key={x} value={x}>{t(`terms.${x}`)}</option>)}
          </select>
        </Field>
        <Field label={t('discount')}><input type="number" min={0} max={100} step="0.5" className={`${input} tabular`} value={v.discount} onChange={(e) => set('discount', e.target.value)} /></Field>
        <Field label={t('creditLimit')}><input type="number" min={0} step="100" className={`${input} tabular`} value={v.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} /></Field>
        <Field label={t('annualValue')}><input type="number" min={0} step="1000" className={`${input} tabular`} value={v.annual_value} onChange={(e) => set('annual_value', e.target.value)} /></Field>
      </Section>

      <Section title={t('sClass')}>
        <Field label={t('status')}>
          <select className={input} value={v.status} onChange={(e) => set('status', e.target.value as CustomerFormValues['status'])}>
            {(['prospect', 'negotiation', 'active', 'inactive'] as const).map((s) => <option key={s} value={s}>{ts(s)}</option>)}
          </select>
        </Field>
        <Field label={t('manager')}>
          <select className={input} value={v.account_manager_id ?? ''} onChange={(e) => set('account_manager_id', e.target.value || null)}>
            <option value="">—</option>
            {users.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label={t('category')}>
          <input className={input} list="customer-categories" value={v.category} onChange={(e) => set('category', e.target.value)} />
          <datalist id="customer-categories">{CATEGORIES.map((c) => <option key={c} value={t(`categories.${c}`)} />)}</datalist>
        </Field>
        <Field label={t('source')}>
          <select className={input} value={v.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">—</option>
            {SOURCES.map((x) => <option key={x} value={x}>{t(`sources.${x}`)}</option>)}
          </select>
        </Field>
        <Field label={t('tags')} wide hint={<span className="text-muted">{t('tagsHint')}</span>}>
          <div className="flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-2 py-1.5 focus-within:border-primary">
            {v.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">
                #{tag}
                <button type="button" aria-label={`remove ${tag}`} onClick={() => set('tags', v.tags.filter((x) => x !== tag))}><X size={12} /></button>
              </span>
            ))}
            <input className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 outline-none" value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)} onBlur={addTag}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } else if (e.key === 'Backspace' && !tagDraft) set('tags', v.tags.slice(0, -1)); }} />
          </div>
        </Field>
      </Section>

      <PrefecturesDatalist />
      <Section title={t('sNotes')}>
        <Field label={t('notes')} wide><textarea rows={4} className={input} value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </Section>

      <div className="card sticky bottom-24 z-20 flex items-center justify-end gap-2 p-3 lg:bottom-4">
        {errors._form && <span className="mr-auto text-sm text-danger">{errors._form}</span>}
        <button type="button" onClick={() => router.back()} className="rounded-xl border border-border px-5 py-2.5 font-medium">{t('cancel')}</button>
        <button disabled={save.isPending} className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-60">
          {save.isPending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} {t('save')}
        </button>
      </div>
    </form>
  );
}

/** Searchable picker for the parent group. */
function ParentPicker({ value, onChange, exclude }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void; exclude?: string }) {
  const t = useTranslations('cform');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q.trim(), 250);
  const res = useQuery({
    queryKey: ['groups', dq], enabled: open,
    queryFn: () => api<{ id: string; name: string; code: string }[]>(`/customers/groups${dq ? `?q=${encodeURIComponent(dq)}` : ''}`),
  });
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
        <Building size={16} className="text-primary" />
        <span className="flex-1 truncate font-medium">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} aria-label="clear"><X size={16} className="text-muted" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className={input} placeholder={t('noParent')} value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)} />
      {open && !!res.data?.length && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-xl border border-border bg-surface shadow-xl">
          {res.data.filter((g) => g.id !== exclude).map((g) => (
            <li key={g.id}>
              <button type="button" onMouseDown={() => { onChange({ id: g.id, name: g.name }); setQ(''); }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-2">
                <Building size={15} className="text-muted" /> <span className="flex-1 truncate">{g.name}</span>
                <span className="text-xs text-muted">{g.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
