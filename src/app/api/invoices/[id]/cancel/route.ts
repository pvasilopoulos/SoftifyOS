import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
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
      where: { id, tenantId: session.tenantId },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (invoice.status === "CANCELLED") {
      return NextResponse.json({ error: "Ήδη ακυρωμένο" }, { status: 400 });
    }
    if (toNumber(invoice.paidAmount) > 0) {
      return NextResponse.json(
        { error: "Υπάρχουν εισπράξεις — ακυρώστε μέσω πιστωτικού" },
        { status: 400 },
      );
    }

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "CANCELLED" },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.cancel",
      entity: "invoice",
      entityId: invoice.id,
      meta: { number: updated.number, from: invoice.status },
    });

    return NextResponse.json({
      item: { id: updated.id, status: updated.status },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Cancel failed") },
      { status: 400 },
    );
  }
}
