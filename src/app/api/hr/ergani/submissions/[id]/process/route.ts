import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { HrError, processErganiSubmission } from "@/modules/hr/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const item = await processErganiSubmission(prisma, {
      tenantId: session.tenantId,
      id,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "ergani.process",
      entity: "ergani_submission",
      entityId: item.id,
      meta: { status: item.status, externalRef: item.externalRef },
    });
    return NextResponse.json({
      item: {
        id: item.id,
        status: item.status,
        externalRef: item.externalRef,
        eventKind: item.eventKind,
        attempts: item.attempts,
        lastError: item.lastError,
      },
    });
  } catch (error) {
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Process failed") },
      { status: 400 },
    );
  }
}
