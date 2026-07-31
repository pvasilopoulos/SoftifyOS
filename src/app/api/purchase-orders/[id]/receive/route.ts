import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { receivePurchaseOrderLines } from "@/modules/purchasing/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  note: z.string().trim().max(500).optional().nullable(),
  items: z
    .array(
      z.object({
        lineId: z.string().min(1),
        qty: z.coerce.number().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = schema.parse(await request.json());

    const result = await prisma.$transaction(async (tx) =>
      receivePurchaseOrderLines(tx, {
        tenantId: session.tenantId,
        purchaseOrderId: id,
        userId: session.sub,
        items: body.items,
        note: body.note,
      }),
    );

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "purchase_order.receive",
      entity: "purchase_order",
      entityId: id,
      meta: {
        movements: result.movements.length,
        siteId: result.siteId,
        status: result.order.status,
      },
    });

    const po = result.order;
    return NextResponse.json({
      item: {
        ...po,
        subtotal: toNumber(po.subtotal),
        vatAmount: toNumber(po.vatAmount),
        total: toNumber(po.total),
        orderedAt: po.orderedAt.toISOString(),
        createdAt: po.createdAt.toISOString(),
        updatedAt: po.updatedAt.toISOString(),
        lines: po.lines.map((l) => ({
          ...l,
          quantity: toNumber(l.quantity),
          quantityReceived: toNumber(l.quantityReceived),
          unitPrice: toNumber(l.unitPrice),
          vatRate: toNumber(l.vatRate),
          lineTotal: toNumber(l.lineTotal),
        })),
      },
      movements: result.movements,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Receive failed") },
      { status: 400 },
    );
  }
}
