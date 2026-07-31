import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  decodeCursor,
  encodeCursor,
} from "@/shared/lib/cursor";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { cursorWhere } from "@/shared/lib/cursor";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  productId: z.string().optional(),
  siteId: z.string().optional(),
  type: z.enum(["IN", "OUT", "ADJUST"]).optional(),
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

    const { limit, cursor: cursorParam, productId, siteId, type } = parsed.data;
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const cw = cursorWhere(cursor);
    const rows = await prisma.stockMovement.findMany({
      where: {
        tenantId: session.tenantId,
        ...(productId ? { productId } : {}),
        ...(siteId ? { siteId } : {}),
        ...(type ? { type } : {}),
        ...(cw ? cw : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        product: { select: { sku: true, name: true, unit: true } },
        site: { select: { code: true, name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return NextResponse.json({
      items: page.map((m) => ({
        id: m.id,
        type: m.type,
        source: m.source,
        qty: toNumber(m.qty),
        qtyBefore: toNumber(m.qtyBefore),
        qtyAfter: toNumber(m.qtyAfter),
        note: m.note,
        refType: m.refType,
        refId: m.refId,
        productId: m.productId,
        sku: m.product.sku,
        name: m.product.name,
        unit: m.product.unit,
        siteCode: m.site.code,
        siteName: m.site.name,
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
