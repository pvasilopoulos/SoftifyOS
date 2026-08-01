import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).optional().nullable(),
  contactName: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  status: z
    .enum(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"])
    .optional(),
  value: z.coerce.number().nonnegative().max(10_000_000).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  customerId: z.string().trim().min(1).optional().nullable(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const leads = await prisma.crmLead.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { _count: { select: { activities: true } } },
    });
    return NextResponse.json({
      items: leads.map((l) => ({
        ...l,
        value: toNumber(l.value),
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
        activityCount: l._count.activities,
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
    const item = await prisma.crmLead.create({
      data: {
        tenantId: session.tenantId,
        title: body.title,
        company: body.company || null,
        contactName: body.contactName || null,
        email: body.email || null,
        phone: body.phone || null,
        status: body.status ?? "NEW",
        value: body.value ?? 0,
        notes: body.notes || null,
        customerId: body.customerId || null,
      },
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "crm.lead.create",
      entity: "crm_lead",
      entityId: item.id,
      meta: { title: item.title, status: item.status },
    });
    return NextResponse.json(
      {
        item: {
          ...item,
          value: toNumber(item.value),
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
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
