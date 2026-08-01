import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  closePayrollPeriod,
  getPayrollPeriod,
  HrError,
} from "@/modules/hr/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const item = await getPayrollPeriod(prisma, session.tenantId, id);
    if (!item) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    return NextResponse.json({
      item: {
        id: item.id,
        code: item.code,
        year: item.year,
        month: item.month,
        status: item.status,
        fromDate: item.fromDate.toISOString(),
        toDate: item.toDate.toISOString(),
        notes: item.notes,
        lines: item.lines.map((l) => ({
          id: l.id,
          employeeId: l.employeeId,
          employee: l.employee,
          gross: Number(l.gross),
          employeeEfka: Number(l.employeeEfka),
          employerEfka: Number(l.employerEfka),
          tax: Number(l.tax),
          net: Number(l.net),
          notes: l.notes,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

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
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
    };
    if (body.action !== "close") {
      return NextResponse.json({ error: "Άγνωστη ενέργεια" }, { status: 400 });
    }
    const item = await closePayrollPeriod(prisma, {
      tenantId: session.tenantId,
      id,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "payroll_period.close",
      entity: "payroll_period",
      entityId: item.id,
      meta: { code: item.code },
    });
    return NextResponse.json({
      item: { id: item.id, code: item.code, status: item.status },
    });
  } catch (error) {
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Close failed") },
      { status: 400 },
    );
  }
}
