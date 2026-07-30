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
import {
  resolveProductUnit,
  UnitOfMeasureError,
} from "@/modules/units/service";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const productListSchema = listQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
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

    const { limit, cursor: cursorParam, q, status } = parsed.data;
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        sku: string;
        name: string;
        unit: string;
        vatRate: Prisma.Decimal;
        price: Prisma.Decimal;
        status: string;
        createdAt: Date;
      }>
    >`
      SELECT
        p.id, p.sku, p.name, p.unit, p."vatRate", p.price, p.status, p."createdAt"
      FROM products p
      WHERE p."tenantId" = ${session.tenantId}
        ${status ? Prisma.sql`AND p.status = ${status}::"ProductStatus"` : Prisma.empty}
        ${
          q
            ? Prisma.sql`AND (
                p.name ILIKE ${"%" + q + "%"}
                OR p.sku ILIKE ${"%" + q + "%"}
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
      unit: row.unit,
      vatRate: toNumber(row.vatRate),
      price: toNumber(row.price),
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
    const unit = await resolveProductUnit(prisma, {
      tenantId: session.tenantId,
      unitId: body.unitId,
      unit: body.unit,
    });
    const product = await prisma.product.create({
      data: {
        tenantId: session.tenantId,
        sku: body.sku,
        barcode: body.barcode || null,
        name: body.name,
        unit: unit.symbol,
        unitId: unit.id,
        vatRate: body.vatRate ?? 24,
        price: body.price,
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
      return NextResponse.json(
        { error: "Το SKU ή barcode υπάρχει ήδη" },
        { status: 409 },
      );
    }
    if (error instanceof UnitOfMeasureError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
