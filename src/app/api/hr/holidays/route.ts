import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { companyHolidaySchema } from "@/modules/hr/schemas";
import { HrError } from "@/modules/hr/errors";
import {
  createCompanyHoliday,
  deleteCompanyHoliday,
  listCompanyHolidays,
} from "@/modules/hr/suite";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const year = Number(
      request.nextUrl.searchParams.get("year") || new Date().getFullYear(),
    );
    const items = await listCompanyHolidays(prisma, session.tenantId, { year });
    return NextResponse.json({
      items: items.map((h) => ({
        ...h,
        date: h.date.toISOString(),
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
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
    const body = companyHolidaySchema.parse(await request.json());
    const item = await createCompanyHoliday(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "company_holiday.create",
      entity: "company_holiday",
      entityId: item.id,
      meta: { name: item.name, date: item.date.toISOString() },
    });
    return NextResponse.json(
      {
        item: {
          ...item,
          date: item.date.toISOString(),
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

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Λείπει id" }, { status: 400 });
    }
    await deleteCompanyHoliday(prisma, { tenantId: session.tenantId, id });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "company_holiday.delete",
      entity: "company_holiday",
      entityId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
