import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { employeeUpsertSchema } from "@/modules/hr/schemas";
import {
  createEmployee,
  HrError,
  listEmployees,
  serializeEmployee,
} from "@/modules/hr/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const q = request.nextUrl.searchParams.get("q")?.trim() || undefined;
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const items = await listEmployees(prisma, session.tenantId, { q, status });
    return NextResponse.json({ items: items.map(serializeEmployee) });
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
    const body = employeeUpsertSchema.parse(await request.json());
    const item = await createEmployee(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "employee.create",
      entity: "employee",
      entityId: item.id,
      meta: { code: item.code },
    });
    return NextResponse.json(
      { item: serializeEmployee({ ...item, site: null }) },
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
