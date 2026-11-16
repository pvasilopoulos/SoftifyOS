'use client';
// Organisation branding (name, tagline, logo, app icon, favicon).
// Signed in: comes with /me. Login page: the last organisation used on this device (cached locally).
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { api, type Me } from './api';

export type BrandKind = 'logo' | 'icon' | 'icon192' | 'favicon';
export type Brand = { tenant_id: string; name: string; tagline: string | null; custom_name: boolean; assets: Partial<Record<BrandKind, number>> };

const CACHE = 'sos.brand';
export const DEFAULT_BRAND: Brand = { tenant_id: '', name: 'SoftifyOS', tagline: 'Enterprise Business OS', custom_name: false, assets: {} };

export const brandAsset = (b: Brand, kind: BrandKind) => (b.assets[kind] ? `/api/brand/${b.tenant_id}/${kind}?v=${b.assets[kind]}` : null);

function readCache(): Brand | null {
  try { return JSON.parse(localStorage.getItem(CACHE) ?? 'null'); } catch { return null; }
}

/** Branding to show. `signedIn` = false on public pages (login, invitation), which must not call /me. */
export function useBrand(signedIn = true): Brand {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me & { brand: Brand }>('/me'), staleTime: 5 * 60_000, enabled: signedIn, retry: false });
  const [cached, setCached] = useState<Brand | null>(null);
  useEffect(() => setCached(readCache()), []);
  const live = (me.data as (Me & { brand?: Brand }) | undefined)?.brand;
  useEffect(() => {
    if (live) { try { localStorage.setItem(CACHE, JSON.stringify(live)); } catch {} }
  }, [live]);
  return live ?? cached ?? DEFAULT_BRAND;
}

/** Points the tab icon and the iOS home-screen icon at the organisation's images. */
export function useBrandHead(b: Brand) {
  const path = usePathname();
  useEffect(() => {
    const set = (rel: string, href: string | null, fallback: string) => {
      let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-brand]`);
      if (!el) {
        document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`).forEach((x) => x.remove());
        el = document.createElement('link');
        el.rel = rel;
        el.dataset.brand = '1';
        document.head.appendChild(el);
      }
      el.href = href ?? fallback;
    };
    set('icon', brandAsset(b, 'favicon') ?? brandAsset(b, 'icon192'), '/icons/192');
    set('apple-touch-icon', brandAsset(b, 'icon'), '/icons/180');
  }, [b]);
  // Page titles come from Next metadata ("… · SoftifyOS"): swap in the organisation name after each navigation
  useEffect(() => {
    if (!b.custom_name) return;
    const fix = () => { if (document.title.includes('SoftifyOS')) document.title = document.title.replaceAll('SoftifyOS', b.name); };
    fix();
    const el = document.querySelector('title');
    if (!el) return;
    const mo = new MutationObserver(fix);
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, [b, path]);
}
