'use client';
// Report charts: ranked bars (categories), columns / line (time), KPI, table. One hue for the current period;
// the previous period (compare) is a muted grey with a legend. Every mark has a hover tooltip; values are text.
import { useState } from 'react';
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

export type Row = { label: string; value: number; prev?: number };
export type ReportResult = {
  rows: Row[]; total: number; prev_total?: number; period: { from: string | null; to: string }; prev_period?: { from: string; to: string } | null;
  measure: { money?: boolean; pct?: boolean }; time: boolean; generated_at: string;
};
export type Chart = 'bar' | 'column' | 'line' | 'table' | 'kpi' | 'pie';

export function useFormat(m: ReportResult['measure']) {
  const locale = useLocale();
  return (n: number, compact = false) => {
    if (m.pct) return `${n.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
    if (m.money) return n.toLocaleString(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: compact || Math.abs(n) >= 1000 ? 0 : 2, ...(compact ? { notation: 'compact' } : {}) });
    return n.toLocaleString(locale, { maximumFractionDigits: 1, ...(compact ? { notation: 'compact' } : {}) });
  };
}

function Delta({ cur, prev }: { cur: number; prev?: number }) {
  if (prev === undefined) return null;
  if (!prev) return cur ? <span className="text-xs font-semibold text-success">+∞</span> : null;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(d) < 0.05) return <span className="text-xs font-semibold text-muted">±0%</span>;
  const up = d >= 0;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs font-semibold', up ? 'text-success' : 'text-danger')}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(d).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
    </span>
  );
}

function Legend({ compare }: { compare: boolean }) {
  const t = useTranslations('reports');
  if (!compare) return null;
  return (
    <div className="flex gap-4 text-xs text-muted">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />{t('current')}</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted/40" />{t('previous')}</span>
    </div>
  );
}

export function ReportChart({ r, chart, label, compact }: { r: ReportResult; chart: Chart; label: (s: string) => string; compact?: boolean }) {
  const t = useTranslations('reports');
  const fmt = useFormat(r.measure);
  const compare = r.prev_total !== undefined && r.rows.some((x) => x.prev !== undefined);
  const kind = chart === 'pie' ? 'bar' : chart;
  if (kind === 'kpi' || !r.rows.length) {
    return (
      <div className={clsx('flex flex-col justify-center', compact ? 'py-2' : 'py-6')}>
        <div className={clsx('font-bold tabular', compact ? 'text-3xl' : 'text-5xl')}>{fmt(r.total)}</div>
        {r.prev_total !== undefined && <div className="mt-1 flex items-center gap-2 text-sm text-muted"><Delta cur={r.total} prev={r.prev_total} /> {t('vsPrev', { v: fmt(r.prev_total) })}</div>}
        {!r.rows.length && kind !== 'kpi' && <p className="mt-2 text-sm text-muted">{t('noRows')}</p>}
      </div>
    );
  }
  if (kind === 'table') return <ReportTable r={r} label={label} />;
  if (kind === 'line') return <LineChart r={r} label={label} compact={compact} />;
  if (kind === 'column') return <Columns r={r} label={label} compact={compact} />;
  // Ranked horizontal bars
  const max = Math.max(...r.rows.map((x) => Math.max(x.value, x.prev ?? 0)), 0) || 1;
  const rows = compact ? r.rows.slice(0, 6) : r.rows;
  return (
    <div className="space-y-2">
      <Legend compare={compare} />
      <ul className="space-y-2">
        {rows.map((x) => (
          <li key={x.label} className="group" title={`${label(x.label)}: ${fmt(x.value)}${x.prev !== undefined ? ` · ${t('previous')}: ${fmt(x.prev)}` : ''}`}>
            <div className="mb-0.5 flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{label(x.label)}</span>
              <span className="font-semibold tabular">{fmt(x.value, compact)}</span>
              {compare && <span className="w-14 text-right"><Delta cur={x.value} prev={x.prev} /></span>}
            </div>
            <div className="space-y-[2px]">
              <div className="h-2.5 rounded-r-[4px] bg-primary/85 transition group-hover:bg-primary" style={{ width: `${Math.max((x.value / max) * 100, x.value ? 1 : 0)}%` }} />
              {compare && <div className="h-1.5 rounded-r-[4px] bg-muted/35" style={{ width: `${Math.max(((x.prev ?? 0) / max) * 100, x.prev ? 1 : 0)}%` }} />}
            </div>
          </li>
        ))}
      </ul>
      {compact && r.rows.length > 6 && <p className="text-xs text-muted">+{r.rows.length - 6}</p>}
    </div>
  );
}

function Columns({ r, label, compact }: { r: ReportResult; label: (s: string) => string; compact?: boolean }) {
  const fmt = useFormat(r.measure);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...r.rows.map((x) => x.value), 0) || 1;
  return (
    <div>
      <div className={clsx('relative flex items-end gap-[2px]', compact ? 'h-28' : 'h-56')} role="img" aria-label={r.rows.map((x) => `${label(x.label)} ${fmt(x.value)}`).join(', ')}>
        {r.rows.map((x, i) => (
          <div key={x.label} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={clsx('w-full rounded-t-[4px] transition', hover === i ? 'bg-primary' : 'bg-primary/80')} style={{ height: `${(x.value / max) * 100}%`, minHeight: x.value ? 2 : 0 }} />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-text px-2 py-1 text-xs text-bg shadow-lg">
                {label(x.label)}: <b>{fmt(x.value)}</b>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{label(r.rows[0].label)}</span>{!compact && <span>max {fmt(max, true)}</span>}<span>{label(r.rows.at(-1)!.label)}</span>
      </div>
    </div>
  );
}

function LineChart({ r, label, compact }: { r: ReportResult; label: (s: string) => string; compact?: boolean }) {
  const fmt = useFormat(r.measure);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = compact ? 120 : 220, pad = 6;
  const max = Math.max(...r.rows.map((x) => x.value), 0) || 1;
  const n = r.rows.length;
  const x = (i: number) => (n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const pts = r.rows.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: H }} role="img"
        aria-label={r.rows.map((p) => `${label(p.label)} ${fmt(p.value)}`).join(', ')}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const rel = ((e.clientX - b.left) / b.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((rel - pad) / (W - 2 * pad)) * (n - 1))))); }}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={W} y1={H - pad - g * (H - 2 * pad)} y2={H - pad - g * (H - 2 * pad)} stroke="currentColor" className="text-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="currentColor" className="text-muted" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-text px-2 py-1 text-xs text-bg shadow-lg" style={{ left: `${(x(hover) / W) * 100}%` }}>
          {label(r.rows[hover].label)}: <b>{fmt(r.rows[hover].value)}</b>
        </div>
      )}
      <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{label(r.rows[0].label)}</span><span>{label(r.rows.at(-1)!.label)}</span></div>
    </div>
  );
}

export function ReportTable({ r, label }: { r: ReportResult; label: (s: string) => string }) {
  const t = useTranslations('reports');
  const fmt = useFormat(r.measure);
  const compare = r.rows.some((x) => x.prev !== undefined);
  const sum = r.rows.reduce((a, x) => a + x.value, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted"><tr className="border-b border-border text-left">
          <th className="py-2 pr-3 font-medium">{t('group')}</th>
          <th className="py-2 pr-3 text-right font-medium">{t('value')}</th>
          {!r.measure.pct && <th className="py-2 pr-3 text-right font-medium">%</th>}
          {compare && <><th className="py-2 pr-3 text-right font-medium">{t('previous')}</th><th className="py-2 text-right font-medium">Δ</th></>}
        </tr></thead>
        <tbody className="divide-y divide-border">
          {r.rows.map((x) => (
            <tr key={x.label}>
              <td className="py-2 pr-3">{label(x.label)}</td>
              <td className="py-2 pr-3 text-right font-semibold tabular">{fmt(x.value)}</td>
              {!r.measure.pct && <td className="py-2 pr-3 text-right tabular text-muted">{sum ? Math.round((x.value / sum) * 100) : 0}%</td>}
              {compare && <><td className="py-2 pr-3 text-right tabular text-muted">{fmt(x.prev ?? 0)}</td><td className="py-2 text-right"><Delta cur={x.value} prev={x.prev} /></td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** CSV of a result (semicolon separated, UTF-8 BOM for Excel). */
export function resultCsv(r: ReportResult, label: (s: string) => string, title: string) {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const compare = r.rows.some((x) => x.prev !== undefined);
  const lines = [[title, compare ? 'previous' : ''].filter(Boolean).join(';'), ...r.rows.map((x) => [esc(label(x.label)), String(x.value), ...(compare ? [String(x.prev ?? 0)] : [])].join(';')), `total;${r.total}${r.prev_total !== undefined ? `;${r.prev_total}` : ''}`];
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
