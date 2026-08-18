import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/shared/lib/cursor";
import { productCreateSchema } from "@/modules/master-data/schemas";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const productListSchema = listQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  lowStock: z.coerce.boolean().optional().default(false),
});

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = productListSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { limit, cursor: cursorParam, q, status, category, brand, lowStock } =
      parsed.data;
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        sku: string;
        name: string;
        category: string | null;
        brand: string | null;
        barcode: string | null;
        unit: string;
        vatRate: Prisma.Decimal;
        price: Prisma.Decimal;
        cost: Prisma.Decimal;
        stockOnHand: Prisma.Decimal;
        minStock: Prisma.Decimal;
        reorderQty: Prisma.Decimal;
        location: string | null;
        tags: string[];
        isTracked: boolean;
        status: string;
        createdAt: Date;
      }>
    >`
      SELECT
        p.id, p.sku, p.name, p.category, p.brand, p.barcode, p.unit, p."vatRate", p.price, p.cost,
        p."stockOnHand", p."minStock", p."reorderQty", p.location, p.tags, p."isTracked", p.status, p."createdAt"
      FROM products p
      WHERE p."tenantId" = ${session.tenantId}
        ${status ? Prisma.sql`AND p.status = ${status}::"ProductStatus"` : Prisma.empty}
        ${category ? Prisma.sql`AND p.category = ${category}` : Prisma.empty}
        ${brand ? Prisma.sql`AND p.brand = ${brand}` : Prisma.empty}
        ${
          lowStock
            ? Prisma.sql`AND p."isTracked" = true AND p."stockOnHand" <= p."minStock"`
            : Prisma.empty
        }
        ${
          q
            ? Prisma.sql`AND (
                p.name ILIKE ${"%" + q + "%"}
                OR p.sku ILIKE ${"%" + q + "%"}
                OR p.barcode ILIKE ${"%" + q + "%"}
              )`
            : Prisma.empty
        }
        ${
          cursor
            ? Prisma.sql`AND (p."createdAt", p.id) < (${new Date(cursor.createdAt)}::timestamptz, ${cursor.id})`
            : Prisma.empty
        }
      ORDER BY p."createdAt" DESC, p.id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      brand: row.brand,
      barcode: row.barcode,
      unit: row.unit,
      vatRate: toNumber(row.vatRate),
      price: toNumber(row.price),
      cost: toNumber(row.cost),
      stockOnHand: toNumber(row.stockOnHand),
      minStock: toNumber(row.minStock),
      reorderQty: toNumber(row.reorderQty),
      location: row.location,
      tags: row.tags,
      isTracked: row.isTracked,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return NextResponse.json({
      items,
      nextCursor,
      meta: { ms: Date.now() - started, count: items.length, hasMore },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "List failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = productCreateSchema.parse(await request.json());
    const product = await prisma.product.create({
      data: {
        tenantId: session.tenantId,
        sku: body.sku,
        name: body.name,
        unit: body.unit || "τεμ",
        category: body.category || null,
        brand: body.brand || null,
        barcode: body.barcode || null,
        vatRate: body.vatRate ?? 24,
        price: body.price,
        cost: body.cost ?? 0,
        stockOnHand: body.stockOnHand ?? 0,
        minStock: body.minStock ?? 0,
        reorderQty: body.reorderQty ?? 0,
        location: body.location || null,
        tags: body.tags ?? [],
        isTracked: body.isTracked ?? true,
        notes: body.notes || null,
        status: body.status ?? "ACTIVE",
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "product.create",
      entity: "product",
      entityId: product.id,
      meta: { sku: product.sku },
    });

    return NextResponse.json(
      {
        item: {
          ...product,
          vatRate: toNumber(product.vatRate),
          price: toNumber(product.price),
          createdAt: product.createdAt.toISOString(),
          updatedAt: product.updatedAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "SKU ή barcode υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
