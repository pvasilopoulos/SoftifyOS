import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { scriptTestSchema } from "@/modules/scripts/schemas";
import {
  loadScriptRuntimeDeps,
  runScriptSource,
  type ScriptContext,
} from "@/modules/scripts/runtime";
import { eventsForModule } from "@/modules/scripts/events";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = scriptTestSchema.parse(await request.json());
    const eventDef = eventsForModule(body.module).find(
      (e) => e.key === body.eventKey,
    );
    const sample = (eventDef?.sampleContext ?? {}) as Record<string, unknown>;
    const userContext = body.context ?? {};
    const record = {
      ...((sample.record as Record<string, unknown> | undefined) ?? {}),
      ...((userContext.record as Record<string, unknown> | undefined) ?? {}),
    };
    const previous =
      (userContext.previous as Record<string, unknown> | undefined) ??
      (sample.previous as Record<string, unknown> | undefined) ??
      null;

    const deps = await loadScriptRuntimeDeps(prisma, session!.tenantId);
    const timeoutMs = Math.min(body.timeoutMs, deps.settings.maxTimeoutMs);

    const ctx: ScriptContext = {
      module: body.module,
      eventKey: body.eventKey,
      record,
      previous,
      user: { id: session!.sub, role: session!.role },
      ...userContext,
    };

    const result = await runScriptSource({
      source: body.source,
      ctx,
      timeoutMs,
      maxHttpCalls: deps.settings.maxHttpCalls,
      allowedHosts: deps.allowedHosts,
      secrets: deps.secrets,
    });

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Test failed") },
      { status: 400 },
    );
  }
}
