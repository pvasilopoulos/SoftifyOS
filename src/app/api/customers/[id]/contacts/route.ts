import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { customerContactSchema } from "@/modules/master-data/schemas";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

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
    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    const items = await prisma.customerContact.findMany({
      where: { customerId: id, tenantId: session.tenantId },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "List failed") },
      { status: 500 },
    );
  }
}

export async function POST(
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
    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = customerContactSchema.parse(await request.json());
    if (body.isPrimary) {
      await prisma.customerContact.updateMany({
        where: { customerId: id, tenantId: session.tenantId },
        data: { isPrimary: false },
      });
    }

    const item = await prisma.customerContact.create({
      data: {
        tenantId: session.tenantId,
        customerId: id,
        name: body.name,
        title: body.title || null,
        email: body.email || null,
        phone: body.phone || null,
        mobile: body.mobile || null,
        isPrimary: body.isPrimary ?? false,
        notes: body.notes || null,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "customer.contact.create",
      entity: "customer_contact",
      entityId: item.id,
      meta: { customerId: id, name: item.name },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
