import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { tryPostInvoiceIssue } from "@/modules/ledger/service";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
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
    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        tenantId: session.tenantId,
        ...(session.legalEntityId
          ? { legalEntityId: session.legalEntityId }
          : {}),
      },
      include: {
        series: {
          select: {
            glDebitAccount: true,
            glCreditAccount: true,
            glVatAccount: true,
            affectsInventory: true,
            siteId: true,
            myDataEnabled: true,
            myDataInvoiceType: true,
            myDataVatCategory: true,
            printCopies: true,
            printPrinter: true,
            autoSettleOnIssue: true,
          },
        },
        lines: {
          select: {
            productId: true,
            quantity: true,
            description: true,
          },
        },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (invoice.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Μόνο πρόχειρα τιμολόγια εκδίδονται" },
        { status: 400 },
      );
    }

    const { dispatchScriptEvent } = await import("@/modules/scripts/service");
    const { scriptActorFromSession } = await import(
      "@/modules/scripts/actor"
    );

    const issueRecord: Record<string, unknown> = {
      id: invoice.id,
      number: invoice.number,
      kind: invoice.kind,
      status: invoice.status,
      customerId: invoice.customerId,
      total: toNumber(invoice.total),
      vatAmount: toNumber(invoice.vatAmount),
      notes: invoice.notes,
    };

    const before = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "INVOICES",
      eventKey: "invoice.beforeIssue",
      record: issueRecord,
      user: scriptActorFromSession(session),
    });
    if (before.failed) {
      return NextResponse.json(
        { error: before.failed.message, script: before.failed.scriptCode },
        { status: 400 },
      );
    }

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "ISSUED",
        issuedAt: invoice.issuedAt ?? new Date(),
      },
    });

    let journalId: string | null = null;
    let cogsJournalId: string | null = null;
    try {
      const journal = await tryPostInvoiceIssue(prisma, {
        tenantId: session.tenantId,
        invoiceId: invoice.id,
        invoiceNumber: updated.number,
        total: toNumber(updated.total),
        vatAmount: toNumber(updated.vatAmount),
        glDebitAccount: invoice.series?.glDebitAccount,
        glCreditAccount: invoice.series?.glCreditAccount,
        glVatAccount: invoice.series?.glVatAccount,
        userId: session.sub,
        legalEntityId: invoice.legalEntityId ?? session.legalEntityId,
      });
      journalId = journal?.id ?? null;
    } catch {
      // Issue succeeds even if GL posting cannot resolve accounts / balance
      journalId = null;
    }

    let stockMeta: {
      applied: number;
      skipped: number;
      movements: string[];
      siteId?: string;
    } | null = null;
    const inventoryEffect = invoice.series?.affectsInventory ?? "NONE";
    try {
      const { applyInvoiceInventoryEffect } = await import(
        "@/modules/inventory/service"
      );
      stockMeta = await applyInvoiceInventoryEffect(prisma, {
        tenantId: session.tenantId,
        invoiceId: invoice.id,
        invoiceNumber: updated.number,
        siteId: invoice.siteId ?? invoice.series?.siteId,
        effect: inventoryEffect,
        lines: invoice.lines.map((l) => ({
          productId: l.productId,
          quantity: toNumber(l.quantity),
          description: l.description,
        })),
        userId: session.sub,
        allowNegative: true,
      });
    } catch {
      stockMeta = null;
    }

    if (inventoryEffect === "OUT") {
      try {
        const { tryPostCogsForInvoice } = await import(
          "@/modules/ledger/service"
        );
        const cogs = await tryPostCogsForInvoice(prisma, {
          tenantId: session.tenantId,
          invoiceId: invoice.id,
          invoiceNumber: updated.number,
          lines: invoice.lines.map((l) => ({
            productId: l.productId,
            quantity: toNumber(l.quantity),
          })),
          userId: session.sub,
        });
        cogsJournalId = cogs?.id ?? null;
      } catch {
        cogsJournalId = null;
      }
    }

    let myDataId: string | null = null;
    if (invoice.series?.myDataEnabled) {
      try {
        const { enqueueMyDataSubmission } = await import(
          "@/modules/mydata/service"
        );
        const sub = await enqueueMyDataSubmission(prisma, {
          tenantId: session.tenantId,
          entityType: "invoice",
          entityId: invoice.id,
          entityNumber: updated.number,
          invoiceType: invoice.series.myDataInvoiceType,
          vatCategory: invoice.series.myDataVatCategory,
          payload: {
            number: updated.number,
            kind: invoice.kind,
            customerId: invoice.customerId,
            total: toNumber(updated.total),
            vatAmount: toNumber(updated.vatAmount),
          },
        });
        myDataId = sub.id;
      } catch {
        myDataId = null;
      }
    }

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.issue",
      entity: "invoice",
      entityId: invoice.id,
      meta: {
        number: updated.number,
        journalId,
        cogsJournalId,
        stock: stockMeta,
        myDataId,
      },
    });

    const after = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "INVOICES",
      eventKey: "invoice.afterIssue",
      record: {
        id: updated.id,
        number: updated.number,
        kind: updated.kind,
        status: updated.status,
        customerId: updated.customerId,
        total: toNumber(updated.total),
        vatAmount: toNumber(updated.vatAmount),
        issuedAt: updated.issuedAt?.toISOString() ?? null,
        journalId,
        cogsJournalId,
        myDataId,
      },
      previous: issueRecord,
      user: scriptActorFromSession(session),
    });

    const print = {
      copies: invoice.series?.printCopies ?? 1,
      printer: invoice.series?.printPrinter ?? null,
    };

    const { tryAutoSettleOnIssue } = await import(
      "@/modules/settlements/service"
    );
    const autoSettle = await tryAutoSettleOnIssue(prisma, {
      tenantId: session.tenantId,
      userId: session.sub,
      legalEntityId: invoice.legalEntityId ?? session.legalEntityId,
      invoiceId: updated.id,
      seriesId: invoice.seriesId,
      autoSettleOnIssue: invoice.series?.autoSettleOnIssue,
    });

    if (autoSettle.settled) {
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "invoice.autoSettle",
        entity: "invoice",
        entityId: updated.id,
        meta: {
          settlementId: autoSettle.settlementId,
          settlementNumber: autoSettle.settlementNumber,
          paymentMethodCode: autoSettle.paymentMethodCode,
        },
      });
    }

    const refreshed = await prisma.invoice.findFirst({
      where: { id: updated.id },
      select: { status: true, paidAmount: true },
    });

    const warnings = [
      after.failed?.message,
      autoSettle.warning,
    ].filter(Boolean) as string[];

    return NextResponse.json({
      item: {
        id: updated.id,
        status: refreshed?.status ?? updated.status,
        paidAmount: refreshed ? toNumber(refreshed.paidAmount) : 0,
        journalId,
        cogsJournalId,
        stock: stockMeta,
        myDataId,
        print,
        autoSettle: autoSettle.settled
          ? {
              settlementId: autoSettle.settlementId,
              settlementNumber: autoSettle.settlementNumber,
              paymentMethodCode: autoSettle.paymentMethodCode,
            }
          : null,
      },
      ...(warnings.length
        ? { warning: warnings.join(" · ") }
        : {}),
      ...(after.failed ? { script: after.failed.scriptCode } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Issue failed") },
      { status: 400 },
    );
  }
}
