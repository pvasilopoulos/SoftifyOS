import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { leaveRequestCreateSchema } from "@/modules/hr/schemas";
import {
  createLeaveRequest,
  HrError,
  listLeaveRequests,
} from "@/modules/hr/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const items = await listLeaveRequests(prisma, session.tenantId, { status });
    return NextResponse.json({
      items: items.map((r) => ({
        ...r,
        days: Number(r.days),
        fromDate: r.fromDate.toISOString(),
        toDate: r.toDate.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = leaveRequestCreateSchema.parse(await request.json());
    const item = await createLeaveRequest(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "leave_request.create",
      entity: "leave_request",
      entityId: item.id,
      meta: { employeeId: item.employeeId, leaveTypeId: item.leaveTypeId },
    });
    return NextResponse.json(
      {
        item: {
          ...item,
          days: Number(item.days),
          fromDate: item.fromDate.toISOString(),
          toDate: item.toDate.toISOString(),
          decidedAt: item.decidedAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
