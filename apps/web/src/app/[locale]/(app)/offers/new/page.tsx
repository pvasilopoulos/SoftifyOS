'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OfferEditor } from '@/components/offer-editor';

// /offers/new?customer=<id>&name=<name> pre-selects the customer (e.g. from a customer card)
function NewOfferPageInner() {
  const sp = useSearchParams();
  const id = sp.get('customer');
  const name = sp.get('name');
  return <OfferEditor initial={{ customer: id && name ? { id, name } : null }} />;
}

export default function NewOfferPage() {
  return <Suspense><NewOfferPageInner /></Suspense>;
}
