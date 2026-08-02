import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { cancelMyDataSubmission } from "@/modules/mydata/service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const item = await cancelMyDataSubmission(prisma, {
      tenantId: session.tenantId,
      id,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "mydata.cancel",
      entity: "mydata_submission",
      entityId: item.id,
      meta: { mark: item.mark, status: item.status },
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Cancel failed") },
      { status: 400 },
    );
  }
}
