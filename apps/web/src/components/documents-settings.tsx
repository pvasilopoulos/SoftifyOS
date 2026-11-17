'use client';
// Settings → Documents: categories and storage use.
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { COLORS, tone } from '@/lib/crm';
import { formatBytes, useDocsMeta } from '@/lib/documents';
import { phonetic } from '@/lib/search';
import { Card } from './settings-sections';
import { appPrompt } from './confirm';
import { useToast } from './providers';

type Cat = { key: string; name: string; color: string; active: boolean };
const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';

export function DocumentsSettingsSection() {
  const t = useTranslations('docs');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useDocsMeta();
  const [items, setItems] = useState<Cat[]>([]);
  useEffect(() => { if (meta.data) setItems(meta.data.categories); }, [meta.data]);
  const save = useMutation({
    mutationFn: () => api('/doc-categories', { method: 'PUT', json: { items } }),
    onSuccess: () => { toast({ title: t('saved') }); qc.invalidateQueries({ queryKey: ['docs'] }); },
    onError: () => toast({ title: t('saveError') }),
  });
  if (!meta.data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const ro = !meta.data.can.manage;
  const upd = (i: number, p: Partial<Cat>) => setItems((xs) => xs.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => setItems((xs) => { const ys = [...xs]; const j = i + d; if (j < 0 || j >= ys.length) return ys; [ys[i], ys[j]] = [ys[j], ys[i]]; return ys; });
  const u = meta.data.usage;
  return (
    <div className="space-y-4">
      <Card title={t('storage')} description={t('storageHint')}>
        <div className="mb-1.5 flex justify-between text-sm"><span>{formatBytes(u.used, locale)}</span><span className="text-muted">{formatBytes(u.quota, locale)}</span></div>
        <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(1, Math.min(100, (u.used / u.quota) * 100))}%` }} /></div>
        <p className="mt-2 text-xs text-muted">{t('limits', { max: formatBytes(meta.data.max_file, locale), types: meta.data.allowed.join(', ') })}</p>
      </Card>
      <Card title={t('categories')} description={t('categoriesHint')}>
        <ul className="space-y-2">
          {items.map((c, i) => (
            <li key={c.key} className={clsx('flex flex-wrap items-center gap-2 rounded-2xl border border-border p-2.5', !c.active && 'opacity-60')}>
              <div className="flex flex-col"><button type="button" onClick={() => move(i, -1)} className="text-muted"><ArrowUp size={14} /></button><button type="button" onClick={() => move(i, 1)} className="text-muted"><ArrowDown size={14} /></button></div>
              <span className={clsx('rounded-full px-3 py-1 text-sm font-semibold', tone(c.color))}>{c.name || '…'}</span>
              <input className={clsx(input, 'w-40 flex-1')} value={c.name} disabled={ro} onChange={(e) => upd(i, { name: e.target.value })} />
              <div className="flex gap-1">{COLORS.map((col) => <button key={col} type="button" aria-label={col} onClick={() => !ro && upd(i, { color: col })} className={clsx('h-6 w-6 rounded-full border-2', tone(col), c.color === col ? 'border-text' : 'border-transparent')} />)}</div>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={c.active} disabled={ro} onChange={(e) => upd(i, { active: e.target.checked })} /> {t('active')}</label>
              {!ro && <button type="button" className="text-danger" onClick={() => setItems((xs) => xs.filter((_, n) => n !== i))} aria-label={t('delete')}><Trash2 size={16} /></button>}
            </li>
          ))}
        </ul>
        {!ro && (
          <div className="mt-3 flex flex-wrap justify-between gap-2">
            <button type="button" className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium" onClick={async () => {
              const name = (await appPrompt(t('newCategory')))?.trim();
              if (!name) return;
              let key = phonetic(name).replace(/8/g, 'th').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 39);
              if (!/^[a-z]/.test(key) || key.length < 2) key = `c_${Date.now().toString(36)}`;
              setItems((xs) => [...xs, { key, name, color: 'primary', active: true }]);
            }}><Plus size={15} /> {t('addCategory')}</button>
            <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('save')}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
