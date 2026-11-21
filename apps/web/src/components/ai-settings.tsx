'use client';
// Settings → AI: switch on per organisation (with recorded consent), monthly budget, which features,
// usage this month (per feature / per user) and the last 6 months. Who may use it = role permission "ai.use".
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, Eye, EyeOff, KeyRound, Loader2, Pencil, PlugZap, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { appConfirm } from './confirm';
import type { AiFeature } from '@/lib/ai';
import { Link } from '@/i18n/navigation';
import { Card } from './settings-sections';
import { useToast } from './providers';
import { AiUsageDashboard } from './ai-usage';

const FEATURES: AiFeature[] = ['copilot', 'voice', 'summary', 'actions_summary', 'next_action', 'reports', 'offer_draft', 'import'];
type Data = {
  settings: { enabled: boolean; consent_at: string | null; consent_by: string | null; monthly_budget_usd: number; features: Record<AiFeature, boolean> };
  configured: boolean; model: string; consent_by_name: string | null; env_key: boolean;
  key: { last4: string; set_at: string; set_by_name: string | null } | null;
  month: { spent: number; by_feature: { feature: string; calls: number; usd: number }[]; by_user: { name: string; calls: number; usd: number }[] };
  history: { month: string; usd: number }[];
  roles: { key: string; name: string; ai: boolean }[];
};

export function AiSettingsSection() {
  const t = useTranslations('ai');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'ai'], queryFn: () => api<Data>('/settings/ai') });
  const [form, setForm] = useState<{ enabled: boolean; consent: boolean; monthly_budget_usd: number; features: Record<AiFeature, boolean> } | null>(null);
  useEffect(() => {
    if (q.data) setForm({ enabled: q.data.settings.enabled, consent: !!q.data.settings.consent_at, monthly_budget_usd: q.data.settings.monthly_budget_usd, features: q.data.settings.features });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/settings/ai', { method: 'PUT', json: form }),
    onSuccess: () => { toast({ title: t('saved') }); qc.invalidateQueries({ queryKey: ['settings', 'ai'] }); qc.invalidateQueries({ queryKey: ['ai-status'] }); },
    onError: () => toast({ title: t('saveError') }),
  });
  if (q.isError) return <p className="text-sm text-muted">{t('noAccess')}</p>;
  if (!q.data || !form) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const d = q.data;
  const usd = (n: number) => n.toLocaleString(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const pct = Math.min(100, d.settings.monthly_budget_usd ? (d.month.spent / d.settings.monthly_budget_usd) * 100 : 0);
  const maxHist = Math.max(...d.history.map((h) => h.usd), 0.01);

  return (
    <div className="space-y-4">
      <ApiKeyCard data={d} />

      <Card title={t('title')} description={t('hint', { model: d.model })}>
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-xl border border-border p-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--primary)]" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked, enabled: e.target.checked && form.enabled })} />
            <span className="text-sm">
              <span className="font-semibold">{t('consent')}</span>
              <span className="mt-0.5 block text-muted">{t('consentHint')}</span>
              {d.settings.consent_at && <span className="mt-1 block text-xs text-muted">{t('consentBy', { name: d.consent_by_name ?? '—', date: new Date(d.settings.consent_at).toLocaleDateString(locale) })}</span>}
            </span>
          </label>
          <label className={`flex items-center gap-3 ${!form.consent ? 'opacity-50' : ''}`}>
            <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" disabled={!form.consent} checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span className="text-sm font-semibold">{t('enabled')}</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <label key={f} className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--primary)]" checked={form.features[f]} onChange={(e) => setForm({ ...form, features: { ...form.features, [f]: e.target.checked } })} />
                <span><span className="font-medium">{t(`f_${f}`)}</span><span className="block text-xs text-muted">{t(`fh_${f}`)}</span></span>
              </label>
            ))}
          </div>
          <label className="block max-w-xs text-sm">
            <span className="font-medium">{t('budget')}</span>
            <span className="mt-1 flex items-center gap-2">
              <span className="text-muted">$</span>
              <input type="number" min={0} step={5} value={form.monthly_budget_usd} onChange={(e) => setForm({ ...form, monthly_budget_usd: Number(e.target.value) })}
                className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 outline-none focus:border-primary" />
            </span>
            <span className="mt-1 block text-xs text-muted">{t('budgetHint')}</span>
          </label>
          <div className="flex justify-end">
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('save')}
            </button>
          </div>
        </div>
      </Card>

      <AiUsageDashboard roles={d.roles} />

      <Card title={t('who')} description={t('whoHint')}>
        <ul className="flex flex-wrap gap-2">
          {d.roles.map((r) => (
            <li key={r.key} className={`rounded-full px-3 py-1 text-sm ${r.ai ? 'bg-primary-soft font-medium text-primary' : 'bg-surface-2 text-muted line-through'}`}>{r.name}</li>
          ))}
        </ul>
        <Link href="/settings?s=users" className="mt-3 inline-block text-sm font-medium text-primary">{t('editRoles')}</Link>
      </Card>
    </div>
  );
}

