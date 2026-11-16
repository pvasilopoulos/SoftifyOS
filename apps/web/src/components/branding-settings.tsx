'use client';
// Settings → Branding: name & tagline, logo, app icon (PWA / home screen) and favicon.
// Images are resized in the browser (canvas) before upload, so any PNG/JPG/WebP/SVG works and stays small.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, ImageUp, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { brandAsset, type Brand, type BrandKind } from '@/lib/brand';
import { Card } from './settings-sections';
import { useToast } from './providers';

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary disabled:opacity-60';
const primaryBtn = 'flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60';
const smallBtn = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-60';

type Settings = { brand_name: string | null; brand_tagline: string | null; effective: Brand; can_edit: boolean };

// ---------------------------------------------------------------- image processing
function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('bad_image'));
    img.src = url;
  });
}

/** Draws the image into a canvas. "fit" keeps the whole image (with optional padding and background). */
function render(img: HTMLImageElement, w: number, h: number, opts: { padding?: number; background?: string | null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, w, h); }
  const pad = Math.round(Math.min(w, h) * (opts.padding ?? 0));
  const iw = img.naturalWidth || img.width || w;
  const ih = img.naturalHeight || img.height || h;
  const scale = Math.min((w - pad * 2) / iw, (h - pad * 2) / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

function toDataUrl(c: HTMLCanvasElement) {
  const png = c.toDataURL('image/png');
  // Photos can make big PNGs: fall back to WebP (keeps transparency)
  return png.length > 1_300_000 ? c.toDataURL('image/webp', 0.9) : png;
}

async function processLogo(file: File) {
  const img = await loadImage(file);
  const iw = img.naturalWidth || 512, ih = img.naturalHeight || 256;
  const scale = Math.min(1, 512 / iw, 256 / ih);
  return { logo: toDataUrl(render(img, Math.max(1, Math.round(iw * scale)), Math.max(1, Math.round(ih * scale)))) };
}
async function processIcon(file: File, background: string | null) {
  const img = await loadImage(file);
  return {
    icon: toDataUrl(render(img, 512, 512, { padding: background ? 0.12 : 0, background })),
    icon192: toDataUrl(render(img, 192, 192, { padding: background ? 0.12 : 0, background })),
  };
}
async function processFavicon(file: File) {
  const img = await loadImage(file);
  return { favicon: toDataUrl(render(img, 64, 64)) };
}

// ---------------------------------------------------------------- section
export function BrandingSection() {
  const t = useTranslations('settings.branding');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings', 'branding'], queryFn: () => api<Settings>('/settings/branding') });
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [iconBg, setIconBg] = useState<string>('#ffffff');
  const [iconBgOn, setIconBgOn] = useState(true);
  useEffect(() => { if (data) { setName(data.brand_name ?? ''); setTagline(data.brand_tagline ?? ''); } }, [data]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['settings', 'branding'] }); qc.invalidateQueries({ queryKey: ['me'] }); };
  const saveText = useMutation({
    mutationFn: () => api('/settings/branding', { method: 'PUT', json: { brand_name: name, brand_tagline: tagline } }),
    onSuccess: () => { refresh(); toast({ title: ts('saved') }); },
    onError: () => toast({ title: ts('error') }),
  });
  const upload = useMutation({
    mutationFn: (assets: Partial<Record<BrandKind, string | null>>) => api('/settings/branding/assets', { method: 'PUT', json: { assets } }),
    onSuccess: () => { refresh(); toast({ title: ts('saved') }); },
    onError: (e) => toast({ title: e instanceof ApiError && e.code === 'invalid_image' ? t('invalidImage') : ts('error') }),
  });
  const run = async (fn: () => Promise<Partial<Record<BrandKind, string>>>) => {
    try { upload.mutate(await fn()); } catch { toast({ title: t('invalidImage') }); }
  };

  if (!data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const b = data.effective;
  const ro = !data.can_edit;
  const busy = upload.isPending;
  const preview: Brand = { ...b, name: name.trim() || 'SoftifyOS', tagline: name.trim() ? (tagline.trim() || null) : (tagline.trim() || 'Enterprise Business OS') };

  return (
    <div className="space-y-4">
      {ro && <p className="flex items-center gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info"><ShieldCheck size={16} /> {ts('adminOnly')}</p>}

      <Card title={t('nameTitle')} description={t('nameHint')}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveText.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-medium text-muted">{t('name')}</span>
              <input disabled={ro} maxLength={60} className={input} placeholder="SoftifyOS" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-medium text-muted">{t('tagline')}</span>
              <input disabled={ro} maxLength={80} className={input} placeholder="Enterprise Business OS" value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <LogoPreview brand={preview} dark />
            <LogoPreview brand={preview} />
          </div>
          {!ro && (
            <div className="flex justify-end">
              <button disabled={saveText.isPending} className={primaryBtn}>{saveText.isPending ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} {ts('save')}</button>
            </div>
          )}
        </form>
      </Card>

      <Card title={t('logoTitle')} description={t('logoHint')}>
        <Uploader ro={ro} busy={busy} has={!!b.assets.logo} onFile={(f) => run(() => processLogo(f))} onRemove={() => upload.mutate({ logo: null })}>
          <div className="flex min-h-20 flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-surface-2 p-3">
            {brandAsset(b, 'logo')
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={brandAsset(b, 'logo')!} alt="" className="max-h-16 max-w-full object-contain" />
              : <span className="text-sm text-muted">{t('none')}</span>}
          </div>
        </Uploader>
      </Card>

      <Card title={t('iconTitle')} description={t('iconHint')}>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={ro} className="h-4 w-4 accent-[var(--primary)]" checked={iconBgOn} onChange={(e) => setIconBgOn(e.target.checked)} />
            {t('iconBackground')}
          </label>
          {iconBgOn && <input type="color" disabled={ro} value={iconBg} onChange={(e) => setIconBg(e.target.value)} aria-label={t('iconBackground')} className="h-8 w-12 cursor-pointer rounded-lg border border-border bg-surface" />}
          <span className="text-xs text-muted">{t('iconBackgroundHint')}</span>
        </div>
        <Uploader ro={ro} busy={busy} has={!!b.assets.icon} onFile={(f) => run(() => processIcon(f, iconBgOn ? iconBg : null))} onRemove={() => upload.mutate({ icon: null, icon192: null })}>
          <div className="flex flex-1 items-end gap-5 rounded-2xl bg-gradient-to-br from-[#2a2356] to-[#120f2b] p-4">
            {[64, 48].map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brandAsset(b, 'icon') ?? '/icons/192'} alt="" style={{ width: s, height: s }} className="rounded-[22%] bg-white object-cover shadow-lg" />
                <span className="max-w-20 truncate text-[11px] text-white/80">{preview.name}</span>
              </div>
            ))}
          </div>
        </Uploader>
      </Card>

      <Card title={t('faviconTitle')} description={t('faviconHint')}>
        <Uploader ro={ro} busy={busy} has={!!b.assets.favicon} onFile={(f) => run(() => processFavicon(f))} onRemove={() => upload.mutate({ favicon: null })}>
          <div className="flex flex-1 items-center rounded-2xl bg-surface-2 p-3">
            <div className="flex max-w-60 items-center gap-2 rounded-t-xl border border-b-0 border-border bg-surface px-3 py-2 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brandAsset(b, 'favicon') ?? brandAsset(b, 'icon192') ?? '/icons/192'} alt="" className="h-4 w-4 object-contain" />
              <span className="truncate">{preview.name}</span>
            </div>
          </div>
        </Uploader>
      </Card>
    </div>
  );
}

