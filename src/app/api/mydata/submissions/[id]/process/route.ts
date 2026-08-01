import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { processMyDataSubmission } from "@/modules/mydata/service";

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
    const item = await processMyDataSubmission(prisma, {
      tenantId: session.tenantId,
      id,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "mydata.process",
      entity: "mydata_submission",
      entityId: item.id,
      meta: { status: item.status, mark: item.mark },
    });
    return NextResponse.json({
      item: {
        ...item,
        lastAttemptAt: item.lastAttemptAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Process failed") },
      { status: 400 },
    );
  }
}
