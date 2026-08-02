import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { SettlementError, voidSettlement } from "@/modules/settlements/service";

export const dynamic = "force-dynamic";

/** Unmatch bank line: void linked settlement (if any) and reset status. */
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
    const line = await prisma.bankStatementLine.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!line) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (line.status === "UNMATCHED") {
      return NextResponse.json({ item: { id: line.id, status: line.status } });
    }

    const linked = await prisma.settlement.findFirst({
      where: {
        tenantId: session.tenantId,
        bankStatementLineId: line.id,
        status: "POSTED",
      },
      select: { id: true, number: true },
    });

    let voidedSettlementId: string | null = null;
    if (linked) {
      await voidSettlement(prisma, {
        tenantId: session.tenantId,
        id: linked.id,
        userId: session.sub,
      });
      voidedSettlementId = linked.id;
    }

    const updated = await prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: "UNMATCHED",
        matchedInvoiceId: null,
        matchedPurchaseInvoiceId: null,
        matchNote: linked
          ? `Unmatch · ακυρώθηκε ${linked.number}`
          : "Unmatch",
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "banking.unmatch",
      entity: "bank_statement_line",
      entityId: line.id,
      meta: { voidedSettlementId },
    });

    return NextResponse.json({
      item: {
        id: updated.id,
        status: updated.status,
        voidedSettlementId,
      },
    });
  } catch (error) {
    if (error instanceof SettlementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Unmatch failed") },
      { status: 400 },
    );
  }
}
