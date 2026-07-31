import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  customFieldUpsertSchema,
  entityModuleSchema,
} from "@/modules/entity-views/schemas";
import { listCustomFields } from "@/modules/entity-views/service";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const entityRaw = request.nextUrl.searchParams.get("entity");
    const entity = entityRaw
      ? entityModuleSchema.parse(entityRaw)
      : undefined;
    const active = request.nextUrl.searchParams.get("active") === "1";
    const items = await listCustomFields(
      prisma,
      session.tenantId,
      entity,
      active,
    );
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = customFieldUpsertSchema.parse(await request.json());
    const item = await prisma.customFieldDefinition.create({
      data: {
        tenantId: session!.tenantId,
        entity: body.entity,
        code: body.code,
        label: body.label,
        type: body.type,
        optionsJson: body.options ?? [],
        required: body.required ?? false,
        filterable: body.filterable ?? false,
        showInList: body.showInList ?? true,
        sortOrder: body.sortOrder ?? 0,
        isActive: body.isActive ?? true,
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.custom_fields.create",
      entity: "custom_field_definition",
      entityId: item.id,
      meta: { code: item.code, entity: item.entity },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ο κωδικός υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
