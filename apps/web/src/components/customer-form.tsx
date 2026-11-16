'use client';
import { RegistryLookup } from './registry';
import { useTabDraft, useTabTitle } from './tabs';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeft, Building, Check, CircleCheck, Loader2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { flatValues, useFormConfig, validateForm } from '@/lib/forms';
import { Link, useRouter } from '@/i18n/navigation';
import { IconButton, Segmented } from './ui';
import { LookupSelect, NameSelect } from './lookup-select';
import { FormFields, FormLoading, scrollToError, useFormDefaults, type RendererEntry } from './form-engine';
import { useMe } from './app-shell';

export type CustomerFormValues = {
  kind: 'group' | 'company'; code: string; geo_zone_id: string | null; name: string; trade_name: string; vat: string; tax_office: string; gemi: string; activity: string;
  status: 'active' | 'prospect' | 'negotiation' | 'inactive'; category: string; tags: string[]; source: string;
  parent_id: string | null; parent_name?: string | null; account_manager_id: string | null;
  email: string; phone: string; mobile: string; website: string;
  address_street: string; address_city: string; address_postal: string; address_region: string; address_country: string;
  billing_same: boolean; billing: { street: string; city: string; postal: string; region: string; country: string };
  payment_terms: string; credit_limit: string; discount: string; annual_value: string; notes: string;
  /** Custom fields (Settings → Module Forms) */
  custom: Record<string, unknown>;
};

export const emptyCustomer = (): CustomerFormValues => ({
  kind: 'company', code: '', geo_zone_id: null, name: '', trade_name: '', vat: '', tax_office: '', gemi: '', activity: '',
  status: 'prospect', category: '', tags: [], source: '', parent_id: null, account_manager_id: null,
  email: '', phone: '', mobile: '', website: '',
  address_street: '', address_city: '', address_postal: '', address_region: '', address_country: 'GR',
  billing_same: true, billing: { street: '', city: '', postal: '', region: '', country: 'GR' },
  payment_terms: '', credit_limit: '', discount: '0', annual_value: '0', notes: '', custom: {},
});

/** Greek ΑΦΜ check digit (same algorithm as the API). */
export function isValidAfm(v: string) {
  if (!/^\d{9}$/.test(v) || v === '000000000') return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(v[i]) * 2 ** (8 - i);
  return (sum % 11) % 10 === Number(v[8]);
}

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary aria-[invalid=true]:border-danger';

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

