'use client';
import { use, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Logo } from '@/components/app-shell';

// Public page: an invited user sets a password, then is signed in.
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations('invite');
  const locale = useLocale();
  const info = useQuery({
    queryKey: ['invite', token], retry: false,
    queryFn: () => api<{ email: string; full_name: string; tenant_name: string }>(`/invitations/${token}`),
  });
  const [name, setName] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const accept = useMutation({
    mutationFn: () => api(`/invitations/${token}/accept`, { method: 'POST', json: { password: pw, full_name: name ?? info.data?.full_name } }),
    onSuccess: () => { location.href = `/${locale}`; },
    onError: (e) => setError(e instanceof ApiError && e.status === 410 ? t('expired') : e instanceof ApiError ? e.code : 'error'),
  });

  const input = 'mb-3 w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 outline-none focus:border-primary';
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-sidebar px-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/40 blur-3xl" />
      <div className="card relative w-full max-w-sm p-7">
        <Logo />
        <h1 className="mt-7 text-2xl font-bold">{t('title')}</h1>
        {info.isLoading ? <Loader2 className="mt-6 animate-spin text-muted" /> : info.error ? (
          <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {info.error instanceof ApiError && info.error.status === 410 ? t('expired') : t('notFound')}
          </p>
        ) : (
          <form className="mt-2" onSubmit={(e) => {
            e.preventDefault();
            if (pw !== pw2) return setError(t('mismatch'));
            setError(null);
            accept.mutate();
          }}>
            <p className="mb-5 text-sm text-muted">{t('intro', { tenant: info.data!.tenant_name })}</p>
            <input className={input} value={info.data!.email} disabled aria-label="email" />
            <label className="mb-1.5 block text-sm font-medium" htmlFor="name">{t('name')}</label>
            <input id="name" required minLength={2} className={input} value={name ?? info.data!.full_name} onChange={(e) => setName(e.target.value)} />
            <label className="mb-1.5 block text-sm font-medium" htmlFor="pw">{t('password')}</label>
            <input id="pw" required minLength={10} type="password" autoComplete="new-password" className={input} value={pw} onChange={(e) => setPw(e.target.value)} />
            <label className="mb-1.5 block text-sm font-medium" htmlFor="pw2">{t('confirm')}</label>
            <input id="pw2" required minLength={10} type="password" autoComplete="new-password" className={input} value={pw2} onChange={(e) => setPw2(e.target.value)} />
            {error && <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <button disabled={accept.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-70">
              {accept.isPending && <Loader2 size={18} className="animate-spin" />} {t('submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
