'use client';
import { useMe } from './app-shell';
import { EntityTile } from './ui';

/** Customer avatar that respects Settings → Customers (organisation default, optional per-user override). */
export function useShowCustomerAvatar() {
  const { data } = useMe();
  return data?.tenant?.show_customer_avatar ?? true;
}

export function CustomerAvatar({ name, size }: { name: string; size?: number }) {
  return useShowCustomerAvatar() ? <EntityTile name={name} size={size} /> : null;
}
