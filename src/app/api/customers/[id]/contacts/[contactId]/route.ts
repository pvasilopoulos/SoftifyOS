import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { customerContactUpdateSchema } from "@/modules/master-data/schemas";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; contactId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, contactId } = await context.params;
    const existing = await prisma.customerContact.findFirst({
      where: { id: contactId, customerId: id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = customerContactUpdateSchema.parse(await request.json());
    if (body.isPrimary) {
      await prisma.customerContact.updateMany({
        where: {
          customerId: id,
          tenantId: session.tenantId,
          NOT: { id: contactId },
        },
        data: { isPrimary: false },
      });
    }

    const item = await prisma.customerContact.update({
      where: { id: contactId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.title !== undefined ? { title: body.title || null } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.mobile !== undefined ? { mobile: body.mobile || null } : {}),
        ...(body.isPrimary !== undefined
          ? { isPrimary: body.isPrimary }
          : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "customer.contact.update",
      entity: "customer_contact",
      entityId: item.id,
      meta: { customerId: id },
    });

    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; contactId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, contactId } = await context.params;
    const existing = await prisma.customerContact.findFirst({
      where: { id: contactId, customerId: id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    await prisma.customerContact.delete({ where: { id: contactId } });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "customer.contact.delete",
      entity: "customer_contact",
      entityId: contactId,
      meta: { customerId: id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
