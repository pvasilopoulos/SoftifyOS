import type {
  EntityModule,
  PrismaClient,
  ScriptRuntime,
} from "@/generated/prisma/client";
import {
  runScriptSource,
  ScriptFailError,
  type ScriptContext,
  type ScriptRunResult,
  loadScriptRuntimeDeps,
} from "./runtime";

export { ScriptFailError };

export type DispatchResult = {
  record: Record<string, unknown>;
  results: Array<ScriptRunResult & { scriptId: string; scriptCode: string }>;
  failed?: { scriptCode: string; message: string };
};

/**
 * Run all published SERVER/BOTH scripts for module+event.
 * before.* can mutate record; fail aborts the chain.
 */
export async function dispatchScriptEvent(
  db: PrismaClient,
  opts: {
    tenantId: string;
    module: EntityModule;
    eventKey: string;
    record: Record<string, unknown>;
    previous?: Record<string, unknown> | null;
    user?: { id: string; role?: string } | null;
    /** Only run SERVER-capable scripts (default). UI events skipped here. */
    runtime?: "SERVER" | "UI";
  },
): Promise<DispatchResult> {
  const deps = await loadScriptRuntimeDeps(db, opts.tenantId);
  if (!deps.settings.scriptsEnabled) {
    return { record: { ...opts.record }, results: [] };
  }

  const want: ScriptRuntime[] =
    opts.runtime === "UI" ? ["UI", "BOTH"] : ["SERVER", "BOTH"];

  const scripts = await db.scriptDefinition.findMany({
    where: {
      tenantId: opts.tenantId,
      module: opts.module,
      eventKey: opts.eventKey,
      isActive: true,
      lifecycle: "PUBLISHED",
      runtime: { in: want },
    },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });

  let record = { ...opts.record };
  const results: DispatchResult["results"] = [];

  for (const script of scripts) {
    const timeoutMs = Math.min(
      script.timeoutMs || 3000,
      deps.settings.maxTimeoutMs,
    );
    const ctx: ScriptContext = {
      module: opts.module,
      eventKey: opts.eventKey,
      record,
      previous: opts.previous ?? null,
      user: opts.user ?? null,
    };

    const result = await runScriptSource({
      source: script.source,
      ctx,
      timeoutMs,
      maxHttpCalls: deps.settings.maxHttpCalls,
      allowedHosts: deps.allowedHosts,
      secrets: deps.secrets,
    });

    results.push({
      ...result,
      scriptId: script.id,
      scriptCode: script.code,
    });

    await db.scriptRunLog.create({
      data: {
        tenantId: opts.tenantId,
        scriptId: script.id,
        module: opts.module,
        eventKey: opts.eventKey,
        success: result.ok,
        durationMs: result.durationMs,
        error: result.error ?? null,
        httpCalls: result.httpCalls,
      },
    });

    if (!result.ok) {
      return {
        record,
        results,
        failed: {
          scriptCode: script.code,
          message: result.error || "Script failed",
        },
      };
    }

    record = result.record;
  }

  return { record, results };
}

export function applyRecordPatch<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
  allowedKeys: string[],
): T {
  const out = { ...base };
  for (const key of allowedKeys) {
    if (key in patch) {
      (out as Record<string, unknown>)[key] = patch[key];
    }
  }
  return out;
}
