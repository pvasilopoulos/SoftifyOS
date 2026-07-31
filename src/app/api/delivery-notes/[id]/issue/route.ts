import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { issueDeliveryNote } from "@/modules/delivery-notes/service";
import { enqueueMyDataSubmission } from "@/modules/mydata/service";

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

    const result = await prisma.$transaction(async (tx) =>
      issueDeliveryNote(tx, {
        tenantId: session.tenantId,
        deliveryNoteId: id,
        userId: session.sub,
      }),
    );

    const series = await prisma.documentSeries.findFirst({
      where: {
        tenantId: session.tenantId,
        id: result.note.seriesId ?? undefined,
      },
      select: {
        myDataEnabled: true,
        myDataInvoiceType: true,
        myDataVatCategory: true,
      },
    });

    let myDataId: string | null = null;
    if (series?.myDataEnabled) {
      const sub = await enqueueMyDataSubmission(prisma, {
        tenantId: session.tenantId,
        entityType: "delivery_note",
        entityId: result.note.id,
        entityNumber: result.note.number,
        invoiceType: series.myDataInvoiceType ?? "9.3",
        vatCategory: series.myDataVatCategory,
        payload: {
          number: result.note.number,
          customerId: result.note.customerId,
          lines: result.note.lines.map((l) => ({
            description: l.description,
            quantity: toNumber(l.quantity),
            productId: l.productId,
          })),
        },
      });
      myDataId = sub.id;
    }

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "delivery_note.issue",
      entity: "delivery_note",
      entityId: id,
      meta: {
        number: result.note.number,
        movements: result.movements.length,
        myDataId,
      },
    });

    return NextResponse.json({
      item: {
        id: result.note.id,
        number: result.note.number,
        status: result.note.status,
        issuedAt: result.note.issuedAt?.toISOString() ?? null,
        lines: result.note.lines.map((l) => ({
          ...l,
          quantity: toNumber(l.quantity),
        })),
        customer: result.note.customer,
        site: result.note.site,
      },
      movements: result.movements,
      myDataId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Issue failed") },
      { status: 400 },
    );
  }
}
