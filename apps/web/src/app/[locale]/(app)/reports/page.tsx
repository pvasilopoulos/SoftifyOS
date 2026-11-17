'use client';
import { ReportPromptBar } from '@/components/ai-features';
// Reports: ready-made (sales, customers, activity, stores), saved / shared, and new ones from the builder.
import { Suspense, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { BarChart3, Building, CalendarClock, ChevronRight, Loader2, Plus, Share2, Store, TrendingUp, Users } from 'lucide-react';
import { useTabTitle } from '@/components/tabs';
import { BuilderDialog, pick, ReportView, useReportsMeta, type Definition } from '@/components/reports-ui';

const GROUPS = [['sales', TrendingUp], ['customers', Users], ['activity', BarChart3], ['stores', Store]] as const;

function ReportsInner() {
  const t = useTranslations('reports');
  const locale = useLocale();
  const sp = useSearchParams();
  const meta = useReportsMeta();
  useTabTitle(t('title'));
  const [sel, setSel] = useState<{ kind: 'preset' | 'saved' | 'new'; key: string } | null>(null);
  const [def, setDef] = useState<Definition | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [aiName, setAiName] = useState<string | null>(null);
  // Open from the URL (?preset= / ?saved=) or the first preset
  useEffect(() => {
    if (!meta.data || sel) return;
    const s = sp.get('saved') && meta.data.saved.find((x) => x.id === sp.get('saved'));
    const p = meta.data.presets.find((x) => x.key === sp.get('preset')) ?? meta.data.presets[0];
    if (s) { setSel({ kind: 'saved', key: s.id }); setDef(s.definition); }
    else if (p) { setSel({ kind: 'preset', key: p.key }); setDef(p.definition); }
  }, [meta.data, sp, sel]);
  if (!meta.data) return <div className="grid place-items-center p-10"><Loader2 className="animate-spin text-muted" /></div>;
  const m = meta.data;
  const preset = sel?.kind === 'preset' ? m.presets.find((x) => x.key === sel.key) : undefined;
  const saved = sel?.kind === 'saved' ? m.saved.find((x) => x.id === sel.key) : undefined;
  const title = preset ? pick(preset.name, locale) : saved?.name ?? aiName ?? t('newReport');
  const choose = (kind: 'preset' | 'saved', key: string, d: Definition) => { setSel({ kind, key }); setDef(d); setAiName(null); };
  const item = (active: boolean) => clsx('flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm', active ? 'bg-primary-soft font-semibold text-primary' : 'hover:bg-surface-2');

  return (
    <div className="space-y-4 pb-24">
      <header className="flex items-center gap-2 print:hidden">
        <h1 className="flex-1 text-2xl font-bold tracking-tight">{t('title')}</h1>
        <button onClick={() => setNewOpen(true)} className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm"><Plus size={17} /> {t('newReport')}</button>
      </header>
      <ReportPromptBar<Definition> onDefinition={(name, d) => { setAiName(name); setSel({ kind: 'new', key: String(Date.now()) }); setDef(d); }} />
      <div className="grid items-start gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="card max-h-[80dvh] space-y-3 overflow-auto p-2 print:hidden">
          {m.saved.length > 0 && (
            <div>
              <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('savedReports')}</div>
              {m.saved.map((s) => (
                <button key={s.id} onClick={() => choose('saved', s.id, s.definition)} className={item(sel?.kind === 'saved' && sel.key === s.id)}>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  {s.scope !== 'private' && <Share2 size={12} className="shrink-0 text-muted" />}
                  {s.schedule && <CalendarClock size={12} className="shrink-0 text-muted" />}
                </button>
              ))}
            </div>
          )}
          {GROUPS.map(([g, Icon]) => (
            <div key={g}>
              <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted"><Icon size={13} /> {t(`g_${g}`)}</div>
              {m.presets.filter((p) => p.group === g).map((p) => (
                <button key={p.key} onClick={() => choose('preset', p.key, p.definition)} className={item(sel?.kind === 'preset' && sel.key === p.key)}>
                  <span className="min-w-0 flex-1 truncate">{pick(p.name, locale)}</span><ChevronRight size={14} className="shrink-0 text-muted lg:hidden" />
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0">
          {def ? (
            <ReportView key={`${sel?.kind}:${sel?.key}`} title={title} def={def} setDef={setDef} saved={saved}
              onSaved={(id) => { if (id) setSel({ kind: 'saved', key: id }); else { setSel(null); setDef(null); } }} />
          ) : <div className="card grid place-items-center p-10 text-muted"><Building size={28} /></div>}
        </div>
      </div>
      {newOpen && (
        <BuilderDialog def={{ source: 'offers', measure: 'count', group: 'status', period: { preset: '90d' }, compare: false, filters: {}, limit: 20, chart: 'bar' }}
          onApply={(d) => { setSel({ kind: 'new', key: String(Date.now()) }); setDef(d); setNewOpen(false); }} onClose={() => setNewOpen(false)} />
      )}
    </div>
  );
}

export default function ReportsPage() {
  return <Suspense><ReportsInner /></Suspense>;
}
