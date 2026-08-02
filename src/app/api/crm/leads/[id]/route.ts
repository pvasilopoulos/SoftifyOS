import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { buildChangeMeta } from "@/platform/tenancy/audit-diff";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await context.params;
    const existing = await prisma.crmLead.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    const body = patchSchema.parse(await request.json());
    const before = {
      title: existing.title,
      company: existing.company,
      contactName: existing.contactName,
      email: existing.email,
      phone: existing.phone,
      status: existing.status,
      value: toNumber(existing.value),
      notes: existing.notes,
    };

    let customerId =
      body.customerId !== undefined
        ? body.customerId || null
        : existing.customerId;

    // Server-side WON → customer conversion (atomic with status update)
    if (
      body.status === "WON" &&
      !customerId &&
      existing.status !== "WON"
    ) {
      const name =
        existing.company?.trim() ||
        existing.contactName?.trim() ||
        existing.title;
      const code = `L-${existing.id.slice(-8).toUpperCase()}`;
      const found = await prisma.customer.findFirst({
        where: { tenantId: session.tenantId, code },
        select: { id: true },
      });
      if (found) {
        customerId = found.id;
      } else {
        const created = await prisma.customer.create({
          data: {
            tenantId: session.tenantId,
            code,
            name,
            email: existing.email || null,
            phone: existing.phone || null,
          },
        });
        customerId = created.id;
      }
    }

    const item = await prisma.crmLead.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.company !== undefined ? { company: body.company || null } : {}),
        ...(body.contactName !== undefined
          ? { contactName: body.contactName || null }
          : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        customerId,
      },
    });
    const after = {
      title: item.title,
      company: item.company,
      contactName: item.contactName,
      email: item.email,
      phone: item.phone,
      status: item.status,
      value: toNumber(item.value),
      notes: item.notes,
    };
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "crm.lead.update",
      entity: "crm_lead",
      entityId: item.id,
      meta: buildChangeMeta({ before, after }),
    });
    return NextResponse.json({
      item: {
        ...item,
        value: toNumber(item.value),
        updatedAt: item.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
