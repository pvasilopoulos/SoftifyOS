import { ImageResponse } from 'next/og';

// Generated PNG app icons: /icons/96, /icons/180 (apple), /icons/192, /icons/512, /icons/512m (maskable)
const SIZES: Record<string, { px: number; maskable?: boolean }> = {
  '96': { px: 96 }, '180': { px: 180 }, '192': { px: 192 }, '512': { px: 512 }, '512m': { px: 512, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const cfg = SIZES[size] ?? SIZES['192'];
  const px = cfg.px;
  const inner = cfg.maskable ? px * 0.6 : px;
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: 'flex', alignItems: 'center', justifyContent: 'center', background: cfg.maskable ? '#5b3df5' : 'transparent' }}>
        <div style={{
          width: inner, height: inner, borderRadius: cfg.maskable ? 0 : px * 0.22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #7c63ff 0%, #4a2ee0 100%)', color: 'white', fontSize: inner * 0.58, fontWeight: 900,
        }}>S</div>
      </div>
    ),
    { width: px, height: px, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  );
}
