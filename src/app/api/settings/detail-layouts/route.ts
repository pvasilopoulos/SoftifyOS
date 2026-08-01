import { NextResponse } from "next/server";
import { z } from "zod";
import type { EntityModule } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import {
  detailLayoutConfigSchema,
  entitySupportsDetailTabs,
  getEntityDetailLayout,
  upsertEntityDetailLayout,
} from "@/modules/entity-views/detail-tabs";
import { ENTITY_MODULES } from "@/modules/entity-views/registry";

export const dynamic = "force-dynamic";

const entitySchema = z.enum(
  ENTITY_MODULES as unknown as [EntityModule, ...EntityModule[]],
);

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const entity = entitySchema.parse(
      new URL(request.url).searchParams.get("entity") ?? "CUSTOMERS",
    );
    if (!entitySupportsDetailTabs(entity)) {
      return NextResponse.json({ config: { tabs: [] } });
    }
    const config = await getEntityDetailLayout(
      prisma,
      session.tenantId,
      entity,
    );
    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρη οντότητα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = z
      .object({
        entity: entitySchema,
        config: detailLayoutConfigSchema,
      })
      .parse(await request.json());

    const config = await upsertEntityDetailLayout(
      prisma,
      session.tenantId,
      body.entity,
      body.config,
    );

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "entity_detail_layout.update",
      entity: "entity_detail_layout",
      entityId: body.entity,
      meta: {
        tabs: config.tabs.map((t) => t.key),
        defaultTab: config.defaultTab,
      },
    });

    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
