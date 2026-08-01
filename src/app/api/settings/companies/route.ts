import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { legalEntitySchema } from "@/modules/ledger/schemas";
import {
  ensureDefaultLegalEntity,
  listLegalEntities,
  upsertLegalEntity,
} from "@/modules/ledger/controlling";
import { LedgerError } from "@/modules/ledger/service";
import { deleteLegalEntity, updateLegalEntity } from "@/modules/org/service";

export const dynamic = "force-dynamic";

const updateSchema = legalEntitySchema.partial().extend({
  id: z.string().min(1),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDefaultLegalEntity(
      prisma,
      session.tenantId,
      session.tenantName,
    );
    const items = await listLegalEntities(prisma, session.tenantId);
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
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = legalEntitySchema.parse(await request.json());
    const item = await upsertLegalEntity(prisma, {
      tenantId: session.tenantId,
      ...body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "company.create",
      entity: "legal_entity",
      entityId: item.id,
      meta: { code: item.code },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = updateSchema.parse(await request.json());
    const item = await updateLegalEntity(prisma, {
      tenantId: session.tenantId,
      id: body.id,
      code: body.code,
      name: body.name,
      vatNumber: body.vatNumber,
      isDefault: body.isDefault,
      isActive: body.isActive,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "company.update",
      entity: "legal_entity",
      entityId: item.id,
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const item = await deleteLegalEntity(prisma, {
      tenantId: session.tenantId,
      id,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "company.delete",
      entity: "legal_entity",
      entityId: id,
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
