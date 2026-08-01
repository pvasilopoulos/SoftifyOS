import { NextResponse } from "next/server";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { processPendingMyDataBatch } from "@/modules/mydata/service";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

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

    const items = await processPendingMyDataBatch(prisma, {
      tenantId: session.tenantId,
      limit: 25,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "mydata.process_batch",
      entity: "mydata_submission",
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
        mark: i.mark,
        entityNumber: i.entityNumber,
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
