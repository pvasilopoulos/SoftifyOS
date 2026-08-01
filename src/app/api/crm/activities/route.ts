import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  leadId: z.string().trim().min(1).optional().nullable(),
  customerId: z.string().trim().min(1).optional().nullable(),
  kind: z.enum(["CALL", "EMAIL", "MEETING", "TASK", "NOTE"]).optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).optional().nullable(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customerId");
    const leadId = searchParams.get("leadId");
    const items = await prisma.crmActivity.findMany({
      where: {
        tenantId: session.tenantId,
        ...(customerId ? { customerId } : {}),
        ...(leadId ? { leadId } : {}),
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 100,
    });
    return NextResponse.json({
      items: items.map((a) => ({
        ...a,
        dueAt: a.dueAt?.toISOString() ?? null,
        doneAt: a.doneAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
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
    const body = createSchema.parse(await request.json());
    const item = await prisma.crmActivity.create({
      data: {
        tenantId: session.tenantId,
        leadId: body.leadId || null,
        customerId: body.customerId || null,
        kind: body.kind ?? "NOTE",
        title: body.title,
        body: body.body || null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
      },
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "crm.activity.create",
      entity: "crm_activity",
      entityId: item.id,
      meta: { title: item.title, kind: item.kind },
    });
    return NextResponse.json(
      {
        item: {
          ...item,
          dueAt: item.dueAt?.toISOString() ?? null,
          doneAt: item.doneAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
