'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { applyTheme, getTheme, type Theme } from '@/lib/theme';

const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const ICON = { light: Sun, dark: Moon, system: Monitor };

function useTheme() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    setTheme(getTheme());
    const on = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener('themechange', on);
    return () => window.removeEventListener('themechange', on);
  }, []);
  return theme;
}

/** Language + appearance quick toggles for the menu. `dark` = sidebar styling. */
export function QuickSettings({ variant = 'light', expanded = false }: { variant?: 'light' | 'dark'; expanded?: boolean }) {
  const t = useTranslations('more');
  const locale = useLocale();
  const pathname = usePathname();
  const theme = useTheme();
  const other = locale === 'el' ? 'en' : 'el';
  const ThemeIcon = ICON[theme];
  const btn = clsx(
    'flex items-center gap-2 rounded-xl text-sm font-medium transition',
    expanded ? 'flex-1 justify-center px-3 py-2' : 'h-10 justify-center px-2.5',
    variant === 'dark' ? 'bg-white/5 text-white/80 hover:bg-white/10 hover:text-white' : 'text-text hover:bg-surface-2',
  );

  return (
    <div className={clsx('flex gap-1.5', expanded && 'w-full')}>
      <Link href={pathname} locale={other} className={btn} title={`${t('language')}: ${other === 'el' ? 'Ελληνικά' : 'English'}`}>
        <Globe size={18} />
        <span className="font-semibold">{locale === 'el' ? 'ΕΛ' : 'EN'}</span>
      </Link>
      {/* Theme: icon only (the tooltip / aria-label say which mode is on) */}
      <button onClick={() => applyTheme(NEXT[theme])} className={clsx(btn, expanded && 'flex-none px-3')} title={`${t('theme')}: ${t(theme)}`} aria-label={`${t('theme')}: ${t(theme)}`}>
        <ThemeIcon size={18} />
      </button>
    </div>
  );
}
