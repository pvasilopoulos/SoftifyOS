import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  workScheduleAssignSchema,
  workScheduleUpsertSchema,
} from "@/modules/hr/schemas";
import {
  assignWorkSchedule,
  createWorkSchedule,
  HrError,
  listScheduleAssignments,
  listWorkSchedules,
} from "@/modules/hr/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") || "templates";
    if (kind === "assignments") {
      const items = await listScheduleAssignments(prisma, session.tenantId);
      return NextResponse.json({
        items: items.map((a) => ({
          ...a,
          fromDate: a.fromDate.toISOString(),
          toDate: a.toDate?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    }
    const items = await listWorkSchedules(prisma, session.tenantId);
    return NextResponse.json({
      items: items.map((s) => ({
        ...s,
        weeklyHours: Number(s.weeklyHours),
        assignmentCount: s._count.assignments,
        createdAt: s.createdAt.toISOString(),
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
    const raw = await request.json();
    if (raw?.action === "assign") {
      const body = workScheduleAssignSchema.parse(raw);
      const item = await assignWorkSchedule(prisma, {
        tenantId: session.tenantId,
        data: body,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "work_schedule.assign",
        entity: "work_schedule_assignment",
        entityId: item.id,
        meta: { employeeId: body.employeeId, scheduleId: body.scheduleId },
      });
      return NextResponse.json(
        {
          item: {
            ...item,
            fromDate: item.fromDate.toISOString(),
            toDate: item.toDate?.toISOString() ?? null,
          },
        },
        { status: 201 },
      );
    }
    const body = workScheduleUpsertSchema.parse(raw);
    const item = await createWorkSchedule(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "work_schedule.create",
      entity: "work_schedule",
      entityId: item.id,
      meta: { code: item.code },
    });
    return NextResponse.json(
      {
        item: {
          ...item,
          weeklyHours: Number(item.weeklyHours),
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
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
