'use client';
// Values of custom fields (Settings → Module Forms) on a record card. Fields hidden for this user are left out.
import { useLocale, useTranslations } from 'next-intl';
import { l10n, useFormConfig, type FormKey } from '@/lib/forms';
import { date } from '@/lib/format';

export function useCustomRows(form: FormKey, custom: Record<string, unknown> | undefined) {
  const { data } = useFormConfig(form);
  const locale = useLocale();
  const t = useTranslations('forms');
  if (!data) return [];
  return data.fields.filter((f) => f.custom && !f.hidden).map((f) => {
    const v = custom?.[f.key.slice(3)];
    let text: string | null = null;
    if (v !== undefined && v !== null && v !== '') {
      if (Array.isArray(v)) text = v.join(', ');
      else if (typeof v === 'boolean') text = v ? t('yes') : t('no');
      else if (f.type === 'date') text = date(String(v), locale);
      else if (f.type === 'number') text = Number(v).toLocaleString(locale);
      else text = String(v);
    }
    return { key: f.key, label: l10n(f.label, locale, f.baseLabel), value: text, type: f.type };
  });
}
