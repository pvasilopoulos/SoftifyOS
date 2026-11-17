'use client';
// Settings → CRM activities: activity types, outcomes, templates and automation rules.
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Sparkles, Trash2, Zap } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { COLORS, ICONS, iconOf, tone, useCrmMeta, type CrmOutcome, type CrmTemplate, type CrmType } from '@/lib/crm';
import { phonetic } from '@/lib/search';
import { Card } from './settings-sections';
import { Dialog } from './customer-dialogs';
import { appConfirm, appPrompt } from './confirm';
import { useToast } from './providers';
import { Expandable } from './settings-sections-2';

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';
const primary = 'flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60';
const ghost = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2';
const keyOf = (name: string) => { let k = phonetic(name).replace(/8/g, 'th').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 39); if (!/^[a-z]/.test(k)) k = `t_${k}`; return k.length >= 2 ? k : `t_${Date.now().toString(36)}`; };

export function CrmSettingsSection() {
  const t = useTranslations('crm');
  const [open, setOpen] = useState<string | null>('types');
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k));
  return (
    <div className="space-y-3">
      <Expandable icon={Sparkles} title={t('set_types')} summary={t('set_typesHint')} open={open === 'types'} onToggle={() => toggle('types')}><TypesEditor /></Expandable>
      <Expandable icon={Check} title={t('set_outcomes')} summary={t('set_outcomesHint')} open={open === 'outcomes'} onToggle={() => toggle('outcomes')}><OutcomesEditor /></Expandable>
      <Expandable icon={Plus} title={t('set_templates')} summary={t('set_templatesHint')} open={open === 'templates'} onToggle={() => toggle('templates')}><TemplatesEditor /></Expandable>
      <Expandable icon={Zap} title={t('set_rules')} summary={t('set_rulesHint')} open={open === 'rules'} onToggle={() => toggle('rules')}><RulesEditor /></Expandable>
    </div>
  );
}

function useSaveList(path: string) {
  const t = useTranslations('crm');
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: unknown[]) => api(path, { method: 'PUT', json: { items } }),
    onSuccess: () => { toast({ title: t('saved') }); qc.invalidateQueries({ queryKey: ['crm'] }); },
    onError: (e) => toast({ title: t('saveError'), body: e instanceof ApiError ? e.code : undefined }),
  });
}
const move = <T,>(xs: T[], i: number, d: -1 | 1) => { const ys = [...xs]; const j = i + d; if (j < 0 || j >= ys.length) return ys; [ys[i], ys[j]] = [ys[j], ys[i]]; return ys; };

function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1">
      {COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => onChange(c)}
        className={clsx('h-6 w-6 rounded-full border-2', tone(c), value === c ? 'border-text' : 'border-transparent')} />)}
    </div>
  );
}

