import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { scriptPatchSchema } from "@/modules/scripts/schemas";
import { isKnownEvent } from "@/modules/scripts/events";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Ctx) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const { id } = await context.params;
    const existing = await prisma.scriptDefinition.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = scriptPatchSchema.parse(await request.json());
    const nextModule = body.module ?? existing.module;
    const nextEvent = body.eventKey ?? existing.eventKey;
    if (
      (body.module !== undefined || body.eventKey !== undefined) &&
      !isKnownEvent(nextModule, nextEvent)
    ) {
      return NextResponse.json(
        { error: "Άγνωστο event για το module." },
        { status: 400 },
      );
    }

    const item = await prisma.scriptDefinition.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.eventKey !== undefined ? { eventKey: body.eventKey } : {}),
        ...(body.runtime !== undefined ? { runtime: body.runtime } : {}),
        ...(body.source !== undefined ? { source: body.source } : {}),
        ...(body.lifecycle !== undefined ? { lifecycle: body.lifecycle } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
        updatedById: session!.sub,
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.scripts.update",
      entity: "script_definition",
      entityId: item.id,
      meta: { code: item.code, lifecycle: item.lifecycle },
    });

    return NextResponse.json({ item });
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

export async function DELETE(_request: Request, context: Ctx) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const { id } = await context.params;
    const existing = await prisma.scriptDefinition.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    await prisma.scriptDefinition.delete({ where: { id } });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.scripts.delete",
      entity: "script_definition",
      entityId: id,
      meta: { code: existing.code },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
