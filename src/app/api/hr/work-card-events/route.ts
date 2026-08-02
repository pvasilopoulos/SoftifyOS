import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { workCardEventCreateSchema } from "@/modules/hr/schemas";
import {
  createWorkCardEvent,
  HrError,
  listWorkCardEvents,
} from "@/modules/hr/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const day = request.nextUrl.searchParams.get("day");
    const items = await listWorkCardEvents(prisma, session.tenantId, {
      day: day === "today" ? "today" : "all",
      take: day === "today" ? 500 : 200,
    });
    return NextResponse.json({
      items: items.map((e) => ({
        ...e,
        occurredAt: e.occurredAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
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
    const body = workCardEventCreateSchema.parse(await request.json());
    const item = await createWorkCardEvent(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "work_card_event.create",
      entity: "work_card_event",
      entityId: item.id,
      meta: { type: item.type, employeeId: item.employeeId },
    });
    return NextResponse.json(
      {
        item: {
          ...item,
          occurredAt: item.occurredAt.toISOString(),
          createdAt: item.createdAt.toISOString(),
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
