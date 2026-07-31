import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["DRAFT", "ORDERED", "CANCELLED"]).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  siteId: z.string().min(1).optional().nullable(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await context.params;
    const po = await prisma.purchaseOrder.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        site: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { position: "asc" },
          include: {
            product: {
              select: { id: true, sku: true, name: true, unit: true },
            },
          },
        },
      },
    });
    if (!po) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
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
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
    const existing = await prisma.purchaseOrder.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    const body = patchSchema.parse(await request.json());
    if (
      body.status === "CANCELLED" &&
      (existing.status === "PARTIAL" || existing.status === "RECEIVED")
    ) {
      return NextResponse.json(
        { error: "Δεν ακυρώνεται παραγγελία με παραλαβές" },
        { status: 400 },
      );
    }
    const item = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.siteId !== undefined ? { siteId: body.siteId } : {}),
      },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        site: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { position: "asc" },
          include: {
            product: {
              select: { id: true, sku: true, name: true, unit: true },
            },
          },
        },
      },
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "purchase_order.update",
      entity: "purchase_order",
      entityId: item.id,
      meta: { status: item.status },
    });
    return NextResponse.json({
      item: {
        ...item,
        subtotal: toNumber(item.subtotal),
        vatAmount: toNumber(item.vatAmount),
        total: toNumber(item.total),
        orderedAt: item.orderedAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        lines: item.lines.map((l) => ({
          ...l,
          quantity: toNumber(l.quantity),
          quantityReceived: toNumber(l.quantityReceived),
          unitPrice: toNumber(l.unitPrice),
          vatRate: toNumber(l.vatRate),
          lineTotal: toNumber(l.lineTotal),
        })),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
