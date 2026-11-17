'use client';
import { useTabTitle } from '@/components/tabs';
import { Suspense, useState, type ComponentType } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Search, X, Building2, SlidersHorizontal, Sparkles, ChevronRight, Contact, FileText, LayoutList, Palette, History, Landmark, ListChecks, Package, Plug, ShieldCheck, UserRound, Users } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { IconButton } from '@/components/ui';
import {
  ApprovalsSection, AuditSection, CompaniesSection, ListsSection, OffersSettingsSection, OrganizationSection, ProductsSection, ProfileSection, UsersSection,
} from '@/components/settings-sections';
import { BrandingSection } from '@/components/branding-settings';
import { ModuleFormsSection } from '@/components/forms-settings';
import { CrmSettingsSection } from '@/components/crm-settings';
import { CustomersSettingsSection, IndexesSettingsSection, IntegrationsSection } from '@/components/settings-sections-2';

const SECTIONS: { key: string; icon: typeof Users; Component: ComponentType }[] = [
  { key: 'organization', icon: Building2, Component: OrganizationSection },
  { key: 'branding', icon: Palette, Component: BrandingSection },
  { key: 'companies', icon: Landmark, Component: CompaniesSection },
  { key: 'users', icon: Users, Component: UsersSection },
  { key: 'offers', icon: FileText, Component: OffersSettingsSection },
  { key: 'approvals', icon: ShieldCheck, Component: ApprovalsSection },
  { key: 'customers', icon: Contact, Component: CustomersSettingsSection },
  { key: 'indexes', icon: LayoutList, Component: IndexesSettingsSection },
  { key: 'forms', icon: SlidersHorizontal, Component: ModuleFormsSection },
  { key: 'crm', icon: Sparkles, Component: CrmSettingsSection },
  { key: 'products', icon: Package, Component: ProductsSection },
  { key: 'lists', icon: ListChecks, Component: ListsSection },
  { key: 'integrations', icon: Plug, Component: IntegrationsSection },
  { key: 'profile', icon: UserRound, Component: ProfileSection },
  { key: 'audit', icon: History, Component: AuditSection },
];

function SettingsInner() {
  const t = useTranslations('settings');
  const router = useRouter();
  const sp = useSearchParams();
  const current = SECTIONS.find((s) => s.key === sp.get('s'));
  const active = current ?? SECTIONS[0];
  useTabTitle(`${t('title')} · ${t(`nav.${active.key}` as never)}`);
  const Section = active.Component;

  // Search across section names, descriptions and keywords (accent/case-insensitive)
  const [q, setQ] = useState('');
  const fold = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const needle = fold(q.trim());
  const shown = needle
    ? SECTIONS.filter(({ key }) => fold(`${t(`nav.${key}` as never)} ${t(`navHint.${key}` as never)} ${t(`navKeywords.${key}` as never)}`).includes(needle))
    : SECTIONS;

  const nav = (
    <nav className="card overflow-hidden">
      <div className="border-b border-border p-2 lg:border-b-0 lg:pb-0">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')}
            className="w-full rounded-xl border border-border bg-surface-2 py-2 pl-9 pr-9 text-sm outline-none transition focus:border-primary [&::-webkit-search-cancel-button]:hidden" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="clear" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-text">
              <X size={14} />
            </button>
          )}
        </label>
      </div>
      {!shown.length && <p className="px-4 py-6 text-center text-sm text-muted">{t('noResults')}</p>}
      <ul className="divide-y divide-border lg:divide-y-0 lg:p-2">
        {shown.map(({ key, icon: Icon }) => (
          <li key={key}>
            <Link href={`/settings?s=${key}`} scroll={false}
              className={clsx('flex items-center gap-3 px-4 py-3.5 transition lg:rounded-xl lg:px-3 lg:py-2.5',
                active.key === key ? 'lg:bg-primary-soft lg:text-primary' : 'hover:bg-surface-2')}>
              <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', active.key === key ? 'bg-primary text-white' : 'bg-primary-soft text-primary', 'lg:h-8 lg:w-8')}>
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{t(`nav.${key}` as never)}</span>
                <span className="block truncate text-xs text-muted lg:hidden">{t(`navHint.${key}` as never)}</span>
              </span>
              <ChevronRight size={17} className="text-muted lg:hidden" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div>
      {/* Phone: section list first, then the chosen section with a back button */}
      <div className="lg:hidden">
        {current ? (
          <>
            <header className="mb-4 flex items-center gap-1">
              <IconButton label="back" onClick={() => router.push('/settings')}><ArrowLeft size={22} /></IconButton>
              <h1 className="flex-1 truncate text-xl font-bold">{t(`nav.${current.key}` as never)}</h1>
            </header>
            <Section />
          </>
        ) : (
          <>
            <h1 className="mb-1 text-2xl font-bold">{t('title')}</h1>
            <p className="mb-4 text-sm text-muted">{t('subtitle')}</p>
            {nav}
          </>
        )}
      </div>

      {/* Desktop: side navigation + content */}
      <div className="hidden lg:block">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mb-6 text-muted">{t('subtitle')}</p>
        <div className="grid grid-cols-[260px_1fr] items-start gap-6">
          <div className="sticky top-6">{nav}</div>
          <div className="min-w-0">
            <div className="mb-4">
              <h2 className="text-xl font-bold">{t(`nav.${active.key}` as never)}</h2>
              <p className="text-sm text-muted">{t(`navHint.${active.key}` as never)}</p>
            </div>
            <Section />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <Suspense><SettingsInner /></Suspense>;
}
