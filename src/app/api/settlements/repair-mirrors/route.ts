import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { repairCollapsedInvoicePaymentMirrors } from "@/modules/settlements/service";

export const dynamic = "force-dynamic";

/** One-shot repair for multi-tender receipts that only mirrored the primary method. */
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await repairCollapsedInvoicePaymentMirrors(
      prisma,
      session.tenantId,
    );
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "settlement.repair_payment_mirrors",
      entity: "settlement",
      meta: result,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Repair failed") },
      { status: 500 },
    );
  }
}
