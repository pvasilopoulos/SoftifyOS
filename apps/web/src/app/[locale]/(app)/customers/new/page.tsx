'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomerForm, emptyCustomer, type CustomerFormValues } from '@/components/customer-form';
import { SmartImportButton, type ImportedCustomer } from '@/components/ai-features';

/** Fields read by the AI (card / PDF / text) → form values; the contact person goes into the notes. */
function fromImport(base: CustomerFormValues, c: ImportedCustomer): CustomerFormValues {
  const v = (x: string | null | undefined, cur: string) => (x ? x : cur);
  const contact = c.contact ? [c.contact.full_name, c.contact.role, c.contact.email, c.contact.phone].filter(Boolean).join(' · ') : '';
  return {
    ...base, name: v(c.name, base.name), trade_name: v(c.trade_name, base.trade_name), vat: v(c.vat?.replace(/\s/g, ''), base.vat),
    tax_office: v(c.tax_office, base.tax_office), activity: v(c.activity, base.activity), email: v(c.email, base.email), phone: v(c.phone, base.phone),
    mobile: v(c.mobile, base.mobile), website: v(c.website, base.website), address_street: v(c.address_street, base.address_street),
    address_postal: v(c.address_postal, base.address_postal), address_city: v(c.address_city, base.address_city),
    address_region: v(c.address_region, base.address_region), address_country: v(c.address_country?.toUpperCase().slice(0, 2), base.address_country),
    notes: [base.notes, contact, c.notes].filter(Boolean).join('\n'),
  };
}

// /customers/new?parent=<id>&parentName=<name> pre-fills the parent group (e.g. "New subsidiary")
function NewCustomerInner() {
  const sp = useSearchParams();
  const parent = sp.get('parent');
  const [initial, setInitial] = useState<CustomerFormValues>(() => ({ ...emptyCustomer(), parent_id: parent, parent_name: sp.get('parentName') }));
  const [n, setN] = useState(0);
  return (
    <>
      <div className="mb-3 flex justify-end"><SmartImportButton onImport={(c) => { setInitial((b) => fromImport(b, c)); setN((x) => x + 1); }} /></div>
      <CustomerForm key={n} initial={initial} />
    </>
  );
}

export default function NewCustomerPage() {
  return <Suspense><NewCustomerInner /></Suspense>;
}
