'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { OfferEditor } from '@/components/offer-editor';
import { Skeleton } from '@/components/ui';
import type { OfferDetail } from '@/lib/offers';

export default function EditOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Always fetch fresh data before editing (no stale cache)
  const { data } = useQuery({ queryKey: ['offer', id, 'edit'], queryFn: () => api<OfferDetail>(`/offers/${id}`), staleTime: 0 });
  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-64" /></div>;
  const o = data.offer;
  return (
    <OfferEditor initial={{
      offerId: id,
      nextVersion: o.current_version + 1,
      customer: { id: o.customer_id, name: o.customer_name },
      branch_id: o.branch_id, space_id: o.space_id, company_id: o.company_id,
      valid_until: o.valid_until, notes: o.notes,
      items: data.items.map((i) => ({
        key: i.id, product_id: i.product_id ?? null, description: i.description, unit: i.unit,
        quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount), vat_rate: Number(i.vat_rate),
      })),
    }} />
  );
}
