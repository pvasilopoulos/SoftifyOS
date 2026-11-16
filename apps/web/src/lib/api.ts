// Same-origin API client: cookies carry the session, nginx (prod) / Next rewrite (dev) route /api.
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.endsWith('/login')) {
    location.href = location.pathname.startsWith('/en') ? '/en/login' : '/el/login';
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? 'error');
  }
  return res.json() as Promise<T>;
}

export type Page<T> = { items: T[]; nextCursor: string | null };

export type Customer = {
  id: string; code: string; kind: 'group' | 'company'; name: string; status: string; category: string | null;
  image_url: string | null; annual_value: string; companies_count: number; branches_count: number; spaces_count: number;
};
export type Offer = {
  id: string; number: string; status: string; current_version: number; total_amount: string;
  valid_until: string | null; created_at: string; customer_name: string; branch_name: string | null;
};
export type Activity = { id: string; kind: string; title: string; body: string | null; occurred_at: string; actor_name: string | null };
export type CalEvent = { id: string; kind: string; title: string; location: string | null; starts_at: string; ends_at: string; customer_name: string | null };
export type Me = {
  user: { id: string; email: string; full_name: string; avatar_url: string | null };
  tenant: { id: string; slug: string; name: string; role: string; title: string | null; show_customer_avatar?: boolean };
  tenants: { id: string; slug: string; name: string; role: string }[];
};
