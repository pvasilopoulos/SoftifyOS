'use client';
import { useTabDraft } from './tabs';
import { CustomerAvatar } from './customer-avatar';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, MapPin, Package, Plus, Search, Trash2, X } from 'lucide-react';
import { api, ApiError, type Customer, type Page } from '@/lib/api';
import { money } from '@/lib/format';
import { useRouter } from '@/i18n/navigation';
import { EntityTile, IconButton } from './ui';

export type EditorItem = {
  key: string; product_id: string | null; space_id?: string | null; description: string; unit: string;
  quantity: number; unit_price: number; discount: number; vat_rate: number;
};
type Product = { id: string; sku: string; name: string; unit: string; unit_price: string; vat_rate: string };
type Branch = { id: string; name: string; city: string | null; spaces: { id: string; name: string; kind: string }[] };

export type EditorInitial = {
  offerId?: string;
  nextVersion?: number;
  customer?: { id: string; name: string } | null;
  branch_id?: string | null; space_id?: string | null; company_id?: string | null;
  valid_until?: string | null; notes?: string | null;
  items?: EditorItem[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const uid = () => Math.random().toString(36).slice(2);
const inDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

export function lineNet(i: Pick<EditorItem, 'quantity' | 'unit_price' | 'discount'>) {
  return r2(i.quantity * i.unit_price * (1 - i.discount / 100));
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

const input = 'w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none focus:border-primary';
const label = 'mb-1 block truncate whitespace-nowrap text-xs font-medium text-muted';
// Compact cell for the item grid (fits 3 per row on a phone)
const cell = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-2.5 py-2.5 text-sm outline-none focus:border-primary';

export function OfferEditor({ initial }: { initial: EditorInitial }) {
  const t = useTranslations('editor');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const isEdit = !!initial.offerId;

  const [customer, setCustomer] = useState(initial.customer ?? null);
  const [branchId, setBranchId] = useState(initial.branch_id ?? '');
  const [companyId, setCompanyId] = useState(initial.company_id ?? '');
  const [validUntil, setValidUntil] = useState(initial.valid_until?.slice(0, 10) ?? inDays(30));
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [versionNote, setVersionNote] = useState('');
  const initialItems = useMemo(() => (initial.items ?? []).map((i) => ({ ...i, space_id: i.space_id ?? initial.space_id ?? null })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);
  const [items, setItems] = useState<EditorItem[]>(initialItems);
  const [picker, setPicker] = useState(false);
  // Draft of the whole editor, kept with the tab
  type Draft = { customer: typeof customer; branchId: string; validUntil: string; notes: string; versionNote: string; items: EditorItem[] };
  const draft: Draft = { customer, branchId, validUntil, notes, versionNote, items };
  const initialDraft = useMemo<Draft>(() => ({
    customer: initial.customer ?? null, branchId: initial.branch_id ?? '',
    validUntil: initial.valid_until?.slice(0, 10) ?? inDays(30), notes: initial.notes ?? '', versionNote: '', items: initialItems,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const applyDraft = (d: Draft) => {
    setCustomer(d.customer); setBranchId(d.branchId); setValidUntil(d.validUntil);
    setNotes(d.notes); setVersionNote(d.versionNote); setItems(d.items);
  };
  const clearDraft = useTabDraft(`offer.${initial.offerId ?? 'new'}`, draft, applyDraft, initialDraft);
  const [error, setError] = useState<string | null>(null);

  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api<{ id: string; name: string }[]>('/companies') });
  useEffect(() => { if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id); }, [companies.data, companyId]);
  const branches = useQuery({
    queryKey: ['branches', customer?.id], enabled: !!customer,
    queryFn: () => api<Branch[]>(`/customers/${customer!.id}/branches`),
  });
  const spaces = branches.data?.find((b) => b.id === branchId)?.spaces ?? [];
  // Store changed: spaces of the previous store no longer apply
  const changeBranch = (id: string) => { setBranchId(id); setItems((xs) => xs.map((x) => (x.space_id ? { ...x, space_id: null } : x))); };

  const totals = useMemo(() => {
    const net = r2(items.reduce((a, i) => a + lineNet(i), 0));
    const vat = r2(items.reduce((a, i) => a + r2(lineNet(i) * i.vat_rate / 100), 0));
    return { net, vat, total: r2(net + vat) };
  }, [items]);

  const update = (key: string, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const addFree = () => setItems((xs) => [...xs, { key: uid(), product_id: null, description: '', unit: 'τεμ.', quantity: 1, unit_price: 0, discount: 0, vat_rate: 24 }]);
  const addProduct = (p: Product) => {
    setItems((xs) => [...xs, { key: uid(), product_id: p.id, description: p.name, unit: p.unit, quantity: 1, unit_price: Number(p.unit_price), discount: 0, vat_rate: Number(p.vat_rate) }]);
    setPicker(false);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        branch_id: branchId || null, space_id: null, company_id: companyId || null,
        valid_until: validUntil || null, notes: notes || null,
        items: items.map(({ key: _k, ...i }) => ({ ...i, space_id: spaces.some((s) => s.id === i.space_id) ? i.space_id : null, description: i.description.trim() })),
      };
      if (isEdit) {
        await api(`/offers/${initial.offerId}/items`, { method: 'PUT', json: { ...payload, note: versionNote || null } });
        return initial.offerId!;
      }
      const o = await api<{ id: string }>('/offers', { method: 'POST', json: { ...payload, customer_id: customer!.id } });
      return o.id;
    },
    onSuccess: (id) => {
      clearDraft();
      qc.invalidateQueries({ queryKey: ['offers'] });
      qc.invalidateQueries({ queryKey: ['offer', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.replace(`/offers/${id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.code : 'error'),
  });

  function submit() {
    setError(null);
    if (!customer) return setError(t('needCustomer'));
    if (!items.length || items.some((i) => !i.description.trim())) return setError(t('needItems'));
    save.mutate();
  }

  return (
    <div className="space-y-4 pb-24">
      <header className="flex items-center gap-1">
        <IconButton label="back" onClick={() => router.back()}><ArrowLeft size={22} /></IconButton>
        <h1 className="flex-1 text-xl font-bold">{isEdit ? t('editTitle', { v: String(initial.nextVersion).padStart(2, '0') }) : t('newTitle')}</h1>
      </header>

      {/* Customer & placement */}
      <section className="card space-y-3 p-4">
        <div>
          <span className={label}>{t('customer')}</span>
          {customer ? (
            <div className="flex items-center gap-3 rounded-xl border border-border p-2.5">
              <CustomerAvatar name={customer.name} size={40} />
              <span className="flex-1 font-semibold">{customer.name}</span>
              {!isEdit && <button onClick={() => { setCustomer(null); changeBranch(''); }} className="text-sm font-medium text-primary">{t('change')}</button>}
            </div>
          ) : <CustomerSearch onPick={(c) => setCustomer({ id: c.id, name: c.name })} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="branch">{t('branch')}</label>
            <select id="branch" className={input} value={branchId} disabled={!customer} onChange={(e) => changeBranch(e.target.value)}>
              <option value="">{t('none')}</option>
              {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}{b.city ? ` · ${b.city}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="company">{t('company')}</label>
            <select id="company" className={input} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="valid">{t('validUntil')}</label>
            <input id="valid" type="date" className={input} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Items */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t('items')}</h2>
          <span className="text-sm text-muted">{items.length}</span>
        </div>
        <ul className="space-y-3">
          {items.map((it, idx) => (
            <li key={it.key} className="rounded-2xl border border-border p-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted">{idx + 1}</span>
                  <input aria-label={t('description')} placeholder={t('description')} className={input} value={it.description}
                    onChange={(e) => update(it.key, { description: e.target.value })} />
                  <IconButton label={t('remove')} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))} className="shrink-0 text-danger"><Trash2 size={18} /></IconButton>
                </div>
                {spaces.length > 0 && (
                  <div className="flex items-center gap-2 pl-7">
                    <MapPin size={16} className="shrink-0 text-muted" />
                    <select aria-label={t('space')} className={`${cell} ${it.space_id ? 'border-primary/40 text-primary' : 'text-muted'}`}
                      value={it.space_id ?? ''} onChange={(e) => update(it.key, { space_id: e.target.value || null })}>
                      <option value="">{t('space')}: {t('none')}</option>
                      {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="min-w-0">
                  {/* All fields share one row height: single-line labels, inputs aligned to the bottom */}
                  <div className="grid grid-cols-3 items-end gap-2 sm:grid-cols-6">
                    <Num label={t('qty')} value={it.quantity} onChange={(v) => update(it.key, { quantity: v })} step="any" />
                    <div className="min-w-0">
                      <span className={label}>{t('unit')}</span>
                      <input className={cell} value={it.unit} onChange={(e) => update(it.key, { unit: e.target.value })} />
                    </div>
                    <Num label={t('price')} value={it.unit_price} onChange={(v) => update(it.key, { unit_price: v })} step="0.01" />
                    <Num label={t('discount')} value={it.discount} onChange={(v) => update(it.key, { discount: Math.min(100, v) })} step="0.5" />
                    <Num label={t('vat')} value={it.vat_rate} onChange={(v) => update(it.key, { vat_rate: v })} step="1" />
                    {/* Phone: full-width row so large amounts never get cut; desktop: 6th column */}
                    <div className="col-span-3 min-w-0 sm:col-span-1">
                      <span className={`${label} hidden sm:block`}>{t('amount')}</span>
                      <div className="flex items-center justify-between gap-2 rounded-xl bg-primary-soft px-3 py-2.5 text-primary sm:justify-end sm:px-2">
                        <span className="text-xs font-medium sm:hidden">{t('amount')}</span>
                        <span className="tabular truncate text-sm font-bold">{money(lineNet(it), locale)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setPicker(true)} className="flex items-center gap-2 rounded-xl bg-primary-soft px-4 py-2.5 text-sm font-semibold text-primary"><Package size={17} /> {t('addProduct')}</button>
          <button onClick={addFree} className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium"><Plus size={17} /> {t('addLine')}</button>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <label className={label} htmlFor="notes">{t('notes')}</label>
          <textarea id="notes" rows={3} className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {isEdit && (
          <div>
            <label className={label} htmlFor="vnote">{t('versionNote')}</label>
            <input id="vnote" className={input} value={versionNote} onChange={(e) => setVersionNote(e.target.value)} />
          </div>
        )}
      </section>

      {/* Sticky totals + save */}
      <div className="card sticky bottom-24 z-20 flex items-center gap-4 p-4 lg:bottom-4">
        <div className="min-w-0 flex-1 text-sm whitespace-nowrap">
          <div className="flex justify-between gap-3 text-muted"><span>{t('net')}</span><span className="tabular">{money(totals.net, locale)}</span></div>
          <div className="flex justify-between gap-3 text-muted"><span>{t('vatTotal')}</span><span className="tabular">{money(totals.vat, locale)}</span></div>
          <div className="flex justify-between gap-3 text-base font-bold"><span>{t('total')}</span><span className="tabular">{money(totals.total, locale)}</span></div>
          {error && <div className="mt-1 text-danger">{error}</div>}
        </div>
        <button onClick={submit} disabled={save.isPending}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-60">
          {save.isPending && <Loader2 size={18} className="animate-spin" />} {isEdit ? t('saveVersion') : t('save')}
        </button>
      </div>

      {picker && <ProductPicker onPick={addProduct} onClose={() => setPicker(false)} />}
    </div>
  );
}

function Num({ label: l, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step: string }) {
  return (
    <div className="min-w-0">
      <span className={label}>{l}</span>
      <input type="number" inputMode="decimal" min={0} step={step} className={`${cell} tabular`} value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </div>
  );
}

function CustomerSearch({ onPick }: { onPick: (c: Customer) => void }) {
  const t = useTranslations('editor');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const res = useQuery({
    queryKey: ['customer-search', dq], enabled: dq.length >= 2,
    queryFn: ({ signal }) => api<Page<Customer>>(`/customers?limit=8&q=${encodeURIComponent(dq)}`, { signal }),
  });
  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
        <Search size={17} className="text-muted" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchCustomer')} className="w-full bg-transparent py-2.5 outline-none" />
        {res.isFetching && <Loader2 size={16} className="animate-spin text-muted" />}
      </div>
      {!!res.data?.items.length && (
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-auto rounded-xl border border-border">
          {res.data.items.map((c) => (
            <li key={c.id}>
              <button onClick={() => onPick(c)} className="flex w-full items-center gap-3 p-2.5 text-left hover:bg-surface-2">
                <CustomerAvatar name={c.name} size={34} />
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="text-xs text-muted">{c.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductPicker({ onPick, onClose }: { onPick: (p: Product) => void; onClose: () => void }) {
  const t = useTranslations('editor');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const res = useQuery({ queryKey: ['products', dq], queryFn: () => api<Product[]>(`/products${dq ? `?q=${encodeURIComponent(dq)}` : ''}`) });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-t-3xl bg-surface p-5 sheet-pb sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{t('addProduct')}</h2>
          <IconButton label="close" onClick={onClose}><X size={20} /></IconButton>
        </div>
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
          <Search size={17} className="text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchProduct')} className="w-full bg-transparent py-2.5 outline-none" />
        </div>
        <ul className="-mx-1 flex-1 divide-y divide-border overflow-auto">
          {res.data?.map((p) => (
            <li key={p.id}>
              <button onClick={() => onPick(p)} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-surface-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><Package size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-xs text-muted">{p.sku} · {p.unit}</div>
                </div>
                <span className="tabular font-semibold">{money(p.unit_price, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
