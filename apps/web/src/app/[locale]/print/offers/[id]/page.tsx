'use client';
import { Suspense } from 'react';
import { use, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import type { OfferDetail } from '@/lib/offers';
import { OfferDocument } from '@/components/offer-document';
import { useRouter } from '@/i18n/navigation';

// Print-ready offer: the browser's "Save as PDF" produces the PDF (perfect Greek fonts, no server PDF engine needed)
function PrintOfferPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const v = sp.get('version');
  const t = useTranslations('publicOffer');
  const router = useRouter();
  const { data } = useQuery({ queryKey: ['offer', id, v], queryFn: () => api<OfferDetail>(`/offers/${id}${v ? `?version=${v}` : ''}`) });

  useEffect(() => {
    if (data) document.title = `${data.offer.number} v.${String(data.version).padStart(2, '0')}`;
  }, [data]);

  if (!data) return null;
  const o = data.offer;
  const ver = data.versions.find((x) => x.version === data.version);
  return (
    <div className="min-h-dvh bg-surface-2 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-4 print:hidden">
        <button onClick={() => router.back()} className="flex items-center gap-2 font-medium"><ArrowLeft size={18} /></button>
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-semibold text-white">
          <Printer size={18} /> {t('print')}
        </button>
      </div>
      <OfferDocument doc={{
        number: o.number, version: data.version, issuer: o.company_name ?? 'SoftifyOS', issuerVat: o.company_vat,
        customer: o.customer_name, place: [o.branch_name, o.space_name].filter(Boolean).join(' · ') || null,
        validUntil: o.valid_until, issuedAt: ver?.created_at ?? o.created_at, owner: o.owner_name, notes: o.notes,
        net: ver?.net_amount ?? o.net_amount, vat: ver?.vat_amount ?? o.vat_amount, total: ver?.total_amount ?? o.total_amount,
        items: data.items,
      }} />
    </div>
  );
}

export default function PrintOfferPage(props: { params: Promise<{ id: string }> }) {
  return <Suspense><PrintOfferPageInner {...props} /></Suspense>;
}
