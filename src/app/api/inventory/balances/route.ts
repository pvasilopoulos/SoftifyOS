import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  siteId: z.string().min(1).optional(),
  lowStock: z.enum(["1", "true"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { q, siteId, limit } = parsed.data;
    const rows = await prisma.stockBalance.findMany({
      where: {
        tenantId: session.tenantId,
        ...(siteId ? { siteId } : {}),
        ...(q
          ? {
              product: {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { sku: { contains: q, mode: "insensitive" } },
                  { barcode: { contains: q, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      },
      take: limit,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
            status: true,
            trackInventory: true,
          },
        },
        site: { select: { id: true, code: true, name: true } },
      },
    });

    const items = rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      sku: r.product.sku,
      name: r.product.name,
      unit: r.product.unit,
      status: r.product.status,
      trackInventory: r.product.trackInventory,
      siteId: r.siteId,
      siteCode: r.site.code,
      siteName: r.site.name,
      qtyOnHand: toNumber(r.qtyOnHand),
      updatedAt: r.updatedAt.toISOString(),
    }));

    const [sites, productCount, movementCount] = await Promise.all([
      prisma.site.findMany({
        where: { tenantId: session.tenantId, isActive: true, kind: "BRANCH" },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.product.count({
        where: { tenantId: session.tenantId, trackInventory: true },
      }),
      prisma.stockMovement.count({ where: { tenantId: session.tenantId } }),
    ]);

    return NextResponse.json({
      items,
      sites,
      meta: {
        balanceRows: items.length,
        trackedProducts: productCount,
        movements: movementCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
