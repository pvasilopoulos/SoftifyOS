import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  approxCoordsFromCity,
  bboxFromCenter,
  cellSizeForZoom,
  haversineKm,
  isPlausibleGreeceCoord,
  lookupCityCoords,
} from "@/modules/customers/geo";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  minLat: z.coerce.number().min(-90).max(90),
  maxLat: z.coerce.number().min(-90).max(90),
  minLng: z.coerce.number().min(-180).max(180),
  maxLng: z.coerce.number().min(-180).max(180),
  zoom: z.coerce.number().min(0).max(22).default(10),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  q: z.string().trim().max(80).optional(),
  nearLat: z.coerce.number().min(-90).max(90).optional(),
  nearLng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.5).max(200).optional(),
  /** When true, fill missing coords from city approx (capped) */
  backfill: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export async function GET(req: NextRequest) {
  const t0 = performance.now();
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Μη έγκυρα όρια χάρτη" },
        { status: 400 },
      );
    }

    const input = parsed.data;
    let { minLat, maxLat, minLng, maxLng } = input;
    if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
    if (minLng > maxLng) [minLng, maxLng] = [maxLng, minLng];

    if (input.nearLat != null && input.nearLng != null && input.radiusKm) {
      const box = bboxFromCenter(input.nearLat, input.nearLng, input.radiusKm);
      minLat = Math.max(minLat, box.minLat);
      maxLat = Math.min(maxLat, box.maxLat);
      minLng = Math.max(minLng, box.minLng);
      maxLng = Math.min(maxLng, box.maxLng);
    }

    const tenantId = session.tenantId;

    // Opportunistic backfill so map works before full geocoding job
    let backfilled = 0;
    if (input.backfill) {
      backfilled = await backfillMissingCoords(tenantId, 400);
    }

    const cell = cellSizeForZoom(input.zoom);
    const status = input.status;
    const q = input.q?.trim();

    type ClusterRow = {
      lat: number;
      lng: number;
      count: number;
      sampleBranchId: string;
      sampleCustomerId: string;
      sampleName: string;
      sampleCode: string;
    };

    let clusters: ClusterRow[] = [];

    if (cell <= 0) {
      // High zoom → individual points (capped)
      const rows = await prisma.$queryRaw<
        Array<{
          id: string;
          customerId: string;
          lat: number;
          lng: number;
          name: string;
          tradeName: string | null;
          code: string;
          address: string | null;
          city: string | null;
          postalCode: string | null;
          status: string;
          phone: string | null;
        }>
      >(Prisma.sql`
        SELECT b.id, b."customerId", b.lat, b.lng,
               c.name, c."tradeName", c.code,
               COALESCE(b.address, c.address) AS address,
               COALESCE(b.city, c.city) AS city,
               COALESCE(b."postalCode", c."postalCode") AS "postalCode",
               c.status::text as status,
               COALESCE(b.phone, c.phone) AS phone
        FROM branches b
        INNER JOIN customers c ON c.id = b."customerId"
        WHERE b."tenantId" = ${tenantId}
          AND b.lat IS NOT NULL AND b.lng IS NOT NULL
          AND b.lat BETWEEN ${minLat} AND ${maxLat}
          AND b.lng BETWEEN ${minLng} AND ${maxLng}
          ${status ? Prisma.sql`AND c.status::text = ${status}` : Prisma.empty}
          ${
            q
              ? Prisma.sql`AND (
                  c.name ILIKE ${"%" + q + "%"}
                  OR c."tradeName" ILIKE ${"%" + q + "%"}
                  OR c.code ILIKE ${"%" + q + "%"}
                  OR COALESCE(b.city, c.city, '') ILIKE ${"%" + q + "%"}
                  OR COALESCE(b.address, c.address, '') ILIKE ${"%" + q + "%"}
                )`
              : Prisma.empty
          }
        ORDER BY b."isPrimary" DESC, c.name ASC
        LIMIT 1200
      `);

      let points = rows.map((r) => {
        const brand = (r.tradeName || r.name || "").trim();
        return {
          type: "point" as const,
          id: r.id,
          customerId: r.customerId,
          lat: r.lat,
          lng: r.lng,
          name: r.name,
          tradeName: r.tradeName,
          brand,
          code: r.code,
          address: r.address,
          city: r.city,
          postalCode: r.postalCode,
          status: r.status,
          phone: r.phone,
          count: 1,
        };
      });

      if (input.nearLat != null && input.nearLng != null && input.radiusKm) {
        points = points
          .map((p) => ({
            ...p,
            distanceKm: Math.round(
              haversineKm(input.nearLat!, input.nearLng!, p.lat, p.lng) * 10,
            ) / 10,
          }))
          .filter((p) => (p.distanceKm ?? 0) <= input.radiusKm!)
          .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
      }

      const [totalGeocoded, bounds] = await Promise.all([
        countGeocoded(tenantId),
        geocodedBounds(tenantId),
      ]);

      return NextResponse.json({
        mode: "points",
        zoom: input.zoom,
        items: points,
        meta: {
          ms: Math.round(performance.now() - t0),
          returned: points.length,
          totalGeocoded,
          backfilled,
          cellSize: 0,
          bounds,
        },
      });
    }

    type RichClusterRow = ClusterRow & {
      sampleTradeName: string | null;
      sampleAddress: string | null;
      sampleCity: string | null;
      sampleStatus: string | null;
    };

    const richClusters = await prisma.$queryRaw<RichClusterRow[]>(Prisma.sql`
      SELECT
        AVG(b.lat)::float8 AS lat,
        AVG(b.lng)::float8 AS lng,
        COUNT(*)::int AS count,
        (ARRAY_AGG(b.id ORDER BY b."isPrimary" DESC, c.name ASC))[1] AS "sampleBranchId",
        (ARRAY_AGG(b."customerId" ORDER BY b."isPrimary" DESC, c.name ASC))[1] AS "sampleCustomerId",
        (ARRAY_AGG(c.name ORDER BY b."isPrimary" DESC, c.name ASC))[1] AS "sampleName",
        (ARRAY_AGG(c."tradeName" ORDER BY b."isPrimary" DESC, c.name ASC))[1] AS "sampleTradeName",
        (ARRAY_AGG(c.code ORDER BY b."isPrimary" DESC, c.name ASC))[1] AS "sampleCode",
        (ARRAY_AGG(COALESCE(b.address, c.address) ORDER BY b."isPrimary" DESC, c.name ASC))[1] AS "sampleAddress",
        (ARRAY_AGG(COALESCE(b.city, c.city) ORDER BY b."isPrimary" DESC, c.name ASC))[1] AS "sampleCity",
        (ARRAY_AGG(c.status::text ORDER BY b."isPrimary" DESC, c.name ASC))[1] AS "sampleStatus"
      FROM branches b
      INNER JOIN customers c ON c.id = b."customerId"
      WHERE b."tenantId" = ${tenantId}
        AND b.lat IS NOT NULL AND b.lng IS NOT NULL
        AND b.lat BETWEEN ${minLat} AND ${maxLat}
        AND b.lng BETWEEN ${minLng} AND ${maxLng}
        ${status ? Prisma.sql`AND c.status::text = ${status}` : Prisma.empty}
        ${
          q
            ? Prisma.sql`AND (
                c.name ILIKE ${"%" + q + "%"}
                OR c."tradeName" ILIKE ${"%" + q + "%"}
                OR c.code ILIKE ${"%" + q + "%"}
                OR COALESCE(b.city, c.city, '') ILIKE ${"%" + q + "%"}
              )`
            : Prisma.empty
        }
      GROUP BY FLOOR(b.lat / ${cell}), FLOOR(b.lng / ${cell})
      ORDER BY COUNT(*) DESC
      LIMIT 500
    `);
    clusters = richClusters;

    const items = richClusters.map((c) => {
      const brand = (c.sampleTradeName || c.sampleName || "").trim();
      return c.count === 1
        ? {
            type: "point" as const,
            id: c.sampleBranchId,
            customerId: c.sampleCustomerId,
            lat: c.lat,
            lng: c.lng,
            name: c.sampleName,
            tradeName: c.sampleTradeName,
            brand,
            code: c.sampleCode,
            address: c.sampleAddress,
            city: c.sampleCity,
            status: c.sampleStatus ?? undefined,
            count: 1,
          }
        : {
            type: "cluster" as const,
            id: `c:${c.lat.toFixed(4)}:${c.lng.toFixed(4)}`,
            lat: c.lat,
            lng: c.lng,
            count: c.count,
            sampleName: brand || c.sampleName,
          };
    });

    const [totalGeocoded, bounds] = await Promise.all([
      countGeocoded(tenantId),
      geocodedBounds(tenantId),
    ]);

    return NextResponse.json({
      mode: "clusters",
      zoom: input.zoom,
      items,
      meta: {
        ms: Math.round(performance.now() - t0),
        returned: items.length,
        totalGeocoded,
        backfilled,
        cellSize: cell,
        bounds,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Map query failed") },
      { status: 500 },
    );
  }
}

