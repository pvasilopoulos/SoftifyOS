import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

async function nextInvoiceNumber(tenantId: string) {
  const year = new Date().getFullYear();
  const prefix = `ΤΙΜ-${year}-`;
  const latest = await prisma.invoice.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = latest?.number?.slice(prefix.length) ?? "0";
  const seq = Number.parseInt(lastSeq, 10);
  const next = Number.isFinite(seq) ? seq + 1 : 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
}

export async function POST(
  _request: Request,
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
    const order = await prisma.order.findFirst({
      where: { id, tenantId: session.tenantId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!order) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (order.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Η ακυρωμένη παραγγελία δεν τιμολογείται" },
        { status: 400 },
      );
    }
    if (order.status === "INVOICED") {
      const existing = await prisma.invoice.findFirst({
        where: { tenantId: session.tenantId, orderId: order.id },
        select: { id: true, number: true },
      });
      return NextResponse.json(
        {
          error: "Η παραγγελία έχει ήδη τιμολογηθεί",
          invoiceId: existing?.id,
          invoiceNumber: existing?.number,
        },
        { status: 409 },
      );
    }
    if (order.lines.length === 0) {
      return NextResponse.json(
        { error: "Η παραγγελία δεν έχει γραμμές" },
        { status: 400 },
      );
    }

    const number = await nextInvoiceNumber(session.tenantId);
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 30);

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          tenantId: session.tenantId,
          customerId: order.customerId,
          branchId: order.branchId,
          spaceId: order.spaceId,
          orderId: order.id,
          number,
          status: "ISSUED",
          issuedAt: new Date(),
          dueAt,
          currency: order.currency,
          subtotal: order.subtotal,
          vatAmount: order.vatAmount,
          total: order.total,
          paidAmount: 0,
          notes: order.notes
            ? `Από παραγγελία ${order.number}\n${order.notes}`
            : `Από παραγγελία ${order.number}`,
          lines: {
            create: order.lines.map((line) => ({
              tenantId: session.tenantId,
              position: line.position,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatRate: line.vatRate,
              lineTotal: line.lineTotal,
            })),
          },
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { status: "INVOICED" },
      });

      return invoice;
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "order.invoice",
      entity: "order",
      entityId: order.id,
      meta: {
        orderNumber: order.number,
        invoiceId: result.id,
        invoiceNumber: result.number,
      },
    });

    return NextResponse.json(
      {
        item: {
          orderId: order.id,
          invoiceId: result.id,
          invoiceNumber: result.number,
          total: toNumber(result.total),
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
        { error: "Σύγκρουση αριθμού τιμολογίου — δοκιμάστε ξανά" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Invoice failed") },
      { status: 400 },
    );
  }
}
