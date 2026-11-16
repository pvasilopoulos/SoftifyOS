'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Logo } from '@/components/app-shell';
import { Link } from '@/i18n/navigation';
import { useBrand } from '@/lib/brand';

export default function LoginPage() {
  const t = useTranslations('login');
  const brand = useBrand(false);
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', json: { email, password } });
      location.href = `/${locale}`;
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t('tooMany') : t('invalid'));
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4">
      <form onSubmit={submit} className="card relative w-full max-w-sm p-7">
        <Logo signedIn={false} />
        <h1 className="mt-7 text-2xl font-bold">{t('title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('subtitle', { name: brand.name })}</p>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="email">{t('email')}</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 outline-none focus:border-primary" />
        <label className="mb-1.5 block text-sm font-medium" htmlFor="password">{t('password')}</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 outline-none focus:border-primary" />
        {error && <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white shadow-lg shadow-primary/30 transition hover:bg-primary-600 disabled:opacity-70">
          {busy && <Loader2 size={18} className="animate-spin" />} {t('submit')}
        </button>
        <div className="mt-5 flex justify-center gap-3 text-sm text-muted">
          <Link href="/login" locale="el" className={locale === 'el' ? 'font-semibold text-primary' : ''}>Ελληνικά</Link>
          <span>·</span>
          <Link href="/login" locale="en" className={locale === 'en' ? 'font-semibold text-primary' : ''}>English</Link>
        </div>
      </form>
    </div>
  );
}