function LogoPreview({ brand, dark }: { brand: Brand; dark?: boolean }) {
  const logo = brandAsset(brand, 'logo');
  return (
    <div className={clsx('flex min-w-0 items-center gap-2.5 rounded-2xl p-3', dark ? 'bg-sidebar' : 'border border-border bg-surface')}>
      {logo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={logo} alt="" className={clsx('h-9 max-w-[120px] shrink-0 object-contain', dark && 'rounded-lg bg-white p-1')} />
        : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#7c63ff] to-[#4a2ee0] text-lg font-black text-white">{(brand.name.trim()[0] ?? 'S').toUpperCase()}</span>}
      <div className="min-w-0 leading-tight">
        <div className={clsx('truncate text-lg font-extrabold tracking-tight', dark ? 'text-white' : 'text-text')}>{brand.name}</div>
        {brand.tagline && <div className={clsx('truncate text-[11px]', dark ? 'text-white/60' : 'text-muted')}>{brand.tagline}</div>}
      </div>
    </div>
  );
}

function Uploader({ ro, busy, has, onFile, onRemove, children }: { ro: boolean; busy: boolean; has: boolean; onFile: (f: File) => void; onRemove: () => void; children: ReactNode }) {
  const t = useTranslations('settings.branding');
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {children}
      {!ro && (
        <div className="flex shrink-0 gap-2 sm:flex-col">
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          <button type="button" disabled={busy} onClick={() => ref.current?.click()} className={smallBtn}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ImageUp size={15} />} {has ? t('replace') : t('upload')}
          </button>
          {has && <button type="button" disabled={busy} onClick={onRemove} className={clsx(smallBtn, 'text-danger hover:bg-danger-soft')}><Trash2 size={15} /> {t('remove')}</button>}
        </div>
      )}
    </div>
  );
}
