'use client';
import { appPrompt } from './confirm';
// Pick-lists, all read from the database (Settings → Value lists).
//  - LookupSelect: lists whose records keep the value id (zones, fee schedules, tours, ongoing status)
//  - NameSelect:   lists whose records keep the value name (prefecture, category, source, payment terms, space kind)
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

export const ID_LISTS = ['geo_zone', 'fee_schedule', 'tour', 'ongoing_status'] as const;
export const NAME_LISTS = ['prefecture', 'customer_category', 'customer_source', 'payment_terms', 'space_kind'] as const;
export type IdList = (typeof ID_LISTS)[number];
export type NameList = (typeof NAME_LISTS)[number];
export type LookupList = IdList | NameList;
export type LookupValue = { id: string; name: string; active: boolean };

const ADD = '__add__';

export function useLookup(list: LookupList) {
  return useQuery({ queryKey: ['lookups', list], queryFn: () => api<LookupValue[]>(`/lookups?list=${list}`), staleTime: 300_000 });
}

function useAddValue(list: LookupList) {
  const t = useTranslations('lookup');
  const qc = useQueryClient();
  return async () => {
    const name = (await appPrompt(t('prompt', { list: t(list) })))?.trim();
    if (!name) return null;
    const created = await api<{ id: string; name: string }>('/lookups', { method: 'POST', json: { list, name } });
    await qc.invalidateQueries({ queryKey: ['lookups', list] });
    return created;
  };
}

/** Select from a tenant value list (zones, fee schedules, tours) with "+ New value…" inline. */
export function LookupSelect({ list, value, onChange, className, id, allowed }: {
  list: IdList; value: string | null; onChange: (id: string | null) => void; className?: string; id?: string;
  /** Module Forms: only these values (ids) can be picked; the current one stays visible. */
  allowed?: string[] | null;
}) {
  const t = useTranslations('lookup');
  const { data = [] } = useLookup(list);
  const add = useAddValue(list);
  return (
    <select id={id} className={className} value={value ?? ''}
      onChange={async (e) => { if (e.target.value === ADD) { const c = await add(); if (c) onChange(c.id); } else onChange(e.target.value || null); }}>
      <option value="">{t('none')}</option>
      {data.filter((v) => v.id === value || (v.active && (!allowed || allowed.includes(v.id)))).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      {!allowed && <option value={ADD}>{t('addNew')}</option>}
    </select>
  );
}

/** Same, for lists stored by name. A current value that is no longer in the list is still shown. */
export function NameSelect({ list, value, onChange, className, id, allowEmpty = true, allowed }: {
  list: NameList; value: string | null | undefined; onChange: (name: string) => void; className?: string; id?: string; allowEmpty?: boolean;
  /** Module Forms: only these values (names) can be picked; the current one stays visible. */
  allowed?: string[] | null;
}) {
  const t = useTranslations('lookup');
  const { data = [] } = useLookup(list);
  const add = useAddValue(list);
  const current = value ?? '';
  const known = data.some((v) => v.name === current);
  return (
    <select id={id} className={className} value={current}
      onChange={async (e) => { if (e.target.value === ADD) { const c = await add(); if (c) onChange(c.name); } else onChange(e.target.value); }}>
      {allowEmpty && <option value="">{t('none')}</option>}
      {current && !known && <option value={current}>{current}</option>}
      {data.filter((v) => v.name === current || (v.active && (!allowed || allowed.includes(v.name)))).map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
      {!allowed && <option value={ADD}>{t('addNew')}</option>}
    </select>
  );
}
