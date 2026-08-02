import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().max(4000).optional().nullable(),
  kind: z.enum(["CALL", "EMAIL", "MEETING", "TASK", "NOTE"]).optional(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  done: z.boolean().optional(),
  doneAt: z.string().datetime({ offset: true }).optional().nullable(),
});

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
    const existing = await prisma.crmActivity.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    const body = patchSchema.parse(await request.json());

    let doneAt = existing.doneAt;
    if (body.done === true) doneAt = new Date();
    if (body.done === false) doneAt = null;
    if (body.doneAt !== undefined) {
      doneAt = body.doneAt ? new Date(body.doneAt) : null;
    }

    const item = await prisma.crmActivity.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body || null } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.dueAt !== undefined
          ? { dueAt: body.dueAt ? new Date(body.dueAt) : null }
          : {}),
        doneAt,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "crm.activity.update",
      entity: "crm_activity",
      entityId: item.id,
      meta: { doneAt: item.doneAt?.toISOString() ?? null },
    });

    return NextResponse.json({
      item: {
        ...item,
        dueAt: item.dueAt?.toISOString() ?? null,
        doneAt: item.doneAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
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
