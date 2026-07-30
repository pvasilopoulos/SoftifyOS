import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { branchCreateSchema } from "@/modules/master-data/schemas";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

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

    const { id: customerId } = await context.params;
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Πελάτης δεν βρέθηκε" }, { status: 404 });
    }

    const body = branchCreateSchema.parse(await request.json());

    if (body.isPrimary) {
      await prisma.branch.updateMany({
        where: { tenantId: session.tenantId, customerId },
        data: { isPrimary: false },
      });
    }

    const branch = await prisma.branch.create({
      data: {
        tenantId: session.tenantId,
        customerId,
        code: body.code,
        name: body.name,
        address: body.address || null,
        city: body.city || null,
        postalCode: body.postalCode || null,
        phone: body.phone || null,
        isPrimary: body.isPrimary ?? false,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "branch.create",
      entity: "branch",
      entityId: branch.id,
      meta: { customerId, code: branch.code },
    });

    return NextResponse.json({ item: branch }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Ο κωδικός υποκαταστήματος υπάρχει ήδη για τον πελάτη" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
