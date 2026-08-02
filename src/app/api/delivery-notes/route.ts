import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
import { allocateDeliveryNoteNumber } from "@/modules/delivery-notes/service";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  productId: z.string().min(1).optional().nullable(),
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive().max(1_000_000),
  unit: z.string().trim().max(20).optional(),
});

const createSchema = z.object({
  customerId: z.string().min(1),
  siteId: z.string().min(1).optional().nullable(),
  invoiceId: z.string().min(1).optional().nullable(),
  shippingAddress: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  issue: z.boolean().optional().default(false),
  lines: z.array(lineSchema).min(1).max(200),
});

function serialize(note: {
  id: string;
  number: string;
  status: string;
  issuedAt: Date | null;
  shippingAddress: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  customerId: string;
  siteId: string | null;
  invoiceId: string | null;
  customer?: { id: string; code: string; name: string };
  site?: { id: string; code: string; name: string } | null;
  lines?: Array<{
    id: string;
    productId: string | null;
    position: number;
    description: string;
    quantity: { toString(): string } | number;
    unit: string;
    product?: { id: string; sku: string; name: string; unit: string } | null;
  }>;
}) {
  return {
    id: note.id,
    number: note.number,
    status: note.status,
    issuedAt: note.issuedAt?.toISOString() ?? null,
    shippingAddress: note.shippingAddress,
    notes: note.notes,
    customerId: note.customerId,
    siteId: note.siteId,
    invoiceId: note.invoiceId,
    customer: note.customer ?? null,
    site: note.site ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    lines: (note.lines ?? []).map((l) => ({
      id: l.id,
      productId: l.productId,
      position: l.position,
      description: l.description,
      quantity: toNumber(l.quantity as never),
      unit: l.unit,
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
    const items = await prisma.deliveryNote.findMany({
      where: {
        tenantId: session.tenantId,
        legalEntityId,
        ...(status
          ? { status: status as "DRAFT" | "ISSUED" | "CANCELLED" }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: {
        customer: { select: { id: true, code: true, name: true } },
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
    return NextResponse.json({ items: items.map(serialize) });
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
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, tenantId: session.tenantId },
    });
    if (!customer) {
      return NextResponse.json({ error: "Άγνωστος πελάτης" }, { status: 400 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const allocated = await allocateDeliveryNoteNumber(
        tx,
        session.tenantId,
        body.siteId,
        legalEntityId,
      );

      const note = await tx.deliveryNote.create({
        data: {
          tenantId: session.tenantId,
          ...companyStamp(session),
          customerId: body.customerId,
          siteId: body.siteId || allocated.siteId || null,
          seriesId: allocated.seriesId,
          invoiceId: body.invoiceId || null,
          number: allocated.number,
          status: "DRAFT",
          shippingAddress: body.shippingAddress || null,
          notes: body.notes || null,
          lines: {
            create: body.lines.map((l, idx) => ({
              tenantId: session.tenantId,
              productId: l.productId || null,
              position: idx,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit || "τεμ",
            })),
          },
        },
        include: {
          customer: { select: { id: true, code: true, name: true } },
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

      if (!body.issue) return { note, movements: [] as string[] };

      const { issueDeliveryNote } = await import(
        "@/modules/delivery-notes/service"
      );
      const issued = await issueDeliveryNote(tx, {
        tenantId: session.tenantId,
        deliveryNoteId: note.id,
        userId: session.sub,
      });
      return { note: issued.note, movements: issued.movements };
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: body.issue ? "delivery_note.issue" : "delivery_note.create",
      entity: "delivery_note",
      entityId: created.note.id,
      meta: {
        number: created.note.number,
        status: created.note.status,
        movements: created.movements.length,
      },
    });

    return NextResponse.json(
      { item: serialize(created.note), movements: created.movements },
      { status: 201 },
    );
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
