import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  buildDeliveryNoteInvoicesDocXml,
  buildInvoiceInvoicesDocXml,
  buildPurchaseInvoiceInvoicesDocXml,
} from "@/modules/mydata/payload";

export const dynamic = "force-dynamic";

/** Preview request XML for a queue item (no AADE call). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await context.params;
    const row = await prisma.myDataSubmission.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!row) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    let xml: string;
    if (row.entityType === "invoice") {
      xml = await buildInvoiceInvoicesDocXml(prisma, {
        tenantId: session.tenantId,
        invoiceId: row.entityId,
        invoiceType: row.invoiceType,
        vatCategory: row.vatCategory,
      });
    } else if (
      row.entityType === "delivery_note" ||
      row.entityType === "deliveryNote"
    ) {
      xml = await buildDeliveryNoteInvoicesDocXml(prisma, {
        tenantId: session.tenantId,
        deliveryNoteId: row.entityId,
        invoiceType: row.invoiceType,
      });
    } else if (
      row.entityType === "purchase_invoice" ||
      row.entityType === "purchaseInvoice"
    ) {
      xml = await buildPurchaseInvoiceInvoicesDocXml(prisma, {
        tenantId: session.tenantId,
        purchaseInvoiceId: row.entityId,
        invoiceType: row.invoiceType,
        vatCategory: row.vatCategory,
      });
    } else {
      return NextResponse.json(
        { error: `Μη υποστηριζόμενο entityType=${row.entityType}` },
        { status: 400 },
      );
    }

    const cached =
      row.payload &&
      typeof row.payload === "object" &&
      !Array.isArray(row.payload) &&
      typeof (row.payload as { requestXml?: unknown }).requestXml === "string"
        ? (row.payload as { requestXml: string }).requestXml
        : null;

    return NextResponse.json({
      item: {
        id: row.id,
        entityType: row.entityType,
        entityNumber: row.entityNumber,
        invoiceType: row.invoiceType,
        status: row.status,
        xml,
        cachedRequestXml: cached,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Preview failed") },
      { status: 400 },
    );
  }
}
