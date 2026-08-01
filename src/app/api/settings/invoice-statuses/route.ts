import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { INVOICE_WORKFLOWS } from "@/modules/sales/invoice-utils";
import {
  createInvoiceStatusOption,
  InvoiceStatusOptionError,
  listInvoiceStatusOptions,
} from "@/modules/sales/invoice-status-options";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(80),
  workflow: z.enum(INVOICE_WORKFLOWS),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  selectableOnCreate: z.boolean().optional(),
  tone: z.string().trim().max(30).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const selectableOnCreate =
      url.searchParams.get("selectableOnCreate") === "1";
    const activeOnly = url.searchParams.get("activeOnly") === "1";
    const items = await listInvoiceStatusOptions(prisma, session.tenantId, {
      selectableOnCreate,
      activeOnly: activeOnly || selectableOnCreate,
    });
    return NextResponse.json({ items });
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
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = createSchema.parse(await request.json());
    const item = await createInvoiceStatusOption(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice_statuses.create",
      entity: "invoice_status_option",
      entityId: item.id,
      meta: { code: item.code },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof InvoiceStatusOptionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 500 },
    );
  }
}
