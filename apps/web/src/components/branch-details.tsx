'use client';
import { useTranslations } from 'next-intl';
import { Activity, CalendarRange, Globe2, Map, MapPin, Phone, Receipt, Route, Tag, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BranchLike } from './customer-dialogs';

/** Store details as compact chips (same visual language as the spaces). Empty fields are skipped. */
export function BranchDetails({ b }: { b: BranchLike }) {
  const t = useTranslations('customer');
  const months = t.raw('months') as string[];
  const season = !b.seasonality ? null
    : b.seasonality === 'custom'
      ? (b.season_months?.length ? b.season_months.map((m) => months[m - 1]).join(', ') : t('seasons.custom'))
      : t(`seasons.${b.seasonality}`);

  const items: { icon: typeof Tag; label: string; value: ReactNode }[] = [
    { icon: Activity, label: t('ongoingStatus'), value: b.ongoing_status_name },
    { icon: Tag, label: t('branchTradeName'), value: b.trade_name },
    { icon: MapPin, label: t('street'), value: [b.address, b.postal_code].filter(Boolean).join(', ') },
    { icon: Map, label: t('prefecture'), value: b.region },
    { icon: Globe2, label: t('geoZone'), value: b.geo_zone_name },
    { icon: Receipt, label: t('feeSchedule'), value: b.fee_schedule_name },
    { icon: Route, label: t('tour'), value: b.tour_name },
    { icon: CalendarRange, label: t('seasonality'), value: season },
    { icon: Phone, label: t('phone'), value: b.phone && <a href={`tel:${b.phone.replace(/\s/g, '')}`} className="text-primary">{b.phone}</a> },
    { icon: UserRound, label: t('branchManager'), value: b.manager_name },
  ].filter((x) => x.value);

  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map(({ icon: Icon, label, value }) => (
        <li key={label} className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs">
          <Icon size={12} className="shrink-0 text-primary" />
          <span className="shrink-0 text-muted">{label}:</span>
          <span className="truncate font-medium">{value}</span>
        </li>
      ))}
    </ul>
  );
}

