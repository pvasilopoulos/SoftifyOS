import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

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

    const { id } = await context.params;
    const order = await prisma.order.findFirst({
      where: { id, tenantId: session.tenantId },
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
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
