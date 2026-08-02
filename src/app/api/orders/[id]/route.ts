import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  isCompanyScopeError,
  requireCompanyId,
} from "@/platform/tenancy/company-scope";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { buildChangeMeta } from "@/platform/tenancy/audit-diff";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  calcInvoiceTotals,
  toNumber,
} from "@/modules/sales/invoice-utils";
import { orderUpdateSchema } from "@/modules/sales/order-schemas";
import { orderAuditSnapshot } from "@/modules/sales/order-audit";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const legalEntityId = requireCompanyId(session);

    const { id } = await context.params;
    const order = await prisma.order.findFirst({
      where: { id, tenantId: session.tenantId, legalEntityId },
      include: {
        customer: true,
        branch: true,
        space: true,
        lines: {
          orderBy: { position: "asc" },
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
        invoices: {
          select: { id: true, number: true, status: true, total: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    return NextResponse.json({
      item: {
        ...order,
        subtotal: toNumber(order.subtotal),
        vatAmount: toNumber(order.vatAmount),
        total: toNumber(order.total),
        orderedAt: order.orderedAt.toISOString(),
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        lines: order.lines.map((line) => ({
          ...line,
          quantity: toNumber(line.quantity),
          unitPrice: toNumber(line.unitPrice),
          vatRate: toNumber(line.vatRate),
          lineTotal: toNumber(line.lineTotal),
        })),
        invoices: order.invoices.map((inv) => ({
          ...inv,
          total: toNumber(inv.total),
        })),
      },
    });
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

/** Edit draft orders (notes/lines/branch) or confirm/cancel when allowed. */
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
    const legalEntityId = requireCompanyId(session);

    const { id } = await context.params;
    const existing = await prisma.order.findFirst({
      where: { id, tenantId: session.tenantId, legalEntityId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (existing.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Η παραγγελία είναι ακυρωμένη" },
        { status: 400 },
      );
    }
    if (
      existing.status === "INVOICED" ||
      existing.status === "PARTIAL_INVOICED"
    ) {
      return NextResponse.json(
        { error: "Η παραγγελία έχει τιμολογηθεί και είναι κλειδωμένη" },
        { status: 400 },
      );
    }

    const body = orderUpdateSchema.parse(await request.json());
    const before = orderAuditSnapshot(existing);

    if (body.lines && existing.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Οι γραμμές αλλάζουν μόνο σε πρόχειρο" },
        { status: 400 },
      );
    }

    if (body.status === "CONFIRMED" && existing.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Μόνο πρόχειρο μπορεί να επιβεβαιωθεί" },
        { status: 400 },
      );
    }

    const totals = body.lines ? calcInvoiceTotals(body.lines) : null;

    let nextStatusOptionId: string | undefined;
    if (body.status) {
      const { ensureOrderStatusOptions } = await import(
        "@/modules/sales/order-status-options"
      );
      await ensureOrderStatusOptions(prisma, session.tenantId);
      const opt = await prisma.orderStatusOption.findFirst({
        where: {
          tenantId: session.tenantId,
          code: body.status,
          isSystem: true,
        },
        select: { id: true },
      });
      nextStatusOptionId = opt?.id;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.lines) {
        await tx.orderLine.deleteMany({ where: { orderId: existing.id } });
      }
      return tx.order.update({
        where: { id: existing.id },
        data: {
          ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
          ...(body.spaceId !== undefined ? { spaceId: body.spaceId } : {}),
          ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
          ...(body.status !== undefined
            ? {
                status: body.status,
                ...(nextStatusOptionId
                  ? { statusOptionId: nextStatusOptionId }
                  : {}),
              }
            : {}),
          ...(totals
            ? {
                subtotal: totals.subtotal,
                vatAmount: totals.vatAmount,
                total: totals.total,
                lines: {
                  create: body.lines!.map((line, idx) => ({
                    tenantId: session.tenantId,
                    productId: line.productId || null,
                    position: idx + 1,
                    description: line.description,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    vatRate: line.vatRate,
                    lineTotal: totals.lines[idx]!.lineTotal,
                  })),
                },
              }
            : {}),
        },
        include: { lines: { orderBy: { position: "asc" } } },
      });
    });

    const after = orderAuditSnapshot(updated);
    const action =
      body.status === "CANCELLED"
        ? "order.cancel"
        : body.status === "CONFIRMED" && existing.status === "DRAFT"
          ? "order.confirm"
          : existing.kind === "SALES_QUOTE"
            ? "quote.update"
            : "order.update";

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action,
      entity: "order",
      entityId: updated.id,
      meta: buildChangeMeta({
        before,
        after,
        extra: {
          number: updated.number,
          kind: updated.kind,
        },
      }),
    });

    return NextResponse.json({
      item: {
        id: updated.id,
        number: updated.number,
        status: updated.status,
        kind: updated.kind,
        notes: updated.notes,
        subtotal: toNumber(updated.subtotal),
        vatAmount: toNumber(updated.vatAmount),
        total: toNumber(updated.total),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
