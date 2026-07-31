import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  entityModuleSchema,
  listViewUpsertSchema,
} from "@/modules/entity-views/schemas";
import {
  ensureEntityViewDefaults,
  listEntityListViews,
  serializeListView,
} from "@/modules/entity-views/service";

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
    const entity = entityModuleSchema.parse(
      request.nextUrl.searchParams.get("entity"),
    );
    const activeOnly = request.nextUrl.searchParams.get("all") !== "1";
    await ensureEntityViewDefaults(prisma, session.tenantId);
    const items = await listEntityListViews(
      prisma,
      session.tenantId,
      entity,
      activeOnly,
    );
    return NextResponse.json({
      items: items.map(serializeListView),
    });
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
    const body = listViewUpsertSchema.parse(await request.json());
    if (body.isDefault) {
      await prisma.entityListView.updateMany({
        where: {
          tenantId: session!.tenantId,
          entity: body.entity,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }
    const item = await prisma.entityListView.create({
      data: {
        tenantId: session!.tenantId,
        entity: body.entity,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        configJson: body.configJson as unknown as Prisma.InputJsonValue,
        isDefault: body.isDefault ?? false,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.list_views.create",
      entity: "entity_list_view",
      entityId: item.id,
      meta: { code: item.code, entity: item.entity },
    });
    return NextResponse.json({ item: serializeListView(item) }, { status: 201 });
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
