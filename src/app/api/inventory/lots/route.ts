import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  applyStockDelta,
  InventoryError,
  resolveStockSiteId,
} from "@/modules/inventory/service";

export const dynamic = "force-dynamic";

const receiveSchema = z.object({
  productId: z.string().trim().min(1),
  siteId: z.string().trim().min(1).optional().nullable(),
  lotCode: z.string().trim().min(1).max(60),
  qty: z.coerce.number().positive().max(1_000_000),
  expiresAt: z.string().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const productId = new URL(request.url).searchParams.get("productId");
    const lots = await prisma.stockLot.findMany({
      where: {
        tenantId: session.tenantId,
        ...(productId ? { productId } : {}),
        qtyOnHand: { gt: 0 },
      },
      orderBy: [{ expiresAt: "asc" }, { updatedAt: "desc" }],
      take: 200,
      include: {
        product: { select: { sku: true, name: true, reorderPoint: true } },
        site: { select: { code: true, name: true } },
      },
    });

    const reorder = await prisma.stockBalance.findMany({
      where: { tenantId: session.tenantId },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            reorderPoint: true,
            trackInventory: true,
          },
        },
        site: { select: { code: true } },
      },
      take: 300,
    });
    const hints = reorder
      .filter(
        (r) =>
          r.product.trackInventory &&
          r.product.reorderPoint != null &&
          toNumber(r.qtyOnHand) <= toNumber(r.product.reorderPoint),
      )
      .map((r) => ({
        productId: r.product.id,
        sku: r.product.sku,
        name: r.product.name,
        siteCode: r.site.code,
        qtyOnHand: toNumber(r.qtyOnHand),
        reorderPoint: toNumber(r.product.reorderPoint),
      }));

    return NextResponse.json({
      lots: lots.map((l) => ({
        id: l.id,
        lotCode: l.lotCode,
        qtyOnHand: toNumber(l.qtyOnHand),
        expiresAt: l.expiresAt?.toISOString() ?? null,
        sku: l.product.sku,
        name: l.product.name,
        siteCode: l.site.code,
      })),
      reorderHints: hints,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

/** Receive stock into a lot (also updates site balance). */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = receiveSchema.parse(await request.json());
    const siteId = await resolveStockSiteId(
      prisma,
      session.tenantId,
      body.siteId,
    );

    await prisma.$transaction(async (tx) => {
      await applyStockDelta(tx, {
        tenantId: session.tenantId,
        siteId,
        productId: body.productId,
        delta: body.qty,
        type: "IN",
        source: "RECEIPT",
        note: body.note || `Lot ${body.lotCode}`,
        refType: "lot",
        refId: body.lotCode,
        userId: session.sub,
      });

      // Tag last movement with lotCode
      const last = await tx.stockMovement.findFirst({
        where: {
          tenantId: session.tenantId,
          productId: body.productId,
          siteId,
          refType: "lot",
          refId: body.lotCode,
        },
        orderBy: { createdAt: "desc" },
      });
      if (last) {
        await tx.stockMovement.update({
          where: { id: last.id },
          data: { lotCode: body.lotCode },
        });
      }

      const existing = await tx.stockLot.findUnique({
        where: {
          tenantId_siteId_productId_lotCode: {
            tenantId: session.tenantId,
            siteId,
            productId: body.productId,
            lotCode: body.lotCode,
          },
        },
      });
      if (existing) {
        await tx.stockLot.update({
          where: { id: existing.id },
          data: {
            qtyOnHand: toNumber(existing.qtyOnHand) + body.qty,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : existing.expiresAt,
          },
        });
      } else {
        await tx.stockLot.create({
          data: {
            tenantId: session.tenantId,
            siteId,
            productId: body.productId,
            lotCode: body.lotCode,
            qtyOnHand: body.qty,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          },
        });
      }
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Lot receive failed") },
      { status: 400 },
    );
  }
}
