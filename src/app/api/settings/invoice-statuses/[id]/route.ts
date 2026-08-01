import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { INVOICE_WORKFLOWS } from "@/modules/sales/invoice-utils";
import {
  deleteInvoiceStatusOption,
  InvoiceStatusOptionError,
  updateInvoiceStatusOption,
} from "@/modules/sales/invoice-status-options";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  workflow: z.enum(INVOICE_WORKFLOWS).optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  selectableOnCreate: z.boolean().optional(),
  tone: z.string().trim().max(30).optional(),
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
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const item = await updateInvoiceStatusOption(prisma, {
      tenantId: session.tenantId,
      id,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice_statuses.update",
      entity: "invoice_status_option",
      entityId: item.id,
      meta: { code: item.code },
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof InvoiceStatusOptionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await context.params;
    await deleteInvoiceStatusOption(prisma, {
      tenantId: session.tenantId,
      id,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice_statuses.delete",
      entity: "invoice_status_option",
      entityId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InvoiceStatusOptionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 500 },
    );
  }
}
