// Branding: organisation name/tagline, logo, app icon (PWA, home screen) and favicon.
// Images are public (they appear on the login page and in the installed app), served with long caching:
// every URL carries ?v=<updated_at> so a new upload is picked up immediately.
import type { FastifyInstance } from 'fastify';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { env } from '../env.js';
import { sql, withTenant } from '../db.js';
import { COOKIE, can, requireAuth } from '../auth.js';
import { audit } from './settings.js';

const KINDS = ['logo', 'icon', 'icon192', 'favicon'] as const;
type Kind = (typeof KINDS)[number];
const MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTES = 1024 * 1024;
const key = new TextEncoder().encode(env.jwtSecret);

export type Brand = { tenant_id: string; name: string; tagline: string | null; custom_name: boolean; assets: Partial<Record<Kind, number>> };

/** Effective branding of a tenant (asset values are version numbers for cache busting). */
export async function loadBrand(tenantId: string): Promise<Brand | null> {
  const [t] = await sql`
    SELECT t.id, t.name, t.brand_name, t.brand_tagline,
           coalesce((SELECT jsonb_object_agg(kind, (extract(epoch FROM updated_at) * 1000)::bigint) FROM tenant_assets a WHERE a.tenant_id = t.id), '{}') AS assets
    FROM tenants t WHERE t.id = ${tenantId}`;
  if (!t) return null;
  return {
    tenant_id: t.id, name: t.brand_name ?? 'SoftifyOS', tagline: t.brand_name ? t.brand_tagline : (t.brand_tagline ?? 'Enterprise Business OS'),
    custom_name: !!t.brand_name, assets: Object.fromEntries(Object.entries(t.assets as Record<string, string>).map(([k, v]) => [k, Number(v)])),
  };
}

/** "data:image/png;base64,…" → validated buffer */
function decodeDataUrl(s: string) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  if (!data.length || data.length > MAX_BYTES) return null;
  // Check the file signature too (not just the declared type)
  const sig = data.subarray(0, 12);
  const ok = (m[1] === 'image/png' && sig[0] === 0x89 && sig.toString('latin1', 1, 4) === 'PNG')
    || (m[1] === 'image/jpeg' && sig[0] === 0xff && sig[1] === 0xd8)
    || (m[1] === 'image/webp' && sig.toString('latin1', 0, 4) === 'RIFF' && sig.toString('latin1', 8, 12) === 'WEBP');
  return ok ? { mime: m[1] as (typeof MIMES)[number], data } : null;
}

async function sessionTenant(cookie: string | undefined) {
  if (!cookie) return null;
  try { return ((await jwtVerify(cookie, key)).payload.tid as string) ?? null; } catch { return null; }
}

export default async function brandingRoutes(app: FastifyInstance) {
  // ---------------- public ----------------
  const tidParam = z.object({ tenantId: z.string().uuid() });

  app.get('/brand/:tenantId', async (req, reply) => {
    const { tenantId } = tidParam.parse(req.params);
    const b = await loadBrand(tenantId);
    if (!b) return reply.code(404).send({ error: 'not_found' });
    reply.header('Cache-Control', 'public, max-age=60');
    return b;
  });

  app.get('/brand/:tenantId/:kind', async (req, reply) => {
    const { tenantId, kind } = z.object({ tenantId: z.string().uuid(), kind: z.enum(KINDS) }).parse(req.params);
    const [a] = await sql`SELECT mime, data FROM tenant_assets WHERE tenant_id = ${tenantId} AND kind = ${kind}`;
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const versioned = typeof (req.query as { v?: string }).v === 'string';
    reply.header('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.type(a.mime).send(a.data);
  });

  // PWA manifest of the signed-in organisation (falls back to the SoftifyOS defaults)
  app.get('/brand/manifest.webmanifest', async (req, reply) => {
    const tid = await sessionTenant(req.cookies[COOKIE]);
    const b = tid ? await loadBrand(tid) : null;
    const icon = (k: Kind) => (b?.assets[k] ? `/api/brand/${b.tenant_id}/${k}?v=${b.assets[k]}` : null);
    const big = icon('icon');
    const small = icon('icon192') ?? big;
    const name = b?.name ?? 'SoftifyOS';
    reply.header('Cache-Control', 'private, no-cache');
    reply.type('application/manifest+json');
    return {
      name, short_name: name.slice(0, 12), description: b?.tagline ?? 'Enterprise Business OS',
      id: '/', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
      background_color: '#f5f4fb', theme_color: '#5b3df5', lang: 'el',
      icons: big ? [
        { src: small, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: big, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: big, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ] : [
        { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/512m', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'Πελάτες', url: '/customers', icons: [{ src: small ?? '/icons/96', sizes: small ? '192x192' : '96x96' }] },
        { name: 'Προσφορές', url: '/offers', icons: [{ src: small ?? '/icons/96', sizes: small ? '192x192' : '96x96' }] },
        { name: 'Ημερολόγιο', url: '/calendar', icons: [{ src: small ?? '/icons/96', sizes: small ? '192x192' : '96x96' }] },
      ],
    };
  });

  // ---------------- settings ----------------
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/settings/branding', async (req) => {
      const T = req.session.tenantId;
      const [t] = await withTenant(T, (tx) => tx`SELECT brand_name, brand_tagline FROM tenants WHERE id = ${T}`);
      return { brand_name: t.brand_name, brand_tagline: t.brand_tagline, effective: await loadBrand(T), can_edit: can(req.session, 'settings.manage') };
    });

    r.put('/settings/branding', async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const b = z.object({
        brand_name: z.string().trim().max(60).nullish().transform((v) => v || null),
        brand_tagline: z.string().trim().max(80).nullish().transform((v) => v || null),
      }).parse(req.body);
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET brand_name = ${b.brand_name}, brand_tagline = ${b.brand_tagline}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'branding.update', b.brand_name, b);
      });
      return loadBrand(s.tenantId);
    });

    // Upload/remove images: { assets: { icon: "data:image/png;base64,…", icon192: "…", favicon: null } }
    r.put('/settings/branding/assets', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
      if (!can(req.session, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const { assets } = z.object({ assets: z.partialRecord(z.enum(KINDS), z.string().max(1_500_000).nullable()) }).parse(req.body);
      const decoded: { kind: Kind; mime: string; data: Buffer }[] = [];
      const removed: Kind[] = [];
      for (const [kind, v] of Object.entries(assets) as [Kind, string | null][]) {
        if (v === null) { removed.push(kind); continue; }
        const d = decodeDataUrl(v);
        if (!d) return reply.code(400).send({ error: 'invalid_image', kind });
        decoded.push({ kind, ...d });
      }
      const s = req.session;
      await withTenant(s.tenantId, async (tx) => {
        for (const a of decoded) {
          await tx`
            INSERT INTO tenant_assets (tenant_id, kind, mime, data) VALUES (${s.tenantId}, ${a.kind}, ${a.mime}, ${a.data})
            ON CONFLICT (tenant_id, kind) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = now()`;
        }
        if (removed.length) await tx`DELETE FROM tenant_assets WHERE tenant_id = ${s.tenantId} AND kind = ANY(${removed})`;
        await audit(tx, s, 'branding.assets', null, { updated: decoded.map((a) => `${a.kind} (${Math.round(a.data.length / 1024)} KB)`), removed });
      });
      return loadBrand(s.tenantId);
    });
  });
}
