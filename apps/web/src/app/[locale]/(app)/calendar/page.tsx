'use client';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, MapPin, Plus, Users } from 'lucide-react';
import { api, type CalEvent } from '@/lib/api';
import { date, time } from '@/lib/format';
import { IconButton, PageHeader, Segmented } from '@/components/ui';
import { ActivityEditor, TypeIcon } from '@/components/crm-editor';
import { useCrmMeta } from '@/lib/crm';

const kindStyle: Record<string, string> = {
  meeting: 'border-primary bg-primary-soft', visit: 'border-success bg-success-soft', internal: 'border-muted bg-surface-2',
  presentation: 'border-primary bg-primary-soft', followup: 'border-warning bg-warning-soft', task: 'border-info bg-info-soft',
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export default function CalendarPage() {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [day, setDay] = useState(() => startOfDay(new Date()));

  const range = useMemo(() => {
    if (view === 'day') return [day, addDays(day, 1)];
    if (view === 'week') { const s = addDays(day, -((day.getDay() + 6) % 7)); return [s, addDays(s, 7)]; }
    const s = new Date(day.getFullYear(), day.getMonth(), 1);
    return [s, new Date(day.getFullYear(), day.getMonth() + 1, 1)];
  }, [view, day]);

  const meta = useCrmMeta();
  const [all, setAll] = useState(false);
  const [editor, setEditor] = useState<{ id?: string; due?: string } | null>(null);
  const { data = [] } = useQuery({
    queryKey: ['events', range[0].toISOString(), range[1].toISOString(), all],
    queryFn: () => api<(CalEvent & { status?: string; type_icon?: string | null; type_color?: string | null; type_name?: string | null })[]>(`/events?from=${range[0].toISOString()}&to=${range[1].toISOString()}&all=${all ? 1 : 0}`),
  });

  const step = (n: number) => setDay((d) => view === 'month' ? new Date(d.getFullYear(), d.getMonth() + n, 1) : addDays(d, n * (view === 'week' ? 7 : 1)));
  const heading = view === 'month' ? date(day, locale, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${date(range[0], locale, { day: 'numeric' })} – ${date(addDays(range[1], -1), locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : date(day, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  // Month grid (Monday first)
  const monthCells = useMemo(() => {
    const first = new Date(day.getFullYear(), day.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [day]);
  const hasEvent = (d: Date) => data.some((e) => startOfDay(new Date(e.starts_at)).getTime() === d.getTime());
  const listed = view === 'month' ? data.filter((e) => startOfDay(new Date(e.starts_at)).getTime() === day.getTime()) : data;

  return (
    <div>
      <PageHeader title={t('title')} actions={<IconButton label="add" className="text-primary" onClick={() => { const d = new Date(day); d.setHours(10, 0, 0, 0); setEditor({ due: d.toISOString() }); }}><Plus size={24} /></IconButton>} />
      {meta.data?.can.all && (
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t('everyone')}
        </label>
      )}
      <Segmented value={view} onChange={setView} options={[{ value: 'day', label: t('day') }, { value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} />

      <div className="my-4 flex items-center justify-between">
        <IconButton label="prev" onClick={() => step(-1)}><ChevronLeft size={22} /></IconButton>
        <span className="font-semibold capitalize">{heading}</span>
        <IconButton label="next" onClick={() => step(1)}><ChevronRight size={22} /></IconButton>
      </div>

      {view === 'month' && (
        <div className="card mb-4 grid grid-cols-7 gap-y-1 p-3 text-center text-sm">
          {Array.from({ length: 7 }, (_, i) => date(addDays(new Date(2024, 0, 1), i), locale, { weekday: 'short' })).map((w) => (
            <div key={w} className="pb-2 text-xs text-muted">{w}</div>
          ))}
          {monthCells.map((d) => {
            const inMonth = d.getMonth() === day.getMonth();
            const selected = d.getTime() === day.getTime();
            return (
              <button key={d.toISOString()} onClick={() => setDay(d)} className="flex flex-col items-center py-1">
                <span className={clsx('grid h-9 w-9 place-items-center rounded-full', selected ? 'bg-primary font-semibold text-white' : inMonth ? '' : 'text-muted/50')}>{d.getDate()}</span>
                <span className={clsx('mt-0.5 h-1.5 w-1.5 rounded-full', hasEvent(d) ? 'bg-primary' : 'bg-transparent')} />
              </button>
            );
          })}
        </div>
      )}

      {listed.length === 0 ? <p className="py-12 text-center text-muted">{t('empty')}</p> : (
        <ul className="space-y-3">
          {listed.map((e) => (
            <li key={e.id} className="flex gap-3">
              <div className="w-14 shrink-0 pt-2 text-right text-sm">
                <div className="tabular font-semibold">{time(e.starts_at, locale)}</div>
                {view !== 'day' && <div className="text-xs text-muted">{date(e.starts_at, locale, { day: 'numeric', month: 'short' })}</div>}
              </div>
              <button type="button" onClick={() => setEditor({ id: e.id })} className={clsx('flex flex-1 gap-3 rounded-2xl border-l-4 p-3.5 text-left', kindStyle[e.kind] ?? kindStyle.meeting, e.status === 'done' && 'opacity-60')}>
                <TypeIcon icon={e.type_icon} color={e.type_color} size={32} />
                <div className="min-w-0 flex-1">
                <div className={clsx('font-semibold', e.status === 'done' && 'line-through')}>{e.title}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                  {e.kind === 'visit' || e.kind === 'followup' ? <MapPin size={14} /> : <Users size={14} />}
                  {[e.type_name, e.location ?? e.customer_name].filter(Boolean).join(' · ')} · {time(e.starts_at, locale)}–{time(e.ends_at, locale)}
                </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editor && <ActivityEditor id={editor.id} preset={editor.id ? undefined : { due_at: editor.due, type: 'meeting' }} onClose={() => setEditor(null)} />}
    </div>
  );
}
