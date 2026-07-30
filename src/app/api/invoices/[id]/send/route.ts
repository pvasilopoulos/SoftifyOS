import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber, type InvoiceStatusKey } from "@/modules/sales/invoice-utils";

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
      where: { id, tenantId: session.tenantId },
      include: { customer: { select: { email: true, name: true } } },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const status = invoice.status as InvoiceStatusKey;
    if (status === "CANCELLED") {
      return NextResponse.json(
        { error: "Δεν μπορείτε να στείλετε ακυρωμένο τιμολόγιο" },
        { status: 400 },
      );
    }

    const promote = status === "DRAFT";
    const updated = promote
      ? await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "ISSUED",
            issuedAt: invoice.issuedAt ?? new Date(),
          },
        })
      : invoice;

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.send",
      entity: "invoice",
      entityId: invoice.id,
      meta: {
        number: invoice.number,
        to: invoice.customer.email,
        promotedFromDraft: promote,
        status: updated.status,
      },
    });

    return NextResponse.json({
      item: {
        id: updated.id,
        number: updated.number,
        status: updated.status,
        issuedAt: updated.issuedAt?.toISOString() ?? null,
        total: toNumber(updated.total),
        customerEmail: invoice.customer.email,
        customerName: invoice.customer.name,
        message: invoice.customer.email
          ? `Καταχωρήθηκε αποστολή προς ${invoice.customer.email}`
          : `Καταχωρήθηκε αποστολή προς ${invoice.customer.name} (χωρίς email)`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Send failed") },
      { status: 400 },
    );
  }
}
