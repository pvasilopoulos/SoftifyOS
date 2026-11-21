'use client';
// Customer insights: risk level with its reasons (computed by the server, no AI) and the AI "next best action",
// saved per customer so it is only asked again when the user wants or when the data changed.
import { useState } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CalendarPlus, Compass, Loader2, RefreshCw, ShieldAlert, Wand2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAi } from '@/lib/ai';
import { daysFromNow, iconOf, tone, useCrmMeta } from '@/lib/crm';
import { AiErrorNote } from './ai-ui';
import { ActivityEditor, type EditorPreset } from './crm-editor';

export type RiskLevel = 'low' | 'medium' | 'high';
export type RiskReason = { code: string; days?: number; n?: number; amount?: number; from?: number; to?: number };
export type Risk = { score: number; level: RiskLevel; reasons: RiskReason[]; computed_at: string };

type NextAction = {
  situation: string; watch_out: string | null;
  actions: { type: string; subject: string; why: string; due_in_days: number; priority: number }[];
};
type InsightResp = { insight: NextAction | null; generated_at?: string; by_name?: string | null; stale: boolean };

export const levelTone: Record<RiskLevel, string> = {
  high: 'bg-danger-soft text-danger', medium: 'bg-warning-soft text-warning', low: 'bg-surface-2 text-muted',
};

/** Human sentence for one reason ("Καμία επαφή εδώ και 94 ημέρες"). */
export function useReasonText() {
  const t = useTranslations('insights');
  const locale = useLocale();
  const eur = (n?: number) => (n ?? 0).toLocaleString(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  return (r: RiskReason) => t(`r_${r.code}` as never, { days: r.days ?? 0, n: r.n ?? 0, amount: eur(r.amount), from: r.from ?? 0, to: r.to ?? 0 } as never);
}

export function RiskPill({ level, score, className }: { level: RiskLevel; score?: number; className?: string }) {
  const t = useTranslations('insights');
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', levelTone[level], className)}>
      <ShieldAlert size={12} /> {t(`level_${level}`)}{score != null && <span className="tabular opacity-70">· {score}</span>}
    </span>
  );
}

/** Overview card: why this customer is at risk (only shown when there is a signal) + the AI next step. */
export function CustomerInsightsCard({ customerId, customerName }: { customerId: string; customerName: string }) {
  const t = useTranslations('insights');
  const locale = useLocale();
  const qc = useQueryClient();
  const aiOn = useAi('next_action');
  const reason = useReasonText();
  const meta = useCrmMeta();
  const risk = useQuery({ queryKey: ['risk', customerId], queryFn: () => api<{ risk: Risk | null }>(`/customers/${customerId}/risk`), staleTime: 300_000 });
  const next = useQuery({ queryKey: ['next-action', customerId], enabled: aiOn, queryFn: () => api<InsightResp>(`/ai/customers/${customerId}/next-action`), staleTime: 60_000 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState<EditorPreset | null>(null);
  const r = risk.data?.risk;
  if (!r && !aiOn) return null;

  const ask = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api<InsightResp>(`/ai/customers/${customerId}/next-action`, { method: 'POST', json: { locale } });
      qc.setQueryData(['next-action', customerId], { ...res, by_name: null });
    } catch (e) { setErr(e instanceof ApiError ? e.code : 'error'); }
    setBusy(false);
  };
  const ins = next.data?.insight;
  const typeOf = (k: string) => meta.data?.types.find((x) => x.key === k);
  const when = (d: number) => (d === 0 ? t('today') : d === 1 ? t('tomorrow') : t('inDays', { n: d }));

  return (
    <section className="card overflow-hidden">
      {r && (
        <div className={clsx('flex items-start gap-3 p-4', ins || aiOn ? 'border-b border-border' : '')}>
          <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', levelTone[r.level])}><ShieldAlert size={17} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{t('riskTitle')}</h3>
              <RiskPill level={r.level} score={r.score} />
            </div>
            <ul className="mt-1.5 space-y-0.5 text-sm text-muted">
              {r.reasons.map((x, i) => <li key={i} className="flex gap-1.5"><span aria-hidden>•</span><span>{reason(x)}</span></li>)}
            </ul>
          </div>
        </div>
      )}

      {aiOn && (
        <div className="bg-gradient-to-br from-primary-soft/50 to-transparent p-4">
          <div className="flex items-center gap-2">
            <Compass size={16} className="shrink-0 text-primary" />
            <h3 className="flex-1 text-sm font-semibold">{t('nextTitle')}</h3>
            {ins && next.data?.stale && !busy && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">{t('stale')}</span>}
            <button type="button" onClick={ask} disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : ins ? <RefreshCw size={13} /> : <Wand2 size={13} />} {ins ? t('again') : t('suggest')}
            </button>
          </div>
          {!ins && !busy && !err && <p className="mt-1 text-xs text-muted">{t('nextHint')}</p>}
          {busy && !ins && <p className="mt-2 text-sm text-muted">{t('thinking')}</p>}
          {err && <div className="mt-2"><AiErrorNote code={err} /></div>}
          {ins && (
            <div className={clsx('mt-2 space-y-3', busy && 'opacity-50')}>
              <p className="text-sm leading-relaxed">{ins.situation}</p>
              <ol className="space-y-2">
                {ins.actions.map((a, i) => {
                  const ty = typeOf(a.type);
                  const Icon = iconOf(ty?.icon);
                  return (
                    <li key={i} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
                      <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', tone(ty?.color))}><Icon size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                          <span className="font-semibold text-text">{when(a.due_in_days)}</span>
                          <span>{ty?.name ?? a.type}</span>
                          {a.priority === 1 && <span className="font-semibold text-danger">{t('urgent')}</span>}
                        </div>
                        <p className="mt-0.5 font-semibold [overflow-wrap:anywhere]">{a.subject}</p>
                        <p className="mt-0.5 text-sm text-muted [overflow-wrap:anywhere]">{a.why}</p>
                      </div>
                      <button type="button" title={t('create')} aria-label={t('create')}
                        onClick={() => setPreset({ type: a.type, subject: a.subject, body: a.why, priority: a.priority, customer_id: customerId, customer_name: customerName, due_at: daysFromNow(a.due_in_days, 10).toISOString() })}
                        className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-white">
                        <CalendarPlus size={15} /> <span className="hidden sm:inline">{t('create')}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {ins.watch_out && (
                <p className="flex items-start gap-2 rounded-xl bg-warning-soft p-2.5 text-sm text-warning"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {ins.watch_out}</p>
              )}
              {next.data?.generated_at && (
                <p className="text-[11px] text-muted">
                  {t('generated', { when: new Date(next.data.generated_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })}
                  {next.data.by_name ? ` · ${next.data.by_name}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {preset && <ActivityEditor preset={preset} onClose={() => setPreset(null)} onSaved={() => { setPreset(null); qc.invalidateQueries({ queryKey: ['next-action', customerId] }); }} />}
    </section>
  );
}
