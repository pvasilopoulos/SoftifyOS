'use client';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { initials } from '@/lib/format';

const tone: Record<string, string> = {
  active: 'bg-success-soft text-success', accepted: 'bg-success-soft text-success', approved: 'bg-success-soft text-success',
  prospect: 'bg-info-soft text-info', sent: 'bg-info-soft text-info',
  negotiation: 'bg-warning-soft text-warning', pending_approval: 'bg-warning-soft text-warning', pending: 'bg-warning-soft text-warning',
  in_progress: 'bg-primary-soft text-primary', draft: 'bg-surface-2 text-muted',
  inactive: 'bg-surface-2 text-muted', rejected: 'bg-danger-soft text-danger',
};

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('status');
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', tone[status] ?? 'bg-surface-2 text-muted')}>
      {t(status as never)}
    </span>
  );
}

export function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

/** Deterministic gradient tile used where a customer has no photo */
export function EntityTile({ name, size = 56 }: { name: string; size?: number }) {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-2xl font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.34, background: `linear-gradient(135deg, hsl(${h} 70% 58%), hsl(${(h + 40) % 360} 65% 42%))` }}
    >
      {initials(name)}
    </span>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition',
            value === o.value ? 'bg-primary text-white shadow-sm' : 'bg-surface text-muted border border-border',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="no-scrollbar flex gap-5 overflow-x-auto border-b border-border">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx('-mb-px shrink-0 border-b-2 pb-2.5 text-sm font-medium transition',
            value === o.value ? 'border-primary text-primary' : 'border-transparent text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, actions, back }: { title: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-3 bg-bg/85 px-4 py-3 backdrop-blur-md safe-top lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
      {back}
      <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{title}</h1>
      <div className="flex items-center gap-1">{actions}</div>
    </header>
  );
}

export function IconButton({ children, onClick, label, className }: { children: ReactNode; onClick?: () => void; label: string; className?: string }) {
  return (
    <button aria-label={label} onClick={onClick} className={clsx('grid h-10 w-10 place-items-center rounded-full text-text transition hover:bg-surface-2', className)}>
      {children}
    </button>
  );
}
