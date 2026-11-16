'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toFormValues, type CustomerDetail } from '@/lib/customers';
import { CustomerForm } from '@/components/customer-form';
import { Skeleton } from '@/components/ui';

export default function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useQuery({ queryKey: ['customer', id, 'edit'], queryFn: () => api<CustomerDetail>(`/customers/${id}`), staleTime: 0 });
  if (!data) return <div className="mx-auto max-w-4xl space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-72" /><Skeleton className="h-48" /></div>;
  return <CustomerForm customerId={id} initial={toFormValues(data.customer)} />;
}
