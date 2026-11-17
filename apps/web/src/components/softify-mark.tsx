// The SoftifyOS mark: four modules on a violet tile, one of them a mint circle.
// Shared by the in-app badge (no custom branding) and the generated PNG icons (src/app/icons).
// Static copies for use outside the app: public/brand/*.svg

export const MARK = { tile: '#5b3df5', module: '#ffffff', accent: '#3ee0b0' } as const;

/** Module shapes on a 64×64 grid (the tile itself is drawn by the caller).
 *  A plain function, not a component: next/og (satori) only accepts intrinsic elements inside <svg>. */
export function markShapes(fill: string = MARK.module, accent: string = MARK.accent) {
  return [
    <rect key="a" x="14" y="14" width="16" height="16" rx="5" fill={fill} />,
    <circle key="b" cx="42" cy="22" r="8" fill={accent} />,
    <rect key="c" x="14" y="34" width="16" height="16" rx="5" fill={fill} fillOpacity={0.72} />,
    <rect key="d" x="34" y="34" width="16" height="16" rx="5" fill={fill} />,
  ];
}

/** The full mark (tile + modules). `radius` is the tile corner on the 64 grid (0 = full-bleed, e.g. maskable icons). */
export function SoftifyMark({ size = 36, radius = 15, tile: tileColor = MARK.tile, className }: { size?: number; radius?: number; tile?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx={radius} fill={tileColor} />
      {markShapes()}
    </svg>
  );
}
