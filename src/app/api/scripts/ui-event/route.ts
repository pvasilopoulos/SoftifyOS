import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { entityModuleSchema } from "@/modules/entity-views/schemas";
import { dispatchScriptEvent } from "@/modules/scripts/service";
import { scriptActorFromSession } from "@/modules/scripts/actor";
import { isKnownEvent } from "@/modules/scripts/events";

export const dynamic = "force-dynamic";

const uiEventSchema = z.object({
  module: entityModuleSchema,
  eventKey: z.string().min(1).max(80),
  record: z.record(z.string(), z.unknown()).default({}),
  previous: z.record(z.string(), z.unknown()).nullable().optional(),
  field: z.string().max(80).optional(),
  value: z.unknown().optional(),
  mode: z.enum(["create", "edit", "view"]).optional(),
});

/**
 * Run published UI/BOTH scripts for form/list events.
 * Used by Form Experience (onLoad, onFieldChange, beforeSubmit).
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = uiEventSchema.parse(await request.json());
    if (!isKnownEvent(body.module, body.eventKey)) {
      return NextResponse.json({ error: "Άγνωστο event" }, { status: 400 });
    }

    const result = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: body.module,
      eventKey: body.eventKey,
      record: { ...body.record },
      previous: body.previous ?? null,
      user: scriptActorFromSession(session),
      runtime: "UI",
      extra: {
        ...(body.field !== undefined ? { field: body.field } : {}),
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.mode ? { mode: body.mode } : {}),
      },
    });

    if (result.failed) {
      return NextResponse.json({
        ok: false,
        error: result.failed.message,
        script: result.failed.scriptCode,
        record: result.record,
      });
    }

    return NextResponse.json({
      ok: true,
      record: result.record,
      results: result.results.map((r) => ({
        scriptCode: r.scriptCode,
        ok: r.ok,
        durationMs: r.durationMs,
        logs: r.logs,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "UI script failed") },
      { status: 400 },
    );
  }
}
