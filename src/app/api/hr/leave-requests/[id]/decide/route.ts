import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { leaveRequestDecideSchema } from "@/modules/hr/schemas";
import { decideLeaveRequest, HrError } from "@/modules/hr/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const body = leaveRequestDecideSchema.parse(await request.json());
    const item = await decideLeaveRequest(prisma, {
      tenantId: session.tenantId,
      id,
      status: body.status,
      notes: body.notes,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "leave_request.decide",
      entity: "leave_request",
      entityId: item.id,
      meta: { status: item.status },
    });
    return NextResponse.json({
      item: {
        ...item,
        days: Number(item.days),
        fromDate: item.fromDate.toISOString(),
        toDate: item.toDate.toISOString(),
        decidedAt: item.decidedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Decide failed") },
      { status: 400 },
    );
  }
}