async function countGeocoded(tenantId: string) {
  return prisma.branch.count({
    where: { tenantId, lat: { not: null }, lng: { not: null } },
  });
}

async function geocodedBounds(tenantId: string) {
  const row = await prisma.$queryRaw<
    Array<{
      minLat: number | null;
      maxLat: number | null;
      minLng: number | null;
      maxLng: number | null;
    }>
  >(Prisma.sql`
    SELECT MIN(lat)::float8 AS "minLat", MAX(lat)::float8 AS "maxLat",
           MIN(lng)::float8 AS "minLng", MAX(lng)::float8 AS "maxLng"
    FROM branches
    WHERE "tenantId" = ${tenantId}
      AND lat IS NOT NULL AND lng IS NOT NULL
  `);
  const b = row[0];
  if (
    !b ||
    b.minLat == null ||
    b.maxLat == null ||
    b.minLng == null ||
    b.maxLng == null
  ) {
    return null;
  }
  return b;
}

async function backfillMissingCoords(tenantId: string, limit: number) {
  // Missing coords OR known city with coords outside Greece (bad prior fallback)
  const candidates = await prisma.branch.findMany({
    where: {
      tenantId,
      OR: [
        { lat: null },
        { lng: null },
        { city: { not: null } },
        { address: { not: null } },
        { customer: { city: { not: null } } },
      ],
    },
    select: {
      id: true,
      city: true,
      address: true,
      lat: true,
      lng: true,
      customer: { select: { city: true, address: true } },
    },
    take: Math.max(limit, 800),
  });
  if (candidates.length === 0) return 0;

  const now = new Date();
  let n = 0;
  for (const b of candidates) {
    if (n >= limit) break;
    const place =
      b.city ||
      b.customer.city ||
      b.address ||
      b.customer.address ||
      null;
    const known = lookupCityCoords(place);
    const missing = b.lat == null || b.lng == null;
    const bad =
      b.lat != null &&
      b.lng != null &&
      !isPlausibleGreeceCoord(b.lat, b.lng) &&
      Boolean(known);
    if (!missing && !bad) continue;

    const coords = approxCoordsFromCity(place);
    if (!coords) continue;
    await prisma.branch.update({
      where: { id: b.id },
      data: { lat: coords.lat, lng: coords.lng, geocodedAt: now },
    });
    n += 1;
  }
  return n;
}
