import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  applyStockDelta,
  InventoryError,
  resolveStockSiteId,
} from "@/modules/inventory/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  productId: z.string().min(1),
  siteId: z.string().min(1).optional().nullable(),
  mode: z.enum(["IN", "OUT", "ADJUST"]),
  qty: z.coerce.number().positive().max(10_000_000),
  /** For ADJUST: absolute target on-hand */
  adjustTo: z.coerce.number().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(500).optional().nullable(),
  allowNegative: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = schema.parse(await request.json());
    const siteId = await resolveStockSiteId(
      prisma,
      session.tenantId,
      body.siteId,
    );

    const result = await prisma.$transaction(async (tx) => {
      if (body.mode === "ADJUST") {
        return applyStockDelta(tx, {
          tenantId: session.tenantId,
          siteId,
          productId: body.productId,
          type: "ADJUST",
          source: "ADJUSTMENT",
          adjustTo: body.adjustTo ?? body.qty,
          note: body.note,
          userId: session.sub,
          allowNegative: body.allowNegative ?? false,
        });
      }
      return applyStockDelta(tx, {
        tenantId: session.tenantId,
        siteId,
        productId: body.productId,
        type: body.mode,
        source: body.mode === "IN" ? "OPENING" : "MANUAL",
        delta: body.qty,
        note: body.note,
        userId: session.sub,
        allowNegative: body.allowNegative ?? false,
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "inventory.adjust",
      entity: "stock_movement",
      entityId: result.movementId ?? body.productId,
      meta: {
        mode: body.mode,
        qty: body.qty,
        siteId,
        productId: body.productId,
      },
    });

    return NextResponse.json({ ok: true, result, siteId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Adjust failed") },
      { status: 400 },
    );
  }
}
