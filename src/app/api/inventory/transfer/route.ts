import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  applyStockDelta,
  InventoryError,
} from "@/modules/inventory/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  productId: z.string().trim().min(1),
  fromSiteId: z.string().trim().min(1),
  toSiteId: z.string().trim().min(1),
  qty: z.coerce.number().positive().max(1_000_000),
  note: z.string().trim().max(500).optional().nullable(),
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
    if (body.fromSiteId === body.toSiteId) {
      return NextResponse.json(
        { error: "Επίλεξε διαφορετικές αποθήκες" },
        { status: 400 },
      );
    }

    const transferId = `trf_${Date.now().toString(36)}`;
    const result = await prisma.$transaction(async (tx) => {
      const out = await applyStockDelta(tx, {
        tenantId: session.tenantId,
        siteId: body.fromSiteId,
        productId: body.productId,
        delta: -body.qty,
        type: "OUT",
        source: "MANUAL",
        note: body.note || `Ενδοδιακίνηση → ${body.toSiteId}`,
        refType: "transfer",
        refId: transferId,
        userId: session.sub,
        allowNegative: false,
      });
      const inn = await applyStockDelta(tx, {
        tenantId: session.tenantId,
        siteId: body.toSiteId,
        productId: body.productId,
        delta: body.qty,
        type: "IN",
        source: "MANUAL",
        note: body.note || `Ενδοδιακίνηση ← ${body.fromSiteId}`,
        refType: "transfer",
        refId: transferId,
        userId: session.sub,
      });
      return { out, inn, transferId };
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "inventory.transfer",
      entity: "stock_transfer",
      entityId: transferId,
      meta: {
        productId: body.productId,
        fromSiteId: body.fromSiteId,
        toSiteId: body.toSiteId,
        qty: body.qty,
      },
    });

    return NextResponse.json({ item: result }, { status: 201 });
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Transfer failed") },
      { status: 400 },
    );
  }
}
