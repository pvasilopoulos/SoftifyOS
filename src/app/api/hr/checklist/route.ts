import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { checklistItemCreateSchema } from "@/modules/hr/schemas";
import { HrError } from "@/modules/hr/errors";
import {
  createChecklistItem,
  listChecklistItems,
  seedOnboardingChecklist,
} from "@/modules/hr/suite";

export const dynamic = "force-dynamic";

function serialize(item: Awaited<ReturnType<typeof createChecklistItem>>) {
  return {
    ...item,
    dueDate: item.dueDate?.toISOString() ?? null,
    completedAt: item.completedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sp = request.nextUrl.searchParams;
    const items = await listChecklistItems(prisma, session.tenantId, {
      employeeId: sp.get("employeeId") || undefined,
      kind: sp.get("kind") || undefined,
      status: sp.get("status") || undefined,
    });
    return NextResponse.json({
      items: items.map((i) => ({
        ...i,
        dueDate: i.dueDate?.toISOString() ?? null,
        completedAt: i.completedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
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
    if (raw?.seed === true && raw.employeeId) {
      const items = await seedOnboardingChecklist(prisma, {
        tenantId: session.tenantId,
        employeeId: String(raw.employeeId),
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "checklist.seed_onboarding",
        entity: "employee",
        entityId: String(raw.employeeId),
        meta: { count: items.length },
      });
      return NextResponse.json(
        {
          items: items.map((i) => ({
            ...i,
            dueDate: i.dueDate?.toISOString() ?? null,
            completedAt: i.completedAt?.toISOString() ?? null,
            createdAt: i.createdAt.toISOString(),
            updatedAt: i.updatedAt.toISOString(),
          })),
        },
        { status: 201 },
      );
    }
    const body = checklistItemCreateSchema.parse(raw);
    const item = await createChecklistItem(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "checklist.create",
      entity: "employee_checklist_item",
      entityId: item.id,
      meta: { employeeId: item.employeeId, kind: item.kind },
    });
    return NextResponse.json({ item: serialize(item) }, { status: 201 });
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
