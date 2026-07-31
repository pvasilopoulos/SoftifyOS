import type {
  EntityModule,
  Prisma,
  PrismaClient,
  ScriptRunSource,
} from "@/generated/prisma/client";
import type { ScriptRunResult } from "./runtime";

const SNAPSHOT_KEYS = [
  "id",
  "code",
  "sku",
  "name",
  "status",
  "vatNumber",
  "email",
  "phone",
  "number",
  "total",
] as const;

export type ScriptActor = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
} | null;

function truncateLogs(logs: string[], max = 40): string[] {
  return logs.slice(0, max).map((l) =>
    l.length > 500 ? `${l.slice(0, 500)}…` : l,
  );
}

export function buildRecordSnapshot(
  record: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (!record || typeof record !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const key of SNAPSHOT_KEYS) {
    if (key in record) out[key] = record[key];
  }
  if (record.customFields && typeof record.customFields === "object") {
    out.customFields = record.customFields;
  }
  return Object.keys(out).length ? (out as Prisma.InputJsonValue) : undefined;
}

export async function writeScriptRunLog(
  db: PrismaClient,
  opts: {
    tenantId: string;
    scriptId?: string | null;
    scriptCode?: string | null;
    scriptName?: string | null;
    module: EntityModule;
    eventKey: string;
    source: ScriptRunSource;
    result: ScriptRunResult;
    user?: ScriptActor;
    record?: Record<string, unknown> | null;
  },
) {
  const record = opts.record ?? null;
  const recordId =
    record && typeof record.id === "string" ? record.id : null;
  const recordCode =
    record && (typeof record.code === "string" || typeof record.sku === "string")
      ? String(record.code ?? record.sku)
      : record && typeof record.number === "string"
        ? record.number
        : null;

  return db.scriptRunLog.create({
    data: {
      tenantId: opts.tenantId,
      scriptId: opts.scriptId ?? null,
      module: opts.module,
      eventKey: opts.eventKey,
      success: opts.result.ok,
      durationMs: opts.result.durationMs,
      error: opts.result.error ?? null,
      httpCalls: opts.result.httpCalls,
      source: opts.source,
      scriptCode: opts.scriptCode ?? null,
      scriptName: opts.scriptName ?? null,
      userId: opts.user?.id ?? null,
      userEmail: opts.user?.email ?? null,
      userName: opts.user?.name ?? null,
      userRole: opts.user?.role ?? null,
      recordId,
      recordCode,
      logsJson: truncateLogs(opts.result.logs ?? []) as Prisma.InputJsonValue,
      recordSnapshot: buildRecordSnapshot(record ?? undefined),
    },
  });
}
