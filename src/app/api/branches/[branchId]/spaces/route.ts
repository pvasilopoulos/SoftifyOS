import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { spaceCreateSchema } from "@/modules/master-data/schemas";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ branchId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { branchId } = await context.params;
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, tenantId: session.tenantId },
      select: { id: true, customerId: true },
    });
    if (!branch) {
      return NextResponse.json(
        { error: "Υποκατάστημα δεν βρέθηκε" },
        { status: 404 },
      );
    }

    const body = spaceCreateSchema.parse(await request.json());
    const space = await prisma.space.create({
      data: {
        tenantId: session.tenantId,
        branchId,
        code: body.code,
        name: body.name,
        type: body.type ?? "OTHER",
        floorLabel: body.floorLabel || null,
        areaSqm: body.areaSqm ?? null,
        notes: body.notes || null,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "space.create",
      entity: "space",
      entityId: space.id,
      meta: { branchId, customerId: branch.customerId, code: space.code },
    });

    return NextResponse.json(
      {
        item: {
          ...space,
          areaSqm: space.areaSqm == null ? null : Number(space.areaSqm),
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
        { error: "Ο κωδικός χώρου υπάρχει ήδη στο υποκατάστημα" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
