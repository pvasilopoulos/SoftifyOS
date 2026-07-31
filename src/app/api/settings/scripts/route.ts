import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { entityModuleSchema } from "@/modules/entity-views/schemas";
import { scriptUpsertSchema } from "@/modules/scripts/schemas";
import {
  eventsForModule,
  SCRIPT_EVENTS_BY_MODULE,
  SCRIPT_TEMPLATE,
  isKnownEvent,
} from "@/modules/scripts/events";

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

    const moduleRaw = request.nextUrl.searchParams.get("module");
    const moduleFilter = moduleRaw
      ? entityModuleSchema.parse(moduleRaw)
      : undefined;

    const [scripts, secrets, allowlist, settings, recentLogs] =
      await Promise.all([
        prisma.scriptDefinition.findMany({
          where: {
            tenantId: session.tenantId,
            ...(moduleFilter ? { module: moduleFilter } : {}),
          },
          orderBy: [
            { module: "asc" },
            { eventKey: "asc" },
            { sortOrder: "asc" },
            { code: "asc" },
          ],
        }),
        prisma.scriptSecret.findMany({
          where: { tenantId: session.tenantId },
          orderBy: { key: "asc" },
          select: { id: true, key: true, updatedAt: true, createdAt: true },
        }),
        prisma.scriptHttpAllowlist.findMany({
          where: { tenantId: session.tenantId },
          orderBy: { host: "asc" },
        }),
        prisma.scriptSettings.upsert({
          where: { tenantId: session.tenantId },
          create: { tenantId: session.tenantId },
          update: {},
        }),
        prisma.scriptRunLog.findMany({
          where: { tenantId: session.tenantId },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            scriptId: true,
            module: true,
            eventKey: true,
            success: true,
            durationMs: true,
            error: true,
            httpCalls: true,
            createdAt: true,
          },
        }),
      ]);

    return NextResponse.json({
      scripts,
      secrets,
      allowlist,
      settings,
      recentLogs,
      template: SCRIPT_TEMPLATE,
      eventsByModule: SCRIPT_EVENTS_BY_MODULE,
      events: moduleFilter ? eventsForModule(moduleFilter) : undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid module" }, { status: 400 });
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

    const body = scriptUpsertSchema.parse(await request.json());
    if (!isKnownEvent(body.module, body.eventKey)) {
      return NextResponse.json(
        { error: "Άγνωστο event για το module." },
        { status: 400 },
      );
    }

    const item = await prisma.scriptDefinition.create({
      data: {
        tenantId: session!.tenantId,
        module: body.module,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        eventKey: body.eventKey,
        runtime: body.runtime,
        source: body.source,
        lifecycle: body.lifecycle,
        isActive: body.isActive,
        sortOrder: body.sortOrder,
        timeoutMs: body.timeoutMs,
        updatedById: session!.sub,
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.scripts.create",
      entity: "script_definition",
      entityId: item.id,
      meta: { code: item.code, module: item.module, eventKey: item.eventKey },
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
      return NextResponse.json(
        { error: "Ο κωδικός script υπάρχει ήδη" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
