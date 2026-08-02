import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { purchaseInvoiceCreateSchema } from "@/modules/ledger/schemas";
import {
  createPurchaseInvoice,
  listPurchaseInvoices,
} from "@/modules/ledger/purchase-invoices";
import { ensureChartOfAccounts, LedgerError } from "@/modules/ledger/service";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  CompanyScopeError,
  requireCompanyId,
} from "@/platform/tenancy/company-scope";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const legalEntityId = requireCompanyId(session);
    const items = await listPurchaseInvoices(prisma, session.tenantId, {
      legalEntityId,
    });
    return NextResponse.json({
      items: items.map((inv) => ({
        ...inv,
        netAmount: toNumber(inv.netAmount),
        vatAmount: toNumber(inv.vatAmount),
        total: toNumber(inv.total),
        paidAmount: toNumber(inv.paidAmount),
        lines: inv.lines.map((l) => ({
          ...l,
          qty: toNumber(l.qty),
          unitPrice: toNumber(l.unitPrice),
          vatRate: toNumber(l.vatRate),
          netAmount: toNumber(l.netAmount),
          vatAmount: toNumber(l.vatAmount),
        })),
      })),
    });
  } catch (error) {
    if (error instanceof CompanyScopeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
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
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const legalEntityId = requireCompanyId(session);
    await ensureChartOfAccounts(prisma, session.tenantId);
    const body = purchaseInvoiceCreateSchema.parse(await request.json());
    const { invoice, journalId } = await createPurchaseInvoice(prisma, {
      tenantId: session.tenantId,
      ...body,
      legalEntityId: body.legalEntityId ?? legalEntityId,
      userId: session.sub,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "finance.purchase_invoice.create",
      entity: "purchase_invoice",
      entityId: invoice.id,
      meta: { number: invoice.number, journalId },
    });
    return NextResponse.json(
      {
        item: {
          ...invoice,
          netAmount: toNumber(invoice.netAmount),
          vatAmount: toNumber(invoice.vatAmount),
          total: toNumber(invoice.total),
        },
        journalId,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
