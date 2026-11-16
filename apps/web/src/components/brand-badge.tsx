'use client';
// The organisation's badge, shown when there is no logo (sidebar, login, previews). Settings → Branding.
import clsx from 'clsx';
import type { Brand, BrandBadge as Badge } from '@/lib/brand';

export const BADGE_DEFAULT: Required<Omit<Badge, 'text'>> = { from: '#7c63ff', to: '#4a2ee0', fg: '#ffffff', shape: 'rounded' };

export function badgeText(brand: Brand, badge?: Badge) {
  const text = (badge ?? brand.badge)?.text?.trim();
  return text || (brand.name.trim()[0] ?? 'S').toUpperCase();
}

export function BrandBadge({ brand, badge, size = 36, className }: { brand: Brand; badge?: Badge; size?: number; className?: string }) {
  const b = { ...BADGE_DEFAULT, ...(badge ?? brand.badge ?? {}) };
  const text = badgeText(brand, badge);
  return (
    <span aria-hidden
      className={clsx('grid shrink-0 place-items-center overflow-hidden font-black shadow-md', b.shape === 'circle' ? 'rounded-full' : b.shape === 'square' ? 'rounded-md' : 'rounded-xl', className)}
      style={{
        width: size, height: size, color: b.fg, backgroundImage: `linear-gradient(135deg, ${b.from}, ${b.to})`,
        fontSize: size * (text.length >= 3 ? 0.32 : text.length === 2 ? 0.4 : 0.5), letterSpacing: text.length > 1 ? '-0.02em' : undefined,
      }}>
      {text}
    </span>
  );
}
