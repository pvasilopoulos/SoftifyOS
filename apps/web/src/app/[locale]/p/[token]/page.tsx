'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Clock, Loader2, Printer, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { PublicOffer } from '@/lib/offers';
import { date } from '@/lib/format';
import { OfferDocument } from '@/components/offer-document';
import { useLocale } from 'next-intl';

// Public page the customer opens from the email/link. No login: the unguessable token is the key.
export default function PublicOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations('publicOffer');
  const locale = useLocale();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'accept' | 'reject' | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: ['public-offer', token], retry: false,
    queryFn: () => api<PublicOffer>(`/public/offers/${token}`),
  });
  const respond = useMutation({
    mutationFn: () => api(`/public/offers/${token}/respond`, { method: 'POST', json: { decision: mode, name, note: note || null } }),
    onSuccess: () => { setMode(null); qc.invalidateQueries({ queryKey: ['public-offer', token] }); },
  });

  if (isLoading) return <div className="grid min-h-dvh place-items-center"><Loader2 className="animate-spin text-muted" /></div>;
  if (error || !data) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <p className="max-w-sm text-muted">{error instanceof ApiError && error.status === 404 ? t('notFound') : 'Error'}</p>
      </div>
    );
  }

  const o = data.offer;
  const done = o.status === 'accepted' || o.status === 'rejected';
  const banner = done ? (
    <div className={`mt-6 flex items-center gap-3 rounded-2xl p-4 ${o.status === 'accepted' ? 'bg-[#e3f7ea] text-[#16a34a]' : 'bg-[#fde8e8] text-[#dc2626]'}`}>
      {o.status === 'accepted' ? <CheckCircle2 /> : <XCircle />}
      <div>
        <div className="font-semibold">{o.status === 'accepted' ? t('accepted') : t('rejected')}</div>
        <div className="text-sm opacity-80">{o.responder_name && t('by', { name: o.responder_name })}{o.responded_at && ` · ${date(o.responded_at, locale)}`}</div>
      </div>
    </div>
  ) : data.expired ? (
    <div className="mt-6 flex items-center gap-3 rounded-2xl bg-[#fff1dc] p-4 text-[#ea8a0c]"><Clock /> {t('expired')}</div>
  ) : null;

  return (
    <div className="min-h-dvh bg-[#f5f4fb] pb-40 pt-4 sm:pt-8 print:bg-white print:p-0">
      <div className="mx-auto mb-3 flex max-w-[210mm] justify-end px-4 print:hidden">
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl border border-[#e9e6f5] bg-white px-3 py-2 text-sm font-medium text-[#17142b]">
          <Printer size={16} /> {t('print')}
        </button>
      </div>
      <OfferDocument banner={banner} doc={{
        number: o.number, version: o.current_version, issuer: o.company_name ?? o.tenant_name, issuerVat: o.company_vat,
        customer: o.customer_name, place: [o.branch_name, o.space_name].filter(Boolean).join(' · ') || null,
        validUntil: o.valid_until, issuedAt: o.sent_at, owner: o.owner_name, ownerEmail: o.owner_email, notes: o.notes,
        net: o.net_amount, vat: o.vat_amount, total: o.total_amount, items: data.items,
      }} />

      {o.status === 'sent' && !data.expired && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#e9e6f5] bg-white/95 p-4 backdrop-blur sheet-pb print:hidden">
          {mode ? (
            <form className="mx-auto max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); respond.mutate(); }}>
              <input required minLength={2} autoFocus placeholder={t('yourName')} value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-[#e9e6f5] bg-[#f5f4fb] px-3.5 py-3 text-[#17142b] outline-none focus:border-[#5b3df5]" />
              <input placeholder={t('note')} value={note} onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-xl border border-[#e9e6f5] bg-[#f5f4fb] px-3.5 py-3 text-[#17142b] outline-none focus:border-[#5b3df5]" />
              <div className="flex gap-2">
                <button type="button" onClick={() => setMode(null)} className="flex-1 rounded-xl border border-[#e9e6f5] py-3 font-medium text-[#17142b]">✕</button>
                <button disabled={respond.isPending} className={`flex flex-[3] items-center justify-center gap-2 rounded-xl py-3 font-semibold text-white disabled:opacity-60 ${mode === 'accept' ? 'bg-[#16a34a]' : 'bg-[#dc2626]'}`}>
                  {respond.isPending && <Loader2 size={18} className="animate-spin" />}
                  {mode === 'accept' ? t('confirmAccept') : t('confirmReject')}
                </button>
              </div>
            </form>
          ) : (
            <div className="mx-auto flex max-w-xl gap-2">
              <button onClick={() => setMode('reject')} className="flex-1 rounded-xl border border-[#e9e6f5] py-3.5 font-semibold text-[#17142b]">{t('reject')}</button>
              <button onClick={() => setMode('accept')} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-[#5b3df5] py-3.5 font-semibold text-white shadow-lg shadow-[#5b3df5]/30">
                <CheckCircle2 size={19} /> {t('accept')}
              </button>
            </div>
          )}
        </div>
      )}
      {respond.isSuccess && <p className="mt-6 text-center text-[#16a34a] print:hidden">{t('thanks')}</p>}
    </div>
  );
}
