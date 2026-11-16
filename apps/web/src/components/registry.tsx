'use client';
// AADE / VIES company data: settings panel, "fetch from registry" on the customer form, and
// "update from registry" on a customer's card (preview of the changes, then apply).
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, CheckCircle2, DatabaseZap, KeyRound, Landmark, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Dialog } from './customer-dialogs';
import { useToast } from './providers';

export const REGISTRY_FIELDS = ['name', 'trade_name', 'tax_office', 'activity', 'address_street', 'address_postal', 'address_city'] as const;
export type RegistryField = (typeof REGISTRY_FIELDS)[number];
export type RegistryResult = {
  source: 'aade' | 'vies'; valid: boolean; active: boolean | null; fields: Partial<Record<RegistryField, string>>;
  legal_status?: string | null; registered_at?: string | null; stopped_at?: string | null;
  activities?: { code: string; description: string; main: boolean }[]; message?: string | null;
};
type Config = { lookup_mode: 'off' | 'button' | 'auto'; update_policy: 'empty' | 'overwrite'; fields: RegistryField[]; aade_ready: boolean; vies_enabled: boolean };
type Settings = {
  aade_enabled: boolean; aade_username: string | null; aade_caller_afm: string | null; aade_has_password: boolean; aade_ready: boolean;
  vies_enabled: boolean; lookup_mode: Config['lookup_mode']; update_policy: Config['update_policy']; fields: RegistryField[]; can_edit: boolean;
};

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary disabled:opacity-60';
const primaryBtn = 'flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60';
const smallBtn = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60';
const label = 'mb-2 text-xs font-semibold uppercase tracking-wide text-muted';

export function useRegistryConfig() {
  return useQuery({ queryKey: ['registry-config'], queryFn: () => api<Config>('/registry/config'), staleTime: 300_000 });
}
function errorText(t: ReturnType<typeof useTranslations>, e: unknown) {
  const code = e instanceof ApiError ? e.code : 'error';
  return t.has(`err_${code}`) ? t(`err_${code}` as never) : code;
}

