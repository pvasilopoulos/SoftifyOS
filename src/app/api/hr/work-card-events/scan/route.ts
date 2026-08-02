import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { workCardScanSchema } from "@/modules/hr/schemas";
import { HrError, punchByWorkCardQr } from "@/modules/hr/service";

export const dynamic = "force-dynamic";

/** QR / κάρτα scan → check-in/out */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = workCardScanSchema.parse(await request.json());
    const result = await punchByWorkCardQr(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "work_card.scan",
      entity: "work_card_event",
      entityId: result.event.id,
      meta: {
        type: result.event.type,
        employeeId: result.employee.id,
        cardNumber: result.card.cardNumber,
        presenceAfter: result.presenceAfter,
      },
    });
    return NextResponse.json(
      {
        item: {
          ...result.event,
          occurredAt: result.event.occurredAt.toISOString(),
          createdAt: result.event.createdAt.toISOString(),
        },
        employee: result.employee,
        card: result.card,
        presenceAfter: result.presenceAfter,
        message: `${result.employee.lastName} ${result.employee.firstName} · ${result.event.type}`,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρο QR" }, { status: 400 });
    }
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Scan failed") },
      { status: 400 },
    );
  }
}
