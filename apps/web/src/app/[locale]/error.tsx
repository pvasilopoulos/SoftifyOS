'use client';
// Error boundary for every page: reports the error and offers a retry instead of a blank screen.
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import { reportError } from '@/lib/report-error';

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common');
  useEffect(() => { reportError(error, { digest: error.digest }); }, [error]);
  return (
    <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="text-lg font-bold">{t('crashTitle')}</div>
        <p className="mt-1 text-sm text-muted">{t('crashHint')}</p>
        <button type="button" onClick={reset} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">
          <RotateCcw size={16} /> {t('retry')}
        </button>
      </div>
    </div>
  );
}