function TypesEditor() {
  const t = useTranslations('crm');
  const meta = useCrmMeta();
  const [items, setItems] = useState<CrmType[]>([]);
  useEffect(() => { if (meta.data) setItems(meta.data.types); }, [meta.data]);
  const save = useSaveList('/crm/settings/types');
  if (!meta.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const ro = !meta.data.can.manage;
  const upd = (i: number, p: Partial<CrmType>) => setItems((xs) => xs.map((x, n) => (n === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((x, i) => {
          const Icon = iconOf(x.icon);
          return (
            <li key={x.key} className={clsx('flex flex-wrap items-center gap-2 rounded-2xl border border-border p-2.5', !x.active && 'opacity-60')}>
              <div className="flex flex-col"><button type="button" onClick={() => setItems((xs) => move(xs, i, -1))} className="text-muted"><ArrowUp size={14} /></button><button type="button" onClick={() => setItems((xs) => move(xs, i, 1))} className="text-muted"><ArrowDown size={14} /></button></div>
              <span className={clsx('grid h-9 w-9 place-items-center rounded-xl', tone(x.color))}><Icon size={18} /></span>
              <input className={clsx(input, 'w-40 flex-1')} value={x.name} disabled={ro} onChange={(e) => upd(i, { name: e.target.value })} aria-label={t('name')} />
              <select className={clsx(input, 'w-36')} value={x.icon} disabled={ro} onChange={(e) => upd(i, { icon: e.target.value })} aria-label={t('icon')}>
                {Object.keys(ICONS).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <ColorPick value={x.color} onChange={(c) => !ro && upd(i, { color: c })} />
              <label className="flex items-center gap-1 text-xs text-muted">{t('minutes')}<input type="number" min={0} className={clsx(input, 'w-16')} value={x.default_duration} disabled={ro} onChange={(e) => upd(i, { default_duration: Number(e.target.value) || 0 })} /></label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={x.active} disabled={ro} onChange={(e) => upd(i, { active: e.target.checked })} /> {t('active')}</label>
              {!ro && <button type="button" className="text-danger" onClick={() => setItems((xs) => xs.filter((_, n) => n !== i))} aria-label={t('delete')}><Trash2 size={16} /></button>}
            </li>
          );
        })}
      </ul>
      {!ro && (
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={ghost} onClick={async () => {
            const name = (await appPrompt(t('newTypeName'))) ?? '';
            if (name.trim()) setItems((xs) => [...xs, { key: keyOf(name), name: name.trim(), icon: 'circle', color: 'primary', default_duration: 0, active: true }]);
          }}><Plus size={15} /> {t('addType')}</button>
          <button type="button" className={primary} disabled={save.isPending} onClick={() => save.mutate(items)}>{save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}</button>
        </div>
      )}
      <p className="text-xs text-muted">{t('typesHint')}</p>
    </div>
  );
}

function OutcomesEditor() {
  const t = useTranslations('crm');
  const meta = useCrmMeta();
  const [items, setItems] = useState<CrmOutcome[]>([]);
  useEffect(() => { if (meta.data) setItems(meta.data.outcomes); }, [meta.data]);
  const save = useSaveList('/crm/settings/outcomes');
  if (!meta.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const ro = !meta.data.can.manage;
  const upd = (i: number, p: Partial<CrmOutcome>) => setItems((xs) => xs.map((x, n) => (n === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((x, i) => (
          <li key={x.key} className={clsx('flex flex-wrap items-center gap-2 rounded-2xl border border-border p-2.5', !x.active && 'opacity-60')}>
            <div className="flex flex-col"><button type="button" onClick={() => setItems((xs) => move(xs, i, -1))} className="text-muted"><ArrowUp size={14} /></button><button type="button" onClick={() => setItems((xs) => move(xs, i, 1))} className="text-muted"><ArrowDown size={14} /></button></div>
            <span className={clsx('rounded-full px-3 py-1 text-sm font-semibold', tone(x.color))}>{x.name || '…'}</span>
            <input className={clsx(input, 'w-40 flex-1')} value={x.name} disabled={ro} onChange={(e) => upd(i, { name: e.target.value })} aria-label={t('name')} />
            <ColorPick value={x.color} onChange={(c) => !ro && upd(i, { color: c })} />
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={x.positive} disabled={ro} onChange={(e) => upd(i, { positive: e.target.checked })} /> {t('positive')}</label>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={x.active} disabled={ro} onChange={(e) => upd(i, { active: e.target.checked })} /> {t('active')}</label>
            {!ro && <button type="button" className="text-danger" onClick={() => setItems((xs) => xs.filter((_, n) => n !== i))} aria-label={t('delete')}><Trash2 size={16} /></button>}
          </li>
        ))}
      </ul>
      {!ro && (
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={ghost} onClick={async () => {
            const name = (await appPrompt(t('newOutcomeName'))) ?? '';
            if (name.trim()) setItems((xs) => [...xs, { key: keyOf(name), name: name.trim(), color: 'muted', positive: false, active: true }]);
          }}><Plus size={15} /> {t('addOutcome')}</button>
          <button type="button" className={primary} disabled={save.isPending} onClick={() => save.mutate(items)}>{save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}</button>
        </div>
      )}
      <p className="text-xs text-muted">{t('outcomesHint')}</p>
    </div>
  );
}

function TemplatesEditor() {
  const t = useTranslations('crm');
  const meta = useCrmMeta();
  const [items, setItems] = useState<Omit<CrmTemplate, 'id'>[]>([]);
  useEffect(() => { if (meta.data) setItems(meta.data.templates.map(({ id: _i, ...x }) => x)); }, [meta.data]);
  const save = useSaveList('/crm/settings/templates');
  if (!meta.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const ro = !meta.data.can.manage;
  const upd = (i: number, p: Partial<CrmTemplate>) => setItems((xs) => xs.map((x, n) => (n === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-3">
      {items.map((x, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-border p-3">
          <div className="flex gap-2">
            <input className={clsx(input, 'flex-1 font-semibold')} placeholder={t('templateName')} value={x.name} disabled={ro} onChange={(e) => upd(i, { name: e.target.value })} />
            {!ro && <button type="button" className="text-danger" onClick={() => setItems((xs) => xs.filter((_, n) => n !== i))} aria-label={t('delete')}><Trash2 size={16} /></button>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
            <select className={input} value={x.type} disabled={ro} onChange={(e) => upd(i, { type: e.target.value })}>{meta.data!.types.map((ty) => <option key={ty.key} value={ty.key}>{ty.name}</option>)}</select>
            <input className={input} placeholder={t('subject')} value={x.subject} disabled={ro} onChange={(e) => upd(i, { subject: e.target.value })} />
          </div>
          <textarea rows={2} className={input} placeholder={t('description')} value={x.body ?? ''} disabled={ro} onChange={(e) => upd(i, { body: e.target.value || null })} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-muted">{t('dueInDays')}<input type="number" min={0} className={input} value={x.due_in_days ?? ''} disabled={ro} onChange={(e) => upd(i, { due_in_days: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label className="text-xs text-muted">{t('durationMin')}<input type="number" min={0} className={input} value={x.duration_min} disabled={ro} onChange={(e) => upd(i, { duration_min: Number(e.target.value) || 0 })} /></label>
            <label className="text-xs text-muted">{t('priority')}<select className={input} value={x.priority} disabled={ro} onChange={(e) => upd(i, { priority: Number(e.target.value) })}>{[1, 2, 3].map((p) => <option key={p} value={p}>{t(`prio_${p}`)}</option>)}</select></label>
            <label className="text-xs text-muted">{t('remindMin')}<input type="number" min={0} className={input} value={x.remind_before_min ?? ''} disabled={ro} onChange={(e) => upd(i, { remind_before_min: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          </div>
        </div>
      ))}
      {!ro && (
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={ghost} onClick={() => setItems((xs) => [...xs, { name: t('newTemplate'), type: meta.data!.types[0]?.key ?? 'call', subject: '', body: null, priority: 2, duration_min: 0, due_in_days: 1, remind_before_min: null }])}><Plus size={15} /> {t('addTemplate')}</button>
          <button type="button" className={primary} disabled={save.isPending || items.some((x) => !x.name.trim() || !x.subject.trim())} onClick={() => save.mutate(items)}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}
          </button>
        </div>
      )}
    </div>
  );
}

type Rule = { id: string; name: string; active: boolean; trigger: string; config: { days?: number; type?: string; outcome?: string; customer_status?: string };
  action: { type: string; subject: string; body?: string | null; due_in_days: number; priority: number; assign: string; remind_before_min?: number | null }; runs: number; last_run_at: string | null; open: number };
const TRIGGERS = ['offer_created', 'offer_sent', 'offer_accepted', 'offer_rejected', 'customer_created', 'activity_done', 'no_contact'] as const;

function RulesEditor() {
  const t = useTranslations('crm');
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useCrmMeta();
  const rules = useQuery({ queryKey: ['crm', 'rules'], queryFn: () => api<Rule[]>('/crm/rules') });
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);
  const ro = !meta.data?.can.manage;
  const toggle = async (r: Rule) => {
    const { id: _i, runs: _r, last_run_at: _l, open: _o, ...body } = r;
    await api(`/crm/rules/${r.id}`, { method: 'PUT', json: { ...body, active: !r.active } });
    qc.invalidateQueries({ queryKey: ['crm', 'rules'] });
    toast({ title: !r.active ? t('ruleOn') : t('ruleOff') });
  };
  if (!rules.data || !meta.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('rulesIntro')}</p>
      <ul className="space-y-2">
        {rules.data.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
            <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', r.active ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted')}><Zap size={17} /></span>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => !ro && setEdit(r)}>
              <div className="truncate font-medium">{r.name}</div>
              <div className="truncate text-xs text-muted">{t(`tr_${r.trigger}`)}{r.trigger === 'no_contact' ? ` (${r.config.days ?? 60} ${t('daysShort')})` : ''} → {meta.data!.types.find((x) => x.key === r.action.type)?.name ?? r.action.type} · {t('runs', { n: r.runs })}{r.open ? ` · ${t('openN', { n: r.open })}` : ''}</div>
            </button>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" className="peer sr-only" checked={r.active} disabled={ro} onChange={() => toggle(r)} aria-label={r.name} />
              <span className="h-6 w-11 rounded-full bg-border transition peer-checked:bg-primary" />
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </label>
          </li>
        ))}
      </ul>
      {!ro && <button type="button" className={ghost} onClick={() => setEdit('new')}><Plus size={15} /> {t('addRule')}</button>}
      {edit && <RuleDialog rule={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const t = useTranslations('crm');
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useCrmMeta();
  const [r, setR] = useState(() => rule ?? {
    name: '', active: true, trigger: 'offer_sent', config: {}, action: { type: 'call', subject: '', body: null, due_in_days: 3, priority: 2, assign: 'actor', remind_before_min: 30 },
  } as Omit<Rule, 'id' | 'runs' | 'last_run_at' | 'open'>);
  const setA = (p: Partial<Rule['action']>) => setR((x) => ({ ...x, action: { ...x.action, ...p } }));
  const setC = (p: Partial<Rule['config']>) => setR((x) => ({ ...x, config: { ...x.config, ...p } }));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: r.name, active: r.active, trigger: r.trigger, config: r.config, action: r.action };
      return rule ? api(`/crm/rules/${rule.id}`, { method: 'PUT', json: body }) : api('/crm/rules', { method: 'POST', json: body });
    },
    onSuccess: () => { toast({ title: t('saved') }); qc.invalidateQueries({ queryKey: ['crm', 'rules'] }); onClose(); },
    onError: () => toast({ title: t('saveError') }),
  });
  const del = async () => {
    if (!rule || !(await appConfirm(t('deleteRuleConfirm'), { danger: true }))) return;
    await api(`/crm/rules/${rule.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['crm', 'rules'] }); onClose();
  };
  const md = meta.data;
  return (
    <Dialog title={rule ? t('editRule') : t('addRule')} onClose={onClose}>
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{t('name')}</span><input className={input} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></label>
        <div className="rounded-2xl bg-surface-2 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('when')}</div>
          <select className={clsx(input, 'bg-surface')} value={r.trigger} onChange={(e) => setR({ ...r, trigger: e.target.value })}>{TRIGGERS.map((x) => <option key={x} value={x}>{t(`tr_${x}`)}</option>)}</select>
          {r.trigger === 'no_contact' && <label className="mt-2 flex items-center gap-2 text-sm">{t('noContactDays')}<input type="number" min={1} className={clsx(input, 'w-24 bg-surface')} value={r.config.days ?? 60} onChange={(e) => setC({ days: Number(e.target.value) || 60 })} /></label>}
          {r.trigger === 'activity_done' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select className={clsx(input, 'bg-surface')} value={r.config.type ?? ''} onChange={(e) => setC({ type: e.target.value || undefined })}><option value="">{t('anyType')}</option>{md?.types.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
              <select className={clsx(input, 'bg-surface')} value={r.config.outcome ?? ''} onChange={(e) => setC({ outcome: e.target.value || undefined })}><option value="">{t('anyOutcome')}</option>{md?.outcomes.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
            </div>
          )}
          <select className={clsx(input, 'mt-2 bg-surface')} value={r.config.customer_status ?? ''} onChange={(e) => setC({ customer_status: e.target.value || undefined })}>
            <option value="">{t('anyCustomerStatus')}</option>{['prospect', 'negotiation', 'active', 'inactive'].map((s) => <option key={s} value={s}>{t(`cs_${s}`)}</option>)}
          </select>
        </div>
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t('thenCreate')}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
            <select className={clsx(input, 'bg-surface')} value={r.action.type} onChange={(e) => setA({ type: e.target.value })}>{md?.types.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
            <input className={clsx(input, 'bg-surface')} placeholder={t('subject')} value={r.action.subject} onChange={(e) => setA({ subject: e.target.value })} />
          </div>
          <p className="text-xs text-muted">{t('placeholders')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-muted">{t('dueInDays')}<input type="number" min={0} className={clsx(input, 'bg-surface')} value={r.action.due_in_days} onChange={(e) => setA({ due_in_days: Number(e.target.value) || 0 })} /></label>
            <label className="text-xs text-muted">{t('priority')}<select className={clsx(input, 'bg-surface')} value={r.action.priority} onChange={(e) => setA({ priority: Number(e.target.value) })}>{[1, 2, 3].map((p) => <option key={p} value={p}>{t(`prio_${p}`)}</option>)}</select></label>
            <label className="col-span-2 text-xs text-muted">{t('assignTo')}
              <select className={clsx(input, 'bg-surface')} value={r.action.assign} onChange={(e) => setA({ assign: e.target.value })}>
                {['actor', 'owner', 'account_manager'].map((x) => <option key={x} value={x}>{t(`as_${x}`)}</option>)}
                {md?.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select></label>
          </div>
          <label className="text-xs text-muted">{t('remindMin')}<input type="number" min={0} className={clsx(input, 'bg-surface')} value={r.action.remind_before_min ?? ''} onChange={(e) => setA({ remind_before_min: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} /> {t('active')}</label>
        <div className="flex justify-between gap-2 border-t border-border pt-4">
          {rule ? <button type="button" className={clsx(ghost, 'text-danger')} onClick={del}><Trash2 size={15} /> {t('delete')}</button> : <span />}
          <button type="button" className={primary} disabled={save.isPending || !r.name.trim() || !r.action.subject.trim()} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export { Card };
