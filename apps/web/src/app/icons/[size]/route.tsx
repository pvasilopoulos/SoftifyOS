import { ImageResponse } from 'next/og';
import { MARK, markShapes } from '@/components/softify-mark';

// Generated PNG app icons: /icons/96, /icons/180 (apple), /icons/192, /icons/512, /icons/512m (maskable)
const SIZES: Record<string, { px: number; maskable?: boolean; apple?: boolean }> = {
  '96': { px: 96 }, '180': { px: 180, apple: true }, '192': { px: 192 }, '512': { px: 512 }, '512m': { px: 512, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const cfg = SIZES[size] ?? SIZES['192'];
  const px = cfg.px;
  // Maskable: full-bleed tile, modules shrunk into the safe zone. Apple: iOS rounds the corners itself.
  const full = cfg.maskable || cfg.apple;
  const view = cfg.maskable ? '-8 -8 80 80' : '0 0 64 64';
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: 'flex', background: full ? MARK.tile : 'transparent' }}>
        <svg width={px} height={px} viewBox={view}>
          {!full && <rect width="64" height="64" rx="15" fill={MARK.tile} />}
          {markShapes()}
        </svg>
      </div>
    ),
    { width: px, height: px, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  );
}
