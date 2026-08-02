import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { leaveBalanceAdjustmentSchema } from "@/modules/hr/schemas";
import { HrError } from "@/modules/hr/errors";
import {
  createLeaveBalanceAdjustment,
  listLeaveBalanceAdjustments,
} from "@/modules/hr/suite";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sp = request.nextUrl.searchParams;
    const year = Number(sp.get("year") || new Date().getFullYear());
    const employeeId = sp.get("employeeId") || undefined;
    const items = await listLeaveBalanceAdjustments(prisma, session.tenantId, {
      year,
      employeeId,
    });
    return NextResponse.json({
      items: items.map((a) => ({
        ...a,
        days: Number(a.days),
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
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
    const body = leaveBalanceAdjustmentSchema.parse(await request.json());
    const item = await createLeaveBalanceAdjustment(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "leave_balance_adjustment.create",
      entity: "leave_balance_adjustment",
      entityId: item.id,
      meta: {
        employeeId: item.employeeId,
        days: Number(item.days),
        year: item.year,
      },
    });
    return NextResponse.json(
      {
        item: {
          ...item,
          days: Number(item.days),
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
