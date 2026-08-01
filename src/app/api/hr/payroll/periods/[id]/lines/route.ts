import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { payrollLineUpsertSchema } from "@/modules/hr/schemas";
import { HrError, upsertPayrollLine } from "@/modules/hr/service";

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
    const { id: periodId } = await ctx.params;
    const body = payrollLineUpsertSchema.parse(await request.json());
    const item = await upsertPayrollLine(prisma, {
      tenantId: session.tenantId,
      periodId,
      employeeId: body.employeeId,
      gross: body.gross,
      notes: body.notes,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "payroll_line.upsert",
      entity: "payroll_line",
      entityId: item.id,
      meta: { periodId, employeeId: body.employeeId, gross: body.gross },
    });
    return NextResponse.json({
      item: {
        id: item.id,
        employeeId: item.employeeId,
        employee: item.employee,
        gross: Number(item.gross),
        employeeEfka: Number(item.employeeEfka),
        employerEfka: Number(item.employerEfka),
        tax: Number(item.tax),
        net: Number(item.net),
        notes: item.notes,
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
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
