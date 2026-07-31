import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { customerUpdateSchema } from "@/modules/master-data/schemas";
import {
  mergeCustomFields,
} from "@/modules/entity-views/service";

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
      include: {
        branches: {
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
          include: {
            spaces: { orderBy: [{ type: "asc" }, { name: "asc" }] },
            _count: { select: { spaces: true } },
          },
        },
      },
    });

    if (!customer) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    return NextResponse.json({
      item: {
        ...customer,
        customFields:
          customer.customFields && typeof customer.customFields === "object"
            ? customer.customFields
            : {},
        branches: customer.branches.map((b) => ({
          ...b,
          spaces: b.spaces.map((s) => ({
            ...s,
            areaSqm: s.areaSqm == null ? null : Number(s.areaSqm),
          })),
          spaceCount: b._count.spaces,
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
    const existing = await prisma.customer.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = customerUpdateSchema.parse(await request.json());
    let customFields: Prisma.InputJsonValue | undefined;
    if (body.customFields !== undefined) {
      customFields = await mergeCustomFields(
        prisma,
        session.tenantId,
        "CUSTOMERS",
        existing.customFields,
        body.customFields,
      );
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.vatNumber !== undefined
          ? { vatNumber: body.vatNumber || null }
          : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(customFields !== undefined ? { customFields } : {}),
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "customer.update",
      entity: "customer",
      entityId: customer.id,
      meta: { code: customer.code },
    });

    return NextResponse.json({ item: customer });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Ο κωδικός πελάτη υπάρχει ήδη" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
