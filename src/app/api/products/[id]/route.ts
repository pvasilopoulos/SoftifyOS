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
    const product = await prisma.product.findFirst({
      where: { id, tenantId: session.tenantId },
    });

    if (!product) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    return NextResponse.json({
      item: {
        ...product,
        vatRate: toNumber(product.vatRate),
        price: toNumber(product.price),
        cost: toNumber(product.cost),
        stockOnHand: toNumber(product.stockOnHand),
        minStock: toNumber(product.minStock),
        reorderQty: toNumber(product.reorderQty),
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