// ================================================================ result card (shared)
function ResultView({ r, current, selected, onToggle }: {
  r: RegistryResult; current?: Partial<Record<RegistryField, string | null>>; selected?: Set<RegistryField>; onToggle?: (f: RegistryField) => void;
}) {
  const t = useTranslations('registry');
  const tf = useTranslations('cform');
  const fieldLabel: Record<RegistryField, string> = {
    name: tf('name'), trade_name: tf('tradeName'), tax_office: tf('taxOffice'), activity: tf('activity'),
    address_street: tf('street'), address_postal: tf('postal'), address_city: tf('city'),
  };
  const rows = REGISTRY_FIELDS.filter((f) => r.fields[f]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">{r.source === 'aade' ? 'ΑΑΔΕ' : 'VIES'}</span>
        {r.valid
          ? (r.active === false
            ? <span className="flex items-center gap-1 text-danger"><AlertTriangle size={15} /> {t('inactive')}{r.stopped_at ? ` (${r.stopped_at})` : ''}</span>
            : <span className="flex items-center gap-1 text-success"><CheckCircle2 size={15} /> {t('valid')}</span>)
          : <span className="flex items-center gap-1 text-danger"><XCircle size={15} /> {r.message ?? t('notFound')}</span>}
        {r.legal_status && <span className="text-muted">· {r.legal_status}</span>}
      </div>
      {r.message && r.valid && <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{r.message}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rows.map((f) => {
            const cur = current?.[f] ?? null;
            const same = cur === r.fields[f];
            return (
              <li key={f} className="flex items-start gap-3 px-3 py-2">
                {onToggle && <input type="checkbox" disabled={same} checked={!same && !!selected?.has(f)} onChange={() => onToggle(f)} className="mt-1 h-4 w-4 accent-[var(--primary)]" />}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="text-xs text-muted">{fieldLabel[f]}</div>
                  <div className="font-medium break-words">{r.fields[f]}</div>
                  {current && !same && cur && <div className="text-xs text-muted line-through break-words">{cur}</div>}
                  {current && same && <div className="text-xs text-success">{t('same')}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {r.activities && r.activities.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t('activities', { count: r.activities.length })}</summary>
          <ul className="mt-1 space-y-0.5 pl-4 text-xs">
            {r.activities.map((a) => <li key={a.code}><span className="tabular text-muted">{a.code}</span> {a.description}{a.main && <b> · {t('main')}</b>}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

// ================================================================ customer form: lookup by VAT
/**
 * Button next to ΑΦΜ (mode "button") or automatic lookup when a valid ΑΦΜ is typed (mode "auto",
 * fills only empty fields). The user picks which values to apply.
 */
export function RegistryLookup({ vat, country, valid, values, onApply }: {
  vat: string; country: string; valid: boolean; values: Partial<Record<RegistryField, string>>; onApply: (patch: Partial<Record<RegistryField, string>>) => void;
}) {
  const t = useTranslations('registry');
  const toast = useToast();
  const { data: cfg } = useRegistryConfig();
  const [result, setResult] = useState<RegistryResult | null>(null);
  const [sel, setSel] = useState<Set<RegistryField>>(new Set());
  const autoDone = useRef('');
  const lookup = useMutation({
    // the argument says whether this run is the automatic one (fills empty fields without asking)
    mutationFn: (_auto: boolean) => api<RegistryResult>(`/registry/lookup?vat=${encodeURIComponent(vat.trim())}&country=${country || 'GR'}`),
    onSuccess: (r, auto) => {
      const allowed = (cfg?.fields ?? REGISTRY_FIELDS) as RegistryField[];
      const fill = allowed.filter((f) => r.fields[f] && r.fields[f] !== values[f] && (cfg?.update_policy === 'overwrite' || !values[f]?.trim()));
      if (auto && r.valid) {
        // auto mode: fill the empty fields straight away, show what happened
        const patch = Object.fromEntries(fill.filter((f) => !values[f]?.trim()).map((f) => [f, r.fields[f]!]));
        if (Object.keys(patch).length) { onApply(patch); toast({ title: t('autoFilled', { count: Object.keys(patch).length, source: r.source === 'aade' ? 'ΑΑΔΕ' : 'VIES' }) }); }
        if (r.active === false) toast({ title: t('inactive') });
        return;
      }
      setSel(new Set(fill));
      setResult(r);
    },
    onError: (e) => toast({ title: t('lookupFailed'), body: errorText(t, e) }),
  });
  // auto mode
  useEffect(() => {
    if (cfg?.lookup_mode !== 'auto' || !valid || vat.trim().length < 8) return;
    const k = `${country}:${vat.trim()}`;
    if (autoDone.current === k) return;
    const h = setTimeout(() => { autoDone.current = k; lookup.mutate(true); }, 700);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vat, country, valid, cfg?.lookup_mode]);
  if (!cfg || cfg.lookup_mode === 'off' || (!cfg.aade_ready && !cfg.vies_enabled)) return null;
  const source = country === 'GR' && cfg.aade_ready ? 'ΑΑΔΕ' : 'VIES';
  return (
    <>
      <button type="button" disabled={!valid || vat.trim().length < 8 || lookup.isPending} onClick={() => lookup.mutate(false)}
        className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-primary disabled:text-muted">
        {lookup.isPending ? <Loader2 size={13} className="animate-spin" /> : <DatabaseZap size={13} />} {t('fetchFrom', { source })}
      </button>
      {result && (
        <Dialog title={t('resultTitle', { vat: vat.trim() })} onClose={() => setResult(null)}>
          <ResultView r={result} current={values} selected={sel} onToggle={(f) => { const n = new Set(sel); if (n.has(f)) n.delete(f); else n.add(f); setSel(n); }} />
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setResult(null)} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('close')}</button>
            {result.valid && (
              <button type="button" disabled={!sel.size} className={primaryBtn}
                onClick={() => { onApply(Object.fromEntries([...sel].map((f) => [f, result.fields[f]!]))); setResult(null); }}>
                <Check size={16} /> {t('applySelected', { count: sel.size })}
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

// ================================================================ customer card: update from registry
export function RegistryRefreshButton({ customerId, hasVat }: { customerId: string; hasVat: boolean }) {
  const t = useTranslations('registry');
  const toast = useToast();
  const qc = useQueryClient();
  const { data: cfg } = useRegistryConfig();
  const [preview, setPreview] = useState<{ result: RegistryResult; changes: Partial<Record<RegistryField, { from: string | null; to: string }>> } | null>(null);
  const [sel, setSel] = useState<Set<RegistryField>>(new Set());
  const dry = useMutation({
    mutationFn: () => api<{ result: RegistryResult; changes: Partial<Record<RegistryField, { from: string | null; to: string }>> }>(`/customers/${customerId}/registry-refresh`, { method: 'POST', json: { dry_run: true } }),
    onSuccess: (p) => { setPreview(p); setSel(new Set(Object.keys(p.changes) as RegistryField[])); },
    onError: (e) => toast({ title: t('lookupFailed'), body: errorText(t, e) }),
  });
  const apply = useMutation({
    mutationFn: () => api<{ applied: string[] }>(`/customers/${customerId}/registry-refresh`, { method: 'POST', json: { only: [...sel] } }),
    onSuccess: (r) => {
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      toast({ title: t('updated', { count: r.applied.length }) });
    },
    onError: (e) => toast({ title: t('lookupFailed'), body: errorText(t, e) }),
  });
  if (!cfg || cfg.lookup_mode === 'off' || !hasVat || (!cfg.aade_ready && !cfg.vies_enabled)) return null;
  const current = preview ? Object.fromEntries(Object.entries(preview.changes).map(([f, v]) => [f, v!.from])) as Partial<Record<RegistryField, string | null>> : {};
  const fieldsWithResult = preview ? { ...preview.result, fields: Object.fromEntries(Object.entries(preview.changes).map(([f, v]) => [f, v!.to])) } : null;
  return (
    <>
      <button onClick={() => dry.mutate()} disabled={dry.isPending} title={t('refreshTitle')} aria-label={t('refreshTitle')}
        className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-60">
        {dry.isPending ? <Loader2 size={19} className="animate-spin" /> : <RefreshCw size={19} />}
      </button>
      {preview && fieldsWithResult && (
        <Dialog title={t('refreshTitle')} onClose={() => setPreview(null)}>
          {Object.keys(preview.changes).length === 0
            ? <><ResultView r={preview.result} /><p className="mt-3 rounded-xl bg-success-soft px-3 py-2 text-sm text-success">{t('upToDate')}</p></>
            : <ResultView r={fieldsWithResult} current={current} selected={sel} onToggle={(f) => { const n = new Set(sel); if (n.has(f)) n.delete(f); else n.add(f); setSel(n); }} />}
          <p className="mt-3 text-xs text-muted">{cfg.update_policy === 'empty' ? t('policyEmptyHint') : t('policyOverwriteHint')}</p>
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <button onClick={() => setPreview(null)} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('close')}</button>
            {Object.keys(preview.changes).length > 0 && (
              <button onClick={() => apply.mutate()} disabled={!sel.size || apply.isPending} className={primaryBtn}>
                {apply.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('applySelected', { count: sel.size })}
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

// ================================================================ settings panel (Settings → Customers)
export function RegistrySettingsPanel() {
  const t = useTranslations('registry');
  const tf = useTranslations('cform');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings', 'registries'], queryFn: () => api<Settings>('/settings/registries') });
  const [v, setV] = useState<Settings | null>(null);
  const [password, setPassword] = useState('');
  const [testVat, setTestVat] = useState('');
  const [test, setTest] = useState<RegistryResult | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  const save = useMutation({
    mutationFn: (removePassword?: boolean) => api('/settings/registries', { method: 'PUT', json: {
      aade_enabled: v!.aade_enabled, aade_username: v!.aade_username, aade_caller_afm: v!.aade_caller_afm ?? '',
      aade_password: removePassword ? null : password || undefined,
      vies_enabled: v!.vies_enabled, lookup_mode: v!.lookup_mode, update_policy: v!.update_policy, fields: v!.fields,
    } }),
    onSuccess: () => { setPassword(''); qc.invalidateQueries({ queryKey: ['settings', 'registries'] }); qc.invalidateQueries({ queryKey: ['registry-config'] }); toast({ title: ts('saved') }); },
    onError: () => toast({ title: ts('error') }),
  });
  const runTest = useMutation({
    mutationFn: () => api<{ result: RegistryResult }>('/settings/registries/test', { method: 'POST', json: { vat: testVat.trim(), country: 'GR' } }),
    onSuccess: (r) => setTest(r.result),
    onError: (e) => { setTest(null); toast({ title: t('lookupFailed'), body: errorText(t, e) }); },
  });
  if (!v) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const ro = !v.can_edit;
  const fieldLabel: Record<RegistryField, string> = {
    name: tf('name'), trade_name: tf('tradeName'), tax_office: tf('taxOffice'), activity: tf('activity'),
    address_street: tf('street'), address_postal: tf('postal'), address_city: tf('city'),
  };
  const toggleField = (f: RegistryField) => setV({ ...v, fields: v.fields.includes(f) ? v.fields.filter((x) => x !== f) : [...v.fields, f] });
  const Toggle = ({ on, onChange, title, hint, icon: I }: { on: boolean; onChange: (b: boolean) => void; title: string; hint: string; icon: typeof Landmark }) => (
    <label className={clsx('flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition', on ? 'border-primary bg-primary-soft/40' : 'border-border', ro && 'cursor-not-allowed opacity-60')}>
      <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', on ? 'bg-primary text-white' : 'bg-surface-2 text-muted')}><I size={17} /></span>
      <span className="min-w-0 flex-1"><span className="block font-medium">{title}</span><span className="block text-sm text-muted">{hint}</span></span>
      <input type="checkbox" disabled={ro} checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--primary)]" />
    </label>
  );
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(false); }}>
      {ro && <p className="flex items-center gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info"><ShieldCheck size={16} /> {ts('adminOnly')}</p>}
      <div className="space-y-2">
        <Toggle icon={Landmark} on={v.aade_enabled} onChange={(b) => setV({ ...v, aade_enabled: b })} title={t('aadeTitle')} hint={t('aadeHint')} />
        {v.aade_enabled && (
          <div className="grid gap-3 rounded-2xl border border-border p-3.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">{t('username')}</span>
              <input disabled={ro} autoComplete="off" className={input} value={v.aade_username ?? ''} onChange={(e) => setV({ ...v, aade_username: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
                {t('password')}
                {v.aade_has_password && <span className="flex items-center gap-1 text-success"><KeyRound size={12} /> {t('passwordSaved')}</span>}
              </span>
              <input disabled={ro} type="password" autoComplete="new-password" className={input} placeholder={v.aade_has_password ? t('passwordKeep') : ''}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">{t('callerAfm')}</span>
              <input disabled={ro} inputMode="numeric" maxLength={9} className={clsx(input, 'tabular')} value={v.aade_caller_afm ?? ''} onChange={(e) => setV({ ...v, aade_caller_afm: e.target.value.replace(/\D/g, '') })} />
            </label>
            <div className="flex items-end text-xs text-muted">{t('aadeHowTo')}</div>
            {v.aade_has_password && !ro && (
              <button type="button" onClick={() => save.mutate(true)} className="text-left text-xs font-medium text-danger sm:col-span-2">{t('removePassword')}</button>
            )}
          </div>
        )}
        <Toggle icon={DatabaseZap} on={v.vies_enabled} onChange={(b) => setV({ ...v, vies_enabled: b })} title={t('viesTitle')} hint={t('viesHint')} />
      </div>

      <div>
        <div className={label}>{t('modeTitle')}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(['off', 'button', 'auto'] as const).map((m) => (
            <button key={m} type="button" disabled={ro} onClick={() => setV({ ...v, lookup_mode: m })} aria-pressed={v.lookup_mode === m}
              className={clsx('rounded-2xl border p-3 text-left transition', v.lookup_mode === m ? 'border-primary bg-primary-soft/50' : 'border-border hover:bg-surface-2')}>
              <span className="block text-sm font-medium">{t(`mode_${m}`)}</span><span className="block text-xs text-muted">{t(`modeHint_${m}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={label}>{t('policyTitle')}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['empty', 'overwrite'] as const).map((p) => (
            <button key={p} type="button" disabled={ro} onClick={() => setV({ ...v, update_policy: p })} aria-pressed={v.update_policy === p}
              className={clsx('rounded-2xl border p-3 text-left transition', v.update_policy === p ? 'border-primary bg-primary-soft/50' : 'border-border hover:bg-surface-2')}>
              <span className="block text-sm font-medium">{t(`policy_${p}`)}</span><span className="block text-xs text-muted">{t(`policyHint_${p}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={label}>{t('fieldsTitle')}</div>
        <div className="grid gap-1 sm:grid-cols-2">
          {REGISTRY_FIELDS.map((f) => (
            <label key={f} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" disabled={ro} checked={v.fields.includes(f)} onChange={() => toggleField(f)} className="h-4 w-4 accent-[var(--primary)]" />
              {fieldLabel[f]}
            </label>
          ))}
        </div>
      </div>

      {!ro && (
        <div className="flex justify-end border-t border-border pt-4">
          <button disabled={save.isPending} className={primaryBtn}>{save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {ts('save')}</button>
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-border p-3.5">
        <div className={label}>{t('testTitle')}</div>
        <div className="flex gap-2">
          <input inputMode="numeric" maxLength={12} className={clsx(input, 'tabular')} placeholder={t('testPlaceholder')} value={testVat} onChange={(e) => setTestVat(e.target.value.replace(/\s/g, ''))} />
          <button type="button" disabled={testVat.trim().length < 8 || runTest.isPending || ro} onClick={() => runTest.mutate()} className={smallBtn}>
            {runTest.isPending ? <Loader2 size={15} className="animate-spin" /> : <DatabaseZap size={15} />} {t('test')}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">{t('testHint')}</p>
        {test && <div className="mt-3"><ResultView r={test} /></div>}
      </div>
    </form>
  );
}
