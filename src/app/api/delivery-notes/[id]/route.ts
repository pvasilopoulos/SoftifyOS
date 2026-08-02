import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  isCompanyScopeError,
  requireCompanyId,
} from "@/platform/tenancy/company-scope";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["CANCELLED"]).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  shippingAddress: z.string().trim().max(500).optional().nullable(),
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
    const legalEntityId = requireCompanyId(session);
    const { id } = await context.params;
    const note = await prisma.deliveryNote.findFirst({
      where: { id, tenantId: session.tenantId, legalEntityId },
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
    if (!note) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    return NextResponse.json({
      item: {
        ...note,
        issuedAt: note.issuedAt?.toISOString() ?? null,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
        lines: note.lines.map((l) => ({
          ...l,
          quantity: toNumber(l.quantity),
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
    const existing = await prisma.deliveryNote.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    const body = patchSchema.parse(await request.json());
    if (body.status === "CANCELLED" && existing.status === "ISSUED") {
      return NextResponse.json(
        { error: "Εκδομένο δελτίο δεν ακυρώνεται από εδώ (χρειάζεται αντίστροφη κίνηση)" },
        { status: 400 },
      );
    }
    const item = await prisma.deliveryNote.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.shippingAddress !== undefined
          ? { shippingAddress: body.shippingAddress }
          : {}),
      },
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "delivery_note.update",
      entity: "delivery_note",
      entityId: item.id,
      meta: { status: item.status },
    });
    return NextResponse.json({
      item: {
        id: item.id,
        number: item.number,
        status: item.status,
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
