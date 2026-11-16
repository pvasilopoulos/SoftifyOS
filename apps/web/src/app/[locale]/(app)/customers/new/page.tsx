'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomerForm, emptyCustomer } from '@/components/customer-form';

// /customers/new?parent=<id>&parentName=<name> pre-fills the parent group (e.g. "New subsidiary")
function NewCustomerInner() {
  const sp = useSearchParams();
  const parent = sp.get('parent');
  return <CustomerForm initial={{ ...emptyCustomer(), parent_id: parent, parent_name: sp.get('parentName') }} />;
}

export default function NewCustomerPage() {
  return <Suspense><NewCustomerInner /></Suspense>;
}
