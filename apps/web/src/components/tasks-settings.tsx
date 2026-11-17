'use client';
// Settings → Tasks: task templates (a list of steps with due offsets, priority and checklist).
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from './settings-sections';
import { useToast } from './providers';
import { useTasksMeta } from './task-ui';

type Step = { title: string; due_in_days?: number; priority?: number; checklist?: string[] };
type Tpl = { id?: string; name: string; description: string | null; items: Step[] };
const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';

export function TasksSettingsSection() {
  const t = useTranslations('tasks');
  const tc = useTranslations('crm');
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useTasksMeta();
  const [items, setItems] = useState<Tpl[]>([]);
  useEffect(() => { if (meta.data) setItems(meta.data.templates.map((x) => ({ ...x, items: x.items as Step[] }))); }, [meta.data]);
  const save = useMutation({
    mutationFn: () => api('/tasks/templates', { method: 'PUT', json: { items: items.map((x) => ({ ...x, items: x.items.filter((s) => s.title.trim()) })).filter((x) => x.name.trim() && x.items.length) } }),
    onSuccess: () => { toast({ title: t('saved') }); qc.invalidateQueries({ queryKey: ['tasks'] }); },
    onError: () => toast({ title: t('saveError') }),
  });
  if (!meta.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const ro = !meta.data.can.manage;
  const upd = (i: number, p: Partial<Tpl>) => setItems((xs) => xs.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const updStep = (i: number, j: number, p: Partial<Step>) => upd(i, { items: items[i].items.map((s, n) => (n === j ? { ...s, ...p } : s)) });
  const moveStep = (i: number, j: number, d: -1 | 1) => { const ys = [...items[i].items]; const k = j + d; if (k < 0 || k >= ys.length) return; [ys[j], ys[k]] = [ys[k], ys[j]]; upd(i, { items: ys }); };
  return (
    <Card title={t('templates')} description={t('templatesHint')}>
      <div className="space-y-4">
        {items.map((tp, i) => (
          <div key={tp.id ?? i} className="space-y-2 rounded-2xl border border-border p-3">
            <div className="flex gap-2">
              <input className={`${input} flex-1 font-semibold`} placeholder={t('templateName')} disabled={ro} value={tp.name} onChange={(e) => upd(i, { name: e.target.value })} />
              {!ro && <button type="button" className="text-danger" onClick={() => setItems((xs) => xs.filter((_, n) => n !== i))} aria-label={t('delete')}><Trash2 size={16} /></button>}
            </div>
            <input className={input} placeholder={t('descriptionPh')} disabled={ro} value={tp.description ?? ''} onChange={(e) => upd(i, { description: e.target.value || null })} />
            <ol className="space-y-1.5">
              {tp.items.map((s, j) => (
                <li key={j} className="grid grid-cols-[auto_1fr_5rem_7rem_auto] items-center gap-1.5 text-sm">
                  <span className="flex flex-col"><button type="button" onClick={() => moveStep(i, j, -1)} className="text-muted"><ArrowUp size={12} /></button><button type="button" onClick={() => moveStep(i, j, 1)} className="text-muted"><ArrowDown size={12} /></button></span>
                  <input className={input} placeholder={t('stepTitle')} disabled={ro} value={s.title} onChange={(e) => updStep(i, j, { title: e.target.value })} />
                  <input type="number" min={0} className={input} title={t('dueInDays')} placeholder="+0" disabled={ro} value={s.due_in_days ?? ''} onChange={(e) => updStep(i, j, { due_in_days: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  <select className={input} disabled={ro} value={s.priority ?? 2} onChange={(e) => updStep(i, j, { priority: Number(e.target.value) })}>{[1, 2, 3].map((p) => <option key={p} value={p}>{tc(`prio_${p}`)}</option>)}</select>
                  {!ro && <button type="button" className="text-muted hover:text-danger" onClick={() => upd(i, { items: tp.items.filter((_, n) => n !== j) })} aria-label={t('remove')}><Trash2 size={14} /></button>}
                  <input className={`${input} col-span-5 col-start-2 py-1 text-xs sm:col-span-3 sm:col-start-2`} placeholder={t('stepChecklist')} disabled={ro}
                    value={(s.checklist ?? []).join(', ')} onChange={(e) => updStep(i, j, { checklist: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                </li>
              ))}
            </ol>
            {!ro && <button type="button" onClick={() => upd(i, { items: [...tp.items, { title: '', due_in_days: (tp.items.at(-1)?.due_in_days ?? 0) + 1, priority: 2 }] })} className="flex items-center gap-1 text-sm font-medium text-primary"><Plus size={14} /> {t('addStep')}</button>}
          </div>
        ))}
        {!ro && (
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" onClick={() => setItems((xs) => [...xs, { name: '', description: null, items: [{ title: '', due_in_days: 0, priority: 2 }] }])} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium"><Plus size={15} /> {t('addTemplate')}</button>
            <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}</button>
          </div>
        )}
      </div>
    </Card>
  );
}
