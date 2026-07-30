import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { printFormPatchSchema } from "@/modules/print-forms/schemas";

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
    const existing = await prisma.printForm.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = printFormPatchSchema.parse(await request.json());
    const kind = body.documentKind ?? existing.documentKind;

    if (body.isDefault) {
      await prisma.printForm.updateMany({
        where: {
          tenantId: session!.tenantId,
          documentKind: kind,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      });
    }

    const item = await prisma.printForm.update({
      where: { id },
      data: {
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.documentKind !== undefined ? { documentKind: body.documentKind } : {}),
        ...(body.paper !== undefined ? { paper: body.paper } : {}),
        ...(body.orientation !== undefined ? { orientation: body.orientation } : {}),
        ...(body.bodyJson !== undefined
          ? { bodyJson: body.bodyJson as unknown as Prisma.InputJsonValue }
          : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.print_forms.update",
      entity: "print_form",
      entityId: item.id,
      meta: { code: item.code },
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

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;
    const { id } = await ctx.params;
    const existing = await prisma.printForm.findFirst({
      where: { id, tenantId: session!.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json(
        { error: "Οι system φόρμες δεν διαγράφονται — απενεργοποιήστε τις" },
        { status: 400 },
      );
    }
    await prisma.printForm.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
