import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { formViewPatchSchema } from "@/modules/entity-views/schemas";
import { serializeFormView } from "@/modules/entity-views/service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;
    const { id } = await ctx.params;
    const existing = await prisma.entityFormView.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    const body = formViewPatchSchema.parse(await request.json());
    if (body.isDefault) {
      await prisma.entityFormView.updateMany({
        where: {
          tenantId: session!.tenantId,
          entity: existing.entity,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      });
    }
    const item = await prisma.entityFormView.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.configJson !== undefined
          ? { configJson: body.configJson as unknown as Prisma.InputJsonValue }
          : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      },
    });
    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.form_views.update",
      entity: "entity_form_view",
      entityId: item.id,
      meta: { code: item.code },
    });
    return NextResponse.json({ item: serializeFormView(item) });
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

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;
    const { id } = await ctx.params;
    const existing = await prisma.entityFormView.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json(
        { error: "Οι system φόρμες δεν διαγράφονται" },
        { status: 400 },
      );
    }
    await prisma.entityFormView.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
