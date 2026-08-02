import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  isCompanyScopeError,
  requireCompanyId,
} from "@/platform/tenancy/company-scope";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { seriesUpdateSchema } from "@/modules/documents/schemas";
import { previewNextNumber } from "@/modules/documents/series";
import {
  mapSeriesPaymentLinks,
  syncSeriesPaymentMethods,
} from "@/modules/documents/series-payments";
import { ensurePaymentMethods } from "@/modules/payments/service";
import {
  ensureDefaultPrintForms,
  mapSeriesPrintLinks,
  syncSeriesPrintForms,
} from "@/modules/print-forms/service";

export const dynamic = "force-dynamic";

const seriesInclude = {
  paymentMethods: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      paymentMethod: {
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          isActive: true,
        },
      },
    },
  },
  printForms: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      printForm: {
        select: {
          id: true,
          code: true,
          name: true,
          documentKind: true,
          isActive: true,
        },
      },
    },
  },
};

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
    const legalEntityId = requireCompanyId(session);

    const { id } = await context.params;
    const existing = await prisma.documentSeries.findFirst({
      where: { id, tenantId: session.tenantId, legalEntityId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = seriesUpdateSchema.parse(await request.json());
    const kind = body.kind ?? existing.kind;
    await Promise.all([
      ensurePaymentMethods(prisma, session.tenantId),
      ensureDefaultPrintForms(prisma, session.tenantId),
    ]);

    const item = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.documentSeries.updateMany({
          where: {
            tenantId: session.tenantId,
            legalEntityId,
            kind,
            isDefault: true,
            NOT: { id },
          },
          data: { isDefault: false },
        });
      }
      await tx.documentSeries.update({
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
          ...(body.allowPartialSettlement !== undefined
            ? { allowPartialSettlement: body.allowPartialSettlement }
            : {}),
          ...(body.allowMultiTender !== undefined
            ? { allowMultiTender: body.allowMultiTender }
            : {}),
          ...(body.allowMultiDocumentSettlement !== undefined
            ? {
                allowMultiDocumentSettlement: body.allowMultiDocumentSettlement,
              }
            : {}),
          ...(body.allowOnAccount !== undefined
            ? { allowOnAccount: body.allowOnAccount }
            : {}),
          ...(body.settlementClearingMode !== undefined
            ? { settlementClearingMode: body.settlementClearingMode }
            : {}),
          ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });

      if (body.allowedPaymentMethodIds !== undefined) {
        await syncSeriesPaymentMethods(tx, {
          tenantId: session.tenantId,
          seriesId: id,
          paymentMethodIds: body.allowedPaymentMethodIds,
          defaultPaymentMethodId: body.defaultPaymentMethodId,
        });
      }

      if (body.allowedPrintFormIds !== undefined) {
        await syncSeriesPrintForms(tx, {
          tenantId: session.tenantId,
          seriesId: id,
          printFormIds: body.allowedPrintFormIds,
          defaultPrintFormId: body.defaultPrintFormId,
        });
      }

      return tx.documentSeries.findUniqueOrThrow({
        where: { id },
        include: seriesInclude,
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "series.update",
      entity: "document_series",
      entityId: item.id,
      meta: {
        code: item.code,
        paymentMethods: item.paymentMethods.length,
        printForms: item.printForms.length,
      },
    });

    const { paymentMethods: payLinks, printForms: formLinks, ...rest } = item;
    return NextResponse.json({
      item: {
        ...rest,
        previewNumber: previewNextNumber(item),
        ...mapSeriesPaymentLinks(payLinks),
        ...mapSeriesPrintLinks(formLinks),
      },
    });
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
