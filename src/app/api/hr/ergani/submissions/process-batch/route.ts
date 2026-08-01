import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { processPendingErganiBatch } from "@/modules/hr/service";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const items = await processPendingErganiBatch(prisma, {
      tenantId: session.tenantId,
      limit: 25,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "ergani.process_batch",
      entity: "ergani_submission",
      meta: {
        count: items.length,
        accepted: items.filter((i) => i.status === "ACCEPTED").length,
        rejected: items.filter((i) => i.status === "REJECTED").length,
      },
    });

    return NextResponse.json({
      items: items.map((i) => ({
        id: i.id,
        status: i.status,
        externalRef: i.externalRef,
        eventKind: i.eventKind,
      })),
      processed: items.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Batch failed") },
      { status: 400 },
    );
  }
}
