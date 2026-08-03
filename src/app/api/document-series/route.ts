import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  companyStamp,
  isCompanyScopeError,
  requireCompanyId,
} from "@/platform/tenancy/company-scope";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { documentKindSchema, seriesCreateSchema } from "@/modules/documents/schemas";
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

const listSchema = z.object({
  kind: documentKindSchema.optional(),
  siteId: z.string().optional(),
});

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

function mapSeriesItem(s: {
  paymentMethods: Parameters<typeof mapSeriesPaymentLinks>[0];
  printForms: Parameters<typeof mapSeriesPrintLinks>[0];
  prefix: string;
  padLength: number;
  nextNumber: number;
  lastYear: number | null;
  resetPolicy: "NEVER" | "YEARLY";
  [key: string]: unknown;
}) {
  const { paymentMethods: payLinks, printForms: formLinks, ...rest } = s;
  return {
    ...rest,
    previewNumber: previewNextNumber(s),
    ...mapSeriesPaymentLinks(payLinks),
    ...mapSeriesPrintLinks(formLinks),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const legalEntityId = requireCompanyId(session);
    const parsed = listSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    await Promise.all([
      ensurePaymentMethods(prisma, session.tenantId),
      ensureDefaultPrintForms(prisma, session.tenantId),
    ]);

    const items = await prisma.documentSeries.findMany({
      where: {
        tenantId: session.tenantId,
        legalEntityId,
        kind: parsed.data.kind,
        siteId: parsed.data.siteId,
      },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      include: {
        site: { select: { id: true, code: true, name: true, kind: true } },
        ...seriesInclude,
      },
    });

    return NextResponse.json({
      items: items.map((s) => mapSeriesItem(s)),
    });
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "List failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const legalEntityId = requireCompanyId(session);

    const body = seriesCreateSchema.parse(await request.json());
    if (body.siteId) {
      const site = await prisma.site.findFirst({
        where: { id: body.siteId, tenantId: session.tenantId },
      });
      if (!site) {
        return NextResponse.json({ error: "Μη έγκυρο site" }, { status: 400 });
      }
    }

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
            kind: body.kind,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }
      const created = await tx.documentSeries.create({
        data: {
          tenantId: session.tenantId,
          ...companyStamp(session),
          code: body.code,
          name: body.name,
          kind: body.kind,
          prefix: body.prefix,
          padLength: body.padLength ?? 5,
          nextNumber: body.nextNumber ?? 1,
          lastYear: new Date().getFullYear(),
          resetPolicy: body.resetPolicy ?? "YEARLY",
          siteId: body.siteId || null,
          affectsCustomer: body.affectsCustomer ?? "NONE",
          affectsInventory: body.affectsInventory ?? "NONE",
          allowPartial: body.allowPartial ?? false,
          editableAfterIssue: body.editableAfterIssue ?? false,
          myDataEnabled: body.myDataEnabled ?? false,
          myDataInvoiceType: body.myDataInvoiceType || null,
          myDataVatCategory: body.myDataVatCategory || null,
          glDebitAccount: body.glDebitAccount || null,
          glCreditAccount: body.glCreditAccount || null,
          glVatAccount: body.glVatAccount || null,
          allowPartialSettlement: body.allowPartialSettlement ?? "YES",
          allowOverpayment: body.allowOverpayment ?? "NO",
          allowMultiTender: body.allowMultiTender ?? true,
          maxTenderLines: body.maxTenderLines ?? 10,
          allowMultiDocumentSettlement:
            body.allowMultiDocumentSettlement ?? false,
          allowCreditNoteOffset: body.allowCreditNoteOffset ?? true,
          allowOnAccount: body.allowOnAccount ?? "NO",
          allowWriteOff: body.allowWriteOff ?? "NO",
          writeOffMaxAmount: body.writeOffMaxAmount ?? 0,
          settlementTolerance: body.settlementTolerance ?? 0.01,
          allowCashChange: body.allowCashChange ?? true,
          allowGiftCardTender: body.allowGiftCardTender ?? true,
          allowLoyaltyTender: body.allowLoyaltyTender ?? true,
          requireExternalRef: body.requireExternalRef ?? false,
          cardClearingPolicy:
            body.cardClearingPolicy ??
            body.settlementClearingMode ??
            "NO",
          settlementValueDateMode:
            body.settlementValueDateMode ?? "PAYMENT_DATE",
          autoPostSettlementJournal: body.autoPostSettlementJournal ?? "AUTO",
          allowVoidSettlement: body.allowVoidSettlement ?? "YES",
          allowBankMatch: body.allowBankMatch ?? "YES",
          autoSettleOnIssue: body.autoSettleOnIssue ?? "NO",
          printCopies: body.printCopies ?? 1,
          printPrinter: body.printPrinter ?? null,
          isDefault: body.isDefault ?? false,
          isActive: body.isActive ?? true,
        },
      });

      if (body.allowedPaymentMethodIds !== undefined) {
        await syncSeriesPaymentMethods(tx, {
          tenantId: session.tenantId,
          seriesId: created.id,
          paymentMethodIds: body.allowedPaymentMethodIds,
          defaultPaymentMethodId: body.defaultPaymentMethodId,
        });
      }

      if (body.allowedPrintFormIds !== undefined) {
        await syncSeriesPrintForms(tx, {
          tenantId: session.tenantId,
          seriesId: created.id,
          printFormIds: body.allowedPrintFormIds,
          defaultPrintFormId: body.defaultPrintFormId,
        });
      }

      return tx.documentSeries.findUniqueOrThrow({
        where: { id: created.id },
        include: seriesInclude,
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "series.create",
      entity: "document_series",
      entityId: item.id,
      meta: {
        code: item.code,
        kind: item.kind,
        paymentMethods: item.paymentMethods.length,
        printForms: item.printForms.length,
      },
    });

    return NextResponse.json({ item: mapSeriesItem(item) }, { status: 201 });
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ο κωδικός σειράς υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
