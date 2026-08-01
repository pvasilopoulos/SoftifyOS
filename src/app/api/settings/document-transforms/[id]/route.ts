import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { transformRuleUpdateSchema } from "@/modules/document-transforms";
import { writeAuditEvent } from "@/platform/tenancy/audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await context.params;
    const existing = await prisma.documentTransformRule.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = transformRuleUpdateSchema.parse(await request.json());

    if (existing.isSystem) {
      // System rules: allow toggle/flags/series/name, not kind/handler/code swap
      const item = await prisma.documentTransformRule.update({
        where: { id },
        data: {
          name: body.name ?? undefined,
          description:
            body.description === undefined ? undefined : body.description,
          isActive: body.isActive ?? undefined,
          sortOrder: body.sortOrder ?? undefined,
          allowPartial: body.allowPartial ?? undefined,
          coverageMode: body.coverageMode ?? undefined,
          issueMode: body.issueMode ?? undefined,
          copyNotes: body.copyNotes ?? undefined,
          defaultSeriesId:
            body.defaultSeriesId === undefined
              ? undefined
              : body.defaultSeriesId,
        },
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "transform_rule.update",
        entity: "document_transform_rule",
        entityId: item.id,
        meta: { code: item.code },
      });
      return NextResponse.json({ item });
    }

    const item = await prisma.documentTransformRule.update({
      where: { id },
      data: {
        code: body.code?.toUpperCase(),
        name: body.name,
        description:
          body.description === undefined ? undefined : body.description,
        sourceKind: body.sourceKind,
        targetKind: body.targetKind,
        handlerKey: body.handlerKey,
        isActive: body.isActive,
        sortOrder: body.sortOrder,
        allowPartial: body.allowPartial,
        coverageMode: body.coverageMode,
        issueMode: body.issueMode,
        copyNotes: body.copyNotes,
        defaultSeriesId:
          body.defaultSeriesId === undefined
            ? undefined
            : body.defaultSeriesId,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "transform_rule.update",
      entity: "document_transform_rule",
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

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await context.params;
    const existing = await prisma.documentTransformRule.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json(
        { error: "Οι συστημικοί κανόνες δεν διαγράφονται — απενεργοποιήστε τους" },
        { status: 400 },
      );
    }
    await prisma.documentTransformRule.delete({ where: { id } });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "transform_rule.delete",
      entity: "document_transform_rule",
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
