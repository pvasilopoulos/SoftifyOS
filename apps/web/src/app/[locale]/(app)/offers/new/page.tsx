'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OfferEditor } from '@/components/offer-editor';

// /offers/new?customer=<id>&name=<name>[&branch=<id>] pre-selects the customer (and store)
function NewOfferPageInner() {
  const sp = useSearchParams();
  const id = sp.get('customer');
  const name = sp.get('name');
  return <OfferEditor initial={{ customer: id && name ? { id, name } : null, branch_id: sp.get('branch') }} />;
}

export default function NewOfferPage() {
  return <Suspense><NewOfferPageInner /></Suspense>;
}