function UsageTable({ title, rows, usd, empty, calls }: { title: string; rows: { label: string; calls: number; usd: number }[]; usd: (n: number) => string; empty: string; calls: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {!rows.length ? <p className="text-sm text-muted">{empty}</p> : (
        <table className="w-full text-sm"><tbody className="divide-y divide-border">
          {rows.map((r) => <tr key={r.label}><td className="py-1.5">{r.label}</td><td className="py-1.5 text-right text-muted tabular">{r.calls} {calls}</td><td className="py-1.5 text-right font-semibold tabular">{usd(r.usd)}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}

// ============================================================ API key (stored encrypted on the server; only "…abcd" comes back)
type TestResult = { ok: boolean; error?: string; detail?: string };
function ApiKeyCard({ data }: { data: Data }) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(!data.key);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['settings', 'ai'] }); qc.invalidateQueries({ queryKey: ['ai-status'] }); };
  const runTest = async (key?: string) => {
    setBusy('test'); setTest(null);
    try { setTest(await api<TestResult>('/settings/ai/key/test', { method: 'POST', json: key ? { key } : {} })); }
    catch { setTest({ ok: false, error: 'api_error' }); }
    setBusy(null);
  };
  const save = async () => {
    setBusy('save'); setTest(null);
    try {
      await api('/settings/ai/key', { method: 'PUT', json: { key: value.trim() } });
      toast({ title: t('keySaved') }); setValue(''); setShow(false); setEditing(false); refresh();
    } catch (e) { setTest({ ok: false, error: e instanceof ApiError ? e.code : 'api_error' }); }
    setBusy(null);
  };
  const remove = async () => {
    if (!(await appConfirm(t('keyConfirmDelete'), { danger: true, confirmLabel: t('keyDelete') }))) return;
    setBusy('delete');
    try { await api('/settings/ai/key', { method: 'DELETE' }); toast({ title: t('keyDeleted') }); setEditing(true); setTest(null); refresh(); }
    catch { toast({ title: t('saveError') }); }
    setBusy(null);
  };
  const cancel = () => { setEditing(false); setValue(''); setTest(null); };
  const btn = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium disabled:opacity-50';

  return (
    <Card title={t('keyTitle')} description={data.env_key ? t('keyHintEnv') : t('keyHint')}>
      <div className="space-y-3">
        {data.key && !editing && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
            <KeyRound size={18} className="shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-mono font-semibold">sk-ant-…{data.key.last4}</div>
              <div className="text-xs text-muted">{t('keySetBy', { name: data.key.set_by_name ?? '—', date: new Date(data.key.set_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}</div>
            </div>
            <button type="button" className={btn} disabled={!!busy} onClick={() => runTest()}>{busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {t('keyTest')}</button>
            <button type="button" className={btn} disabled={!!busy} onClick={() => { setEditing(true); setTest(null); }}><Pencil size={14} /> {t('keyChange')}</button>
            <button type="button" className={`${btn} text-danger hover:bg-danger-soft`} disabled={!!busy} onClick={remove}>{busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} {t('keyDelete')}</button>
          </div>
        )}
        {!data.key && !editing && null}
        {editing && (
          <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) save(); }} className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="ai-key">{data.key ? t('keyNew') : t('keyLabel')}</label>
            <div className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 pr-1.5 focus-within:border-primary">
              <input id="ai-key" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value} onChange={(e) => { setValue(e.target.value); setTest(null); }}
                placeholder="sk-ant-api03-…" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-sm outline-none" />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? t('keyHide') : t('keyShow')} aria-pressed={show}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-text">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {data.key && <button type="button" className={btn} onClick={cancel} disabled={!!busy}>{t('cancel')}</button>}
              <button type="button" className={btn} disabled={!!busy || value.trim().length < 20} onClick={() => runTest(value.trim())}>{busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {t('keyTest')}</button>
              <button type="submit" disabled={!!busy || value.trim().length < 20} className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('keySave')}
              </button>
            </div>
          </form>
        )}
        {test && (
          <p className={`flex items-start gap-1.5 rounded-xl px-3 py-2 text-sm ${test.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
            {test.ok ? <Check size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
            <span>{test.ok ? t('keyOk') : t(`keyErr_${['invalid_key', 'permission', 'rate_limited', 'bad_request', 'connection', 'invalid_key_format', 'no_key'].includes(test.error ?? '') ? test.error : 'api_error'}` as never)}
              {test.detail && <span className="mt-0.5 block text-xs opacity-80">{test.detail}</span>}</span>
          </p>
        )}
        {!data.configured && !editing && <p className="text-sm text-warning">{t('notConfiguredTitle')}</p>}
      </div>
    </Card>
  );
}
