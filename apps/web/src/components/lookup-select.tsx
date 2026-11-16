'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { PREFECTURES, PREFECTURES_LIST_ID } from '@/lib/greece';

export type LookupList = 'geo_zone' | 'fee_schedule' | 'tour' | 'ongoing_status';
export type LookupValue = { id: string; name: string; active: boolean };

const ADD = '__add__';

export function useLookup(list: LookupList) {
  return useQuery({ queryKey: ['lookups', list], queryFn: () => api<LookupValue[]>(`/lookups?list=${list}`), staleTime: 300_000 });
}

/** Select from a tenant value list (zones, fee schedules, tours) with "+ New value…" inline. */
export function LookupSelect({ list, value, onChange, className, id }: {
  list: LookupList; value: string | null; onChange: (id: string | null) => void; className?: string; id?: string;
}) {
  const t = useTranslations('lookup');
  const qc = useQueryClient();
  const { data = [] } = useLookup(list);

  async function addNew() {
    const name = window.prompt(t('prompt', { list: t(list) }))?.trim();
    if (!name) return;
    const created = await api<{ id: string; name: string }>('/lookups', { method: 'POST', json: { list, name } });
    await qc.invalidateQueries({ queryKey: ['lookups', list] });
    onChange(created.id);
  }

  return (
    <select id={id} className={className} value={value ?? ''}
      onChange={(e) => (e.target.value === ADD ? void addNew() : onChange(e.target.value || null))}>
      <option value="">{t('none')}</option>
      {data.filter((v) => v.active || v.id === value).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      <option value={ADD}>{t('addNew')}</option>
    </select>
  );
}

/** Suggestions for "Νομός" inputs: render once per page, then use <input list={PREFECTURES_LIST_ID}>. */
export function PrefecturesDatalist() {
  return <datalist id={PREFECTURES_LIST_ID}>{PREFECTURES.map((p) => <option key={p} value={p} />)}</datalist>;
}
