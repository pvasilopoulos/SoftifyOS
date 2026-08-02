import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  companyStamp,
  isCompanyScopeError,
  requireCompanyId,
} from "@/platform/tenancy/company-scope";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  allocatePurchaseOrderNumber,
  calcPoLineTotal,
  sumPoTotals,
} from "@/modules/purchasing/service";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  productId: z.string().min(1).optional().nullable(),
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPrice: z.coerce.number().nonnegative().max(10_000_000),
  vatRate: z.coerce.number().min(0).max(100).default(24),
});

const createSchema = z.object({
  supplierId: z.string().min(1),
  siteId: z.string().min(1).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  confirm: z.boolean().optional().default(true),
  lines: z.array(lineSchema).min(1).max(200),
});

function serializeOrder(po: {
  id: string;
  number: string;
  status: string;
  orderedAt: Date;
  currency: string;
  subtotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  notes: string | null;
  supplierId: string;
  siteId: string | null;
  createdAt: Date;
  updatedAt: Date;
  supplier?: { id: string; code: string; name: string };
  site?: { id: string; code: string; name: string } | null;
  lines?: Array<{
    id: string;
    productId: string | null;
    position: number;
    description: string;
    quantity: Prisma.Decimal;
    quantityReceived: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    vatRate: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    product?: { id: string; sku: string; name: string; unit: string } | null;
  }>;
}) {
  return {
    id: po.id,
    number: po.number,
    status: po.status,
    orderedAt: po.orderedAt.toISOString(),
    currency: po.currency,
    subtotal: toNumber(po.subtotal),
    vatAmount: toNumber(po.vatAmount),
    total: toNumber(po.total),
    notes: po.notes,
    supplierId: po.supplierId,
    siteId: po.siteId,
    supplier: po.supplier ?? null,
    site: po.site ?? null,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    lines: (po.lines ?? []).map((l) => ({
      id: l.id,
      productId: l.productId,
      position: l.position,
      description: l.description,
      quantity: toNumber(l.quantity),
      quantityReceived: toNumber(l.quantityReceived),
      unitPrice: toNumber(l.unitPrice),
      vatRate: toNumber(l.vatRate),
      lineTotal: toNumber(l.lineTotal),
      product: l.product ?? null,
    })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const legalEntityId = requireCompanyId(session);
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const items = await prisma.purchaseOrder.findMany({
      where: {
        tenantId: session.tenantId,
        legalEntityId,
        ...(status
          ? {
              status: status as
                | "DRAFT"
                | "ORDERED"
                | "PARTIAL"
                | "RECEIVED"
                | "CANCELLED",
            }
          : {}),
      },
      orderBy: [{ orderedAt: "desc" }, { id: "desc" }],
      take: 100,
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
    return NextResponse.json({ items: items.map(serializeOrder) });
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

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const legalEntityId = requireCompanyId(session);

    const body = createSchema.parse(await request.json());
    const supplier = await prisma.supplier.findFirst({
      where: { id: body.supplierId, tenantId: session.tenantId },
    });
    if (!supplier) {
      return NextResponse.json({ error: "Άγνωστος προμηθευτής" }, { status: 400 });
    }

    const totals = sumPoTotals(body.lines);

    const item = await prisma.$transaction(async (tx) => {
      const allocated = await allocatePurchaseOrderNumber(
        tx,
        session.tenantId,
        body.siteId,
        legalEntityId,
      );

      return tx.purchaseOrder.create({
        data: {
          tenantId: session.tenantId,
          ...companyStamp(session),
          supplierId: body.supplierId,
          siteId: body.siteId || allocated.siteId || null,
          seriesId: allocated.seriesId,
          number: allocated.number,
          status: body.confirm ? "ORDERED" : "DRAFT",
          notes: body.notes || null,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          lines: {
            create: body.lines.map((l, idx) => {
              const { lineTotal } = calcPoLineTotal(
                l.quantity,
                l.unitPrice,
                l.vatRate,
              );
              return {
                tenantId: session.tenantId,
                productId: l.productId || null,
                position: idx,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                vatRate: l.vatRate,
                lineTotal,
              };
            }),
          },
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
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "purchase_order.create",
      entity: "purchase_order",
      entityId: item.id,
      meta: { number: item.number, status: item.status },
    });

    return NextResponse.json({ item: serializeOrder(item) }, { status: 201 });
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
