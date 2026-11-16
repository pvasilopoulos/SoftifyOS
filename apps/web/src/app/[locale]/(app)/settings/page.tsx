'use client';
import { Suspense, type ComponentType } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Building2, ChevronRight, History, Landmark, ListChecks, Package, ShieldCheck, UserRound, Users } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { IconButton } from '@/components/ui';
import {
  ApprovalsSection, AuditSection, CompaniesSection, ListsSection, OrganizationSection, ProductsSection, ProfileSection, UsersSection,
} from '@/components/settings-sections';

const SECTIONS: { key: string; icon: typeof Users; Component: ComponentType }[] = [
  { key: 'organization', icon: Building2, Component: OrganizationSection },
  { key: 'companies', icon: Landmark, Component: CompaniesSection },
  { key: 'users', icon: Users, Component: UsersSection },
  { key: 'approvals', icon: ShieldCheck, Component: ApprovalsSection },
  { key: 'products', icon: Package, Component: ProductsSection },
  { key: 'lists', icon: ListChecks, Component: ListsSection },
  { key: 'profile', icon: UserRound, Component: ProfileSection },
  { key: 'audit', icon: History, Component: AuditSection },
];

function SettingsInner() {
  const t = useTranslations('settings');
  const router = useRouter();
  const sp = useSearchParams();
  const current = SECTIONS.find((s) => s.key === sp.get('s'));
  const active = current ?? SECTIONS[0];
  const Section = active.Component;

  const nav = (
    <nav className="card overflow-hidden">
      <ul className="divide-y divide-border lg:divide-y-0 lg:p-2">
        {SECTIONS.map(({ key, icon: Icon }) => (
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
