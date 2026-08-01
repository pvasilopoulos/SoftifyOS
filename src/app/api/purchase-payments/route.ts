import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  supplierId: z.string().trim().min(1),
  purchaseOrderId: z.string().trim().min(1).optional().nullable(),
  amount: z.coerce.number().positive().max(10_000_000),
  method: z.string().trim().min(1).max(40).optional(),
  reference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  paidAt: z.string().datetime({ offset: true }).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const supplierId = new URL(request.url).searchParams.get("supplierId");
    const items = await prisma.purchasePayment.findMany({
      where: {
        tenantId: session.tenantId,
        ...(supplierId ? { supplierId } : {}),
      },
      orderBy: { paidAt: "desc" },
      take: 100,
      include: {
        supplier: { select: { code: true, name: true } },
        purchaseOrder: { select: { number: true } },
      },
    });
    return NextResponse.json({
      items: items.map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        method: p.method,
        reference: p.reference,
        notes: p.notes,
        paidAt: p.paidAt.toISOString(),
        supplier: p.supplier,
        purchaseOrder: p.purchaseOrder,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
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
    const body = createSchema.parse(await request.json());
    const supplier = await prisma.supplier.findFirst({
      where: { id: body.supplierId, tenantId: session.tenantId },
    });
    if (!supplier) {
      return NextResponse.json({ error: "Προμηθευτής δεν βρέθηκε" }, { status: 404 });
    }
    if (body.purchaseOrderId) {
      const po = await prisma.purchaseOrder.findFirst({
        where: {
          id: body.purchaseOrderId,
          tenantId: session.tenantId,
          supplierId: body.supplierId,
        },
      });
      if (!po) {
        return NextResponse.json(
          { error: "Η παραγγελία αγοράς δεν βρέθηκε" },
          { status: 404 },
        );
      }
    }
    const item = await prisma.purchasePayment.create({
      data: {
        tenantId: session.tenantId,
        supplierId: body.supplierId,
        purchaseOrderId: body.purchaseOrderId || null,
        amount: body.amount,
        method: body.method || "TRANSFER",
        reference: body.reference || null,
        notes: body.notes || null,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
      },
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "purchase.payment",
      entity: "purchase_payment",
      entityId: item.id,
      meta: {
        supplierId: item.supplierId,
        amount: toNumber(item.amount),
        purchaseOrderId: item.purchaseOrderId,
      },
    });
    return NextResponse.json(
      {
        item: {
          id: item.id,
          amount: toNumber(item.amount),
          paidAt: item.paidAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
