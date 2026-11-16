'use client';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { date, money } from '@/lib/format';
import type { OfferItem } from '@/lib/offers';

type Doc = {
  number: string; version: number; issuer: string; issuerVat?: string | null;
  customer: string; place?: string | null; validUntil?: string | null; issuedAt?: string | null;
  owner?: string | null; ownerEmail?: string | null; notes?: string | null;
  net: string; vat: string; total: string; items: OfferItem[];
};

/** A4-style offer document: used for Print/PDF and for the customer's public page. */
export function OfferDocument({ doc, banner }: { doc: Doc; banner?: ReactNode }) {
  const t = useTranslations('publicOffer');
  const to = useTranslations('offers');
  const locale = useLocale();
  return (
    <article className="offer-doc mx-auto w-full max-w-[210mm] bg-white p-6 text-[#17142b] shadow-xl sm:p-10 print:max-w-none print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e9e6f5] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#7c63ff] to-[#4a2ee0] text-lg font-black text-white">{doc.issuer[0]}</span>
            <div>
              <div className="text-lg font-bold">{doc.issuer}</div>
              {doc.issuerVat && <div className="text-xs text-[#6b6785]">{t('vatNo')}: {doc.issuerVat}</div>}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-[#6b6785]">{t('offer')}</div>
          <div className="text-2xl font-bold">{doc.number}</div>
          <div className="text-sm text-[#6b6785]">v.{String(doc.version).padStart(2, '0')}{doc.issuedAt && ` · ${date(doc.issuedAt, locale)}`}</div>
        </div>
      </header>

      {banner}

      <section className="grid gap-4 py-6 sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-[#6b6785]">{t('for')}</div>
          <div className="text-lg font-semibold">{doc.customer}</div>
          {doc.place && <div className="text-sm text-[#6b6785]">{doc.place}</div>}
        </div>
        <div className="sm:text-right">
          {doc.validUntil && <><div className="text-xs uppercase tracking-wider text-[#6b6785]">{t('validUntil')}</div><div className="font-semibold">{date(doc.validUntil, locale)}</div></>}
          {doc.owner && <div className="mt-2 text-sm text-[#6b6785]">{t('contact')}: {doc.owner}{doc.ownerEmail && ` · ${doc.ownerEmail}`}</div>}
        </div>
      </section>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-[#17142b] text-left text-xs uppercase tracking-wider text-[#6b6785]">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">{to('description')}</th>
            <th className="py-2 pr-2 text-right">{to('qty')}</th>
            <th className="hidden py-2 pr-2 text-right sm:table-cell print:table-cell">{to('price')}</th>
            <th className="hidden py-2 pr-2 text-right sm:table-cell print:table-cell">{to('discount')}</th>
            <th className="py-2 text-right">{to('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((i) => (
            <tr key={i.position} className="border-b border-[#e9e6f5] align-top">
              <td className="py-2.5 pr-2 text-[#6b6785]">{i.position}</td>
              <td className="py-2.5 pr-2">
                {i.description}
                <div className="text-xs text-[#6b6785] sm:hidden print:hidden">{Number(i.quantity).toLocaleString(locale)} {i.unit} × {money(i.unit_price, locale)}{Number(i.discount) > 0 && ` −${Number(i.discount)}%`}</div>
              </td>
              <td className="tabular py-2.5 pr-2 text-right whitespace-nowrap">{Number(i.quantity).toLocaleString(locale)} {i.unit}</td>
              <td className="tabular hidden py-2.5 pr-2 text-right sm:table-cell print:table-cell">{money(i.unit_price, locale)}</td>
              <td className="tabular hidden py-2.5 pr-2 text-right sm:table-cell print:table-cell">{Number(i.discount) > 0 ? `${Number(i.discount)}%` : '—'}</td>
              <td className="tabular py-2.5 text-right font-medium whitespace-nowrap">{money(i.net_amount, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-6 flex justify-end">
        <dl className="w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-[#6b6785]">{to('net')}</dt><dd className="tabular">{money(doc.net, locale)}</dd></div>
          <div className="flex justify-between"><dt className="text-[#6b6785]">{to('vat')}</dt><dd className="tabular">{money(doc.vat, locale)}</dd></div>
          <div className="flex justify-between border-t-2 border-[#17142b] pt-2 text-lg font-bold"><dt>{to('total')}</dt><dd className="tabular">{money(doc.total, locale)}</dd></div>
        </dl>
      </section>

      {doc.notes && (
        <section className="mt-8 rounded-xl bg-[#f5f4fb] p-4 text-sm whitespace-pre-line">
          <div className="mb-1 text-xs uppercase tracking-wider text-[#6b6785]">{to('notes')}</div>
          {doc.notes}
        </section>
      )}
      <footer className="mt-10 border-t border-[#e9e6f5] pt-4 text-center text-xs text-[#6b6785]">{doc.issuer} · {doc.number} v.{String(doc.version).padStart(2, '0')} · SoftifyOS</footer>
    </article>
  );
}
