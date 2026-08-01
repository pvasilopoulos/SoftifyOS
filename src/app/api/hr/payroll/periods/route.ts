import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { payrollPeriodCreateSchema } from "@/modules/hr/schemas";
import {
  createPayrollPeriod,
  HrError,
  listPayrollPeriods,
} from "@/modules/hr/service";

export const dynamic = "force-dynamic";

function money(v: { toString(): string } | number) {
  return Number(v);
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const items = await listPayrollPeriods(prisma, session.tenantId);
    return NextResponse.json({
      items: items.map((p) => {
        const totals = p.lines.reduce(
          (acc, l) => {
            acc.gross += money(l.gross);
            acc.net += money(l.net);
            acc.employeeEfka += money(l.employeeEfka);
            acc.employerEfka += money(l.employerEfka);
            acc.tax += money(l.tax);
            return acc;
          },
          { gross: 0, net: 0, employeeEfka: 0, employerEfka: 0, tax: 0 },
        );
        return {
          id: p.id,
          code: p.code,
          year: p.year,
          month: p.month,
          status: p.status,
          fromDate: p.fromDate.toISOString(),
          toDate: p.toDate.toISOString(),
          notes: p.notes,
          lineCount: p._count.lines,
          totals,
          createdAt: p.createdAt.toISOString(),
        };
      }),
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
    const body = payrollPeriodCreateSchema.parse(await request.json());
    const item = await createPayrollPeriod(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "payroll_period.create",
      entity: "payroll_period",
      entityId: item.id,
      meta: { code: item.code, lines: item.lines.length },
    });
    return NextResponse.json(
      {
        item: {
          id: item.id,
          code: item.code,
          year: item.year,
          month: item.month,
          status: item.status,
          lineCount: item.lines.length,
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
