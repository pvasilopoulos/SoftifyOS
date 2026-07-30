import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { seriesUpdateSchema } from "@/modules/documents/schemas";
import { previewNextNumber } from "@/modules/documents/series";

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
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const existing = await prisma.documentSeries.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = seriesUpdateSchema.parse(await request.json());
    const kind = body.kind ?? existing.kind;

    const item = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.documentSeries.updateMany({
          where: {
            tenantId: session.tenantId,
            kind,
            isDefault: true,
            NOT: { id },
          },
          data: { isDefault: false },
        });
      }
      return tx.documentSeries.update({
        where: { id },
        data: {
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.prefix !== undefined ? { prefix: body.prefix } : {}),
          ...(body.padLength !== undefined ? { padLength: body.padLength } : {}),
          ...(body.nextNumber !== undefined ? { nextNumber: body.nextNumber } : {}),
          ...(body.resetPolicy !== undefined ? { resetPolicy: body.resetPolicy } : {}),
          ...(body.siteId !== undefined ? { siteId: body.siteId || null } : {}),
          ...(body.affectsCustomer !== undefined
            ? { affectsCustomer: body.affectsCustomer }
            : {}),
          ...(body.affectsInventory !== undefined
            ? { affectsInventory: body.affectsInventory }
            : {}),
          ...(body.allowPartial !== undefined ? { allowPartial: body.allowPartial } : {}),
          ...(body.editableAfterIssue !== undefined
            ? { editableAfterIssue: body.editableAfterIssue }
            : {}),
          ...(body.myDataEnabled !== undefined ? { myDataEnabled: body.myDataEnabled } : {}),
          ...(body.myDataInvoiceType !== undefined
            ? { myDataInvoiceType: body.myDataInvoiceType || null }
            : {}),
          ...(body.myDataVatCategory !== undefined
            ? { myDataVatCategory: body.myDataVatCategory || null }
            : {}),
          ...(body.glDebitAccount !== undefined
            ? { glDebitAccount: body.glDebitAccount || null }
            : {}),
          ...(body.glCreditAccount !== undefined
            ? { glCreditAccount: body.glCreditAccount || null }
            : {}),
          ...(body.glVatAccount !== undefined
            ? { glVatAccount: body.glVatAccount || null }
            : {}),
          ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "series.update",
      entity: "document_series",
      entityId: item.id,
      meta: { code: item.code },
    });

    return NextResponse.json({
      item: { ...item, previewNumber: previewNextNumber(item) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