export function CustomerForm({ customerId, initial }: { customerId?: string; initial: CustomerFormValues }) {
  const t = useTranslations('cform');
  const ts = useTranslations('status');
  const router = useRouter();
  const qc = useQueryClient();
  const [v, setV] = useState({ ...initial, custom: initial.custom ?? {} });
  // Unsaved values stay with the tab (switching tabs / reloading keeps them); the tab shows an "unsaved" dot
  useTabTitle(v.name.trim() ? `${customerId ? '✎ ' : '+ '}${v.name.trim()}` : null);
  const clearDraft = useTabDraft(`customer-form.${customerId ?? 'new'}`, v, setV, initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState('');
  const set = <K extends keyof CustomerFormValues>(k: K, val: CustomerFormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const setBilling = (k: keyof CustomerFormValues['billing'], val: string) => setV((x) => ({ ...x, billing: { ...x.billing, [k]: val } }));

  const form = useFormConfig('customer');
  const { data: me } = useMe();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; full_name: string; role: string }[]>('/users'), staleTime: 300_000 });

  // Values as the form rules see them (conditions, required checks)
  const values = useMemo(() => flatValues({ ...v, billing_address: v.billing_same ? null : v.billing }, v.custom), [v]);
  useFormDefaults(form.data, !customerId, values, (patch) => setV((x) => {
    const next = { ...x, custom: { ...x.custom } };
    for (const [k, val] of Object.entries(patch)) {
      if (k.startsWith('cf_')) next.custom[k.slice(3)] = val;
      else if (k in next && k !== 'billing_address') (next as Record<string, unknown>)[k] = typeof val === 'number' ? String(val) : val;
    }
    return next;
  }), { userId: me?.user.id });

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
        discount: Number(v.discount || 0), annual_value: Number(v.annual_value || 0), notes: v.notes, custom: v.custom,
      };
      if (customerId) { await api(`/customers/${customerId}`, { method: 'PUT', json: body }); return customerId; }
      return (await api<{ id: string }>('/customers', { method: 'POST', json: body })).id;
    },
    onSuccess: (id) => {
      clearDraft();
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', id] });
      router.replace(`/customers/${id}`);
    },
    onError: (e) => {
      const fields = e instanceof ApiError ? (e.body as { fields?: Record<string, string> })?.fields : undefined;
      if (fields) { setErrors(fields); scrollToError(); }
      else if (e instanceof ApiError && e.code === 'invalid_parent') setErrors({ parent_id: 'invalid' });
      else if (e instanceof ApiError && e.code === 'code_taken') { setErrors({ code: t('codeTaken') }); document.getElementById('cust-code')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      else setErrors({ _form: e instanceof ApiError ? e.code : 'error' });
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = form.data ? validateForm(form.data, values) : {};
    if (v.name.trim().length < 2) errs.name = t('required');
    if (v.code.trim() && !/^[\p{L}\p{N}._/-]+$/u.test(v.code.trim())) errs.code = t('codeInvalid');
    if (!afmOk) errs.vat = t('afmInvalid');
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errs.email = t('invalidEmail');
    setErrors(errs);
    if (Object.keys(errs).length) { scrollToError(); return; }
    save.mutate();
  }

  const addTag = () => {
    const tag = tagDraft.trim().toLowerCase();
    if (tag && !v.tags.includes(tag) && v.tags.length < 20) set('tags', [...v.tags, tag]);
    setTagDraft('');
  };

  // Own inputs for the built-in fields; custom fields use the generic ones
  const renderers: Record<string, RendererEntry> = {
    kind: { bare: true, render: (c) => (
      <Segmented value={v.kind} onChange={(k) => !c.readonly && set('kind', k)} options={[
        { value: 'company' as const, label: t('company') }, { value: 'group' as const, label: t('group') },
      ].filter((o) => !c.allowed || c.allowed.includes(o.value) || o.value === v.kind)} />
    ) },
    code: (c) => <input id="cust-code" className={`${c.className} tabular`} placeholder={c.placeholder || (customerId ? '' : t('codeAuto'))} maxLength={40} value={v.code}
      aria-invalid={c.invalid} onChange={(e) => set('code', e.target.value.replace(/\s/g, ''))} />,
    name: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.name} aria-invalid={c.invalid} onChange={(e) => set('name', e.target.value)} autoFocus={!customerId} />,
    trade_name: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.trade_name} onChange={(e) => set('trade_name', e.target.value)} />,
    vat: (c) => (
      <>
        <input id={c.id} className={`${c.className} tabular`} placeholder={c.placeholder} inputMode="numeric" maxLength={20} value={v.vat} aria-invalid={c.invalid || !afmOk} onChange={(e) => set('vat', e.target.value.replace(/\s/g, ''))} />
        {!c.error && (!afmOk ? <span className="mt-1 block text-xs text-danger">{t('afmInvalid')}</span>
          : dup.data?.duplicates.length ? (
            <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-warning"><AlertTriangle size={13} /> {t('duplicate')}
              {dup.data.duplicates.map((d) => <Link key={d.id} href={`/customers/${d.id}`} className="font-semibold underline">{d.name}</Link>)}
            </span>
          ) : v.vat.trim() && v.address_country === 'GR' ? <span className="mt-1 flex items-center gap-1 text-xs text-success"><CircleCheck size={13} /> {t('afmValid')}</span> : null)}
        {!c.readonly && (
          <RegistryLookup vat={v.vat} country={v.address_country || 'GR'} valid={afmOk && !!v.vat.trim()}
            values={{ name: v.name, trade_name: v.trade_name, tax_office: v.tax_office, activity: v.activity, address_street: v.address_street, address_postal: v.address_postal, address_city: v.address_city }}
            onApply={(patch) => setV((x) => ({ ...x, ...patch }))} />
        )}
      </>
    ),
    tax_office: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.tax_office} onChange={(e) => set('tax_office', e.target.value)} />,
    gemi: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.gemi} onChange={(e) => set('gemi', e.target.value)} />,
    activity: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.activity} onChange={(e) => set('activity', e.target.value)} />,
    parent_id: (c) => v.kind !== 'company' ? <p className="text-sm text-muted">—</p> : (
      <ParentPicker value={v.parent_id ? { id: v.parent_id, name: v.parent_name ?? '' } : null} exclude={customerId} disabled={c.readonly}
        onChange={(p) => setV((x) => ({ ...x, parent_id: p?.id ?? null, parent_name: p?.name ?? null }))} />
    ),
    email: (c) => <input id={c.id} type="email" className={c.className} placeholder={c.placeholder} value={v.email} aria-invalid={c.invalid} onChange={(e) => set('email', e.target.value)} />,
    website: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder || 'https://'} value={v.website} onChange={(e) => set('website', e.target.value)} />,
    phone: (c) => <input id={c.id} type="tel" className={c.className} placeholder={c.placeholder} value={v.phone} onChange={(e) => set('phone', e.target.value)} />,
    mobile: (c) => <input id={c.id} type="tel" className={c.className} placeholder={c.placeholder} value={v.mobile} onChange={(e) => set('mobile', e.target.value)} />,
    address_street: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.address_street} onChange={(e) => set('address_street', e.target.value)} />,
    address_city: (c) => <input id={c.id} className={c.className} placeholder={c.placeholder} value={v.address_city} onChange={(e) => set('address_city', e.target.value)} />,
    address_postal: (c) => <input id={c.id} className={`${c.className} tabular`} placeholder={c.placeholder} inputMode="numeric" value={v.address_postal} onChange={(e) => set('address_postal', e.target.value)} />,
    address_region: (c) => <NameSelect id={c.id} list="prefecture" className={c.className} allowed={c.allowed} value={v.address_region} onChange={(x) => set('address_region', x)} />,
    geo_zone_id: (c) => <LookupSelect id={c.id} list="geo_zone" className={c.className} allowed={c.allowed} value={v.geo_zone_id} onChange={(id) => set('geo_zone_id', id)} />,
    address_country: (c) => (
      <select id={c.id} className={c.className} value={v.address_country} onChange={(e) => set('address_country', e.target.value)}>
        {['GR', 'CY', 'BG', 'RO', 'IT', 'DE', 'FR', 'GB', 'US'].filter((x) => !c.allowed || c.allowed.includes(x) || x === v.address_country).map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    ),
    billing_address: { bare: true, render: (c) => (
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={v.billing_same} onChange={(e) => set('billing_same', e.target.checked)} />
          {t('billingSame')}{c.required && <span className="text-danger">*</span>}
        </label>
        {!v.billing_same && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="text-sm font-semibold sm:col-span-2">{c.label}</div>
            <label className="block min-w-0 sm:col-span-2"><span className="mb-1 block text-xs font-medium text-muted">{t('street')}</span><input className={c.className} value={v.billing.street} onChange={(e) => setBilling('street', e.target.value)} /></label>
            <label className="block min-w-0"><span className="mb-1 block text-xs font-medium text-muted">{t('city')}</span><input className={c.className} value={v.billing.city} onChange={(e) => setBilling('city', e.target.value)} /></label>
            <label className="block min-w-0"><span className="mb-1 block text-xs font-medium text-muted">{t('postal')}</span><input className={c.className} value={v.billing.postal} onChange={(e) => setBilling('postal', e.target.value)} /></label>
          </div>
        )}
      </div>
    ) },
    payment_terms: (c) => <NameSelect id={c.id} list="payment_terms" className={c.className} allowed={c.allowed} value={v.payment_terms} onChange={(x) => set('payment_terms', x)} />,
    discount: (c) => <input id={c.id} type="number" min={0} max={100} step="0.5" className={`${c.className} tabular`} aria-invalid={c.invalid} value={v.discount} onChange={(e) => set('discount', e.target.value)} />,
    credit_limit: (c) => <input id={c.id} type="number" min={0} step="100" className={`${c.className} tabular`} aria-invalid={c.invalid} value={v.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} />,
    annual_value: (c) => <input id={c.id} type="number" min={0} step="1000" className={`${c.className} tabular`} aria-invalid={c.invalid} value={v.annual_value} onChange={(e) => set('annual_value', e.target.value)} />,
    status: (c) => (
      <select id={c.id} className={c.className} value={v.status} onChange={(e) => set('status', e.target.value as CustomerFormValues['status'])}>
        {(['prospect', 'negotiation', 'active', 'inactive'] as const).filter((s) => !c.allowed || c.allowed.includes(s) || s === v.status).map((s) => <option key={s} value={s}>{ts(s)}</option>)}
      </select>
    ),
    account_manager_id: (c) => (
      <select id={c.id} className={c.className} value={v.account_manager_id ?? ''} onChange={(e) => set('account_manager_id', e.target.value || null)}>
        <option value="">—</option>
        {users.data?.filter((u) => !c.allowed || c.allowed.includes(u.id) || u.id === v.account_manager_id).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
    ),
    category: (c) => <NameSelect id={c.id} list="customer_category" className={c.className} allowed={c.allowed} value={v.category} onChange={(x) => set('category', x)} />,
    source: (c) => <NameSelect id={c.id} list="customer_source" className={c.className} allowed={c.allowed} value={v.source} onChange={(x) => set('source', x)} />,
    tags: (c) => (
      <>
        <div className="flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-2 py-1.5 focus-within:border-primary">
          {v.tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">
              #{tag}
              {!c.readonly && <button type="button" aria-label={`remove ${tag}`} onClick={() => set('tags', v.tags.filter((x) => x !== tag))}><X size={12} /></button>}
            </span>
          ))}
          <input id={c.id} className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 outline-none" value={tagDraft} placeholder={c.placeholder}
            onChange={(e) => setTagDraft(e.target.value)} onBlur={addTag}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } else if (e.key === 'Backspace' && !tagDraft) set('tags', v.tags.slice(0, -1)); }} />
        </div>
        {!c.error && !c.field.help.el && !c.field.help.en && <span className="mt-1 block text-xs text-muted">{t('tagsHint')}</span>}
      </>
    ),
    notes: (c) => <textarea id={c.id} rows={4} className={c.className} placeholder={c.placeholder} value={v.notes} onChange={(e) => set('notes', e.target.value)} />,
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-4 pb-28" noValidate>
      <header className="flex items-center gap-1">
        <IconButton label="back" onClick={() => router.back()}><ArrowLeft size={22} /></IconButton>
        <h1 className="flex-1 text-xl font-bold">{customerId ? t('editTitle') : t('newTitle')}</h1>
      </header>

      {form.data ? (
        <FormFields eff={form.data} values={values} errors={errors} renderers={renderers} idPrefix="cust"
          onChange={(k, val) => setV((x) => k.startsWith('cf_') ? { ...x, custom: { ...x.custom, [k.slice(3)]: val } } : { ...x, [k]: val })} />
      ) : <FormLoading error={form.isError} onRetry={() => form.refetch()} />}

      <div className="card sticky bottom-24 z-20 flex items-center justify-end gap-2 p-3 lg:bottom-4">
        {errors._form && <span className="mr-auto text-sm text-danger">{errors._form}</span>}
        <button type="button" onClick={() => router.back()} className="rounded-xl border border-border px-5 py-2.5 font-medium">{t('cancel')}</button>
        <button disabled={save.isPending || !form.data} className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-60">
          {save.isPending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} {t('save')}
        </button>
      </div>
    </form>
  );
}

/** Searchable picker for the parent group. */
function ParentPicker({ value, onChange, exclude, disabled }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void; exclude?: string; disabled?: boolean }) {
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
        {!disabled && <button type="button" onClick={() => onChange(null)} aria-label="clear"><X size={16} className="text-muted" /></button>}
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
