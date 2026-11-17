'use client';
// Settings → AI: switch on per organisation (with recorded consent), monthly budget, which features,
// usage this month (per feature / per user) and the last 6 months. Who may use it = role permission "ai.use".
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, KeyRound, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { AiFeature } from '@/lib/ai';
import { Link } from '@/i18n/navigation';
import { Card } from './settings-sections';
import { useToast } from './providers';

const FEATURES: AiFeature[] = ['copilot', 'voice', 'summary', 'reports', 'offer_draft', 'import'];
type Data = {
  settings: { enabled: boolean; consent_at: string | null; consent_by: string | null; monthly_budget_usd: number; features: Record<AiFeature, boolean> };
  configured: boolean; model: string; consent_by_name: string | null;
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
      {!d.configured && (
        <div className="flex gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4 text-sm">
          <KeyRound size={18} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <div className="font-semibold">{t('notConfiguredTitle')}</div>
            <p className="mt-1 text-muted">{t('notConfiguredHint')}</p>
            <code className="mt-2 block rounded-lg bg-surface px-2 py-1 text-xs">ANTHROPIC_API_KEY=sk-ant-…</code>
          </div>
        </div>
      )}

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

      <Card title={t('usage')} description={t('usageHint')}>
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm"><span>{t('thisMonth')}</span><span className="font-semibold tabular">{usd(d.month.spent)} / {usd(d.settings.monthly_budget_usd)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full rounded-full ${pct >= 90 ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
            </div>
            {pct >= 90 && <p className="mt-1 flex items-center gap-1 text-xs text-danger"><AlertTriangle size={12} /> {t('nearBudget')}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <UsageTable title={t('byFeature')} rows={d.month.by_feature.map((r) => ({ label: t(`f_${r.feature}` as never), calls: r.calls, usd: r.usd }))} usd={usd} empty={t('noUsage')} calls={t('calls')} />
            <UsageTable title={t('byUser')} rows={d.month.by_user.map((r) => ({ label: r.name, calls: r.calls, usd: r.usd }))} usd={usd} empty={t('noUsage')} calls={t('calls')} />
          </div>
          {d.history.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('history')}</div>
              <div className="flex h-24 items-end gap-2">
                {d.history.map((h) => (
                  <div key={h.month} className="flex flex-1 flex-col items-center gap-1" title={`${h.month}: ${usd(h.usd)}`}>
                    <div className="w-full rounded-t-[4px] bg-primary/80" style={{ height: `${Math.max(2, (h.usd / maxHist) * 80)}px` }} />
                    <span className="text-[11px] text-muted">{h.month.slice(5)}/{h.month.slice(2, 4)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

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
