import type { Prisma } from "@/generated/prisma/client";

export type AuditChange = {
  path: string;
  before: unknown;
  after: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/** JSON-safe snapshot for audit meta (Decimals → number, Dates → ISO). */
export function toAuditJson(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "toNumber" in value) {
    const n = Number((value as { toNumber: () => number }).toNumber());
    return Number.isFinite(n) ? n : String(value);
  }
  if (Array.isArray(value)) return value.map(toAuditJson);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = toAuditJson(v);
    }
    return out;
  }
  return String(value);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "__undefined__";
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function valuesEqual(a: unknown, b: unknown) {
  return stableStringify(toAuditJson(a)) === stableStringify(toAuditJson(b));
}

/** Flatten nested objects for field-level diff rows. */
export function flattenForDiff(
  value: unknown,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (value === undefined) return out;
  if (!isPlainObject(value) || Array.isArray(value)) {
    if (prefix) out[prefix] = value;
    return out;
  }
  const entries = Object.entries(value);
  if (entries.length === 0 && prefix) {
    out[prefix] = {};
    return out;
  }
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child) && !Array.isArray(child)) {
      Object.assign(out, flattenForDiff(child, path));
    } else {
      out[path] = child;
    }
  }
  return out;
}

export function diffAuditRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts?: { omitKeys?: string[] },
): AuditChange[] {
  const omit = new Set(opts?.omitKeys ?? ["id", "updatedAt", "createdAt"]);
  const left = flattenForDiff(toAuditJson(before ?? {}));
  const right = flattenForDiff(toAuditJson(after ?? {}));
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes: AuditChange[] = [];
  for (const path of [...keys].sort()) {
    const root = path.split(".")[0] ?? path;
    if (omit.has(root) || omit.has(path)) continue;
    const b = left[path];
    const a = right[path];
    if (valuesEqual(b, a)) continue;
    changes.push({
      path,
      before: b === undefined ? null : b,
      after: a === undefined ? null : a,
    });
  }
  return changes;
}

/** Standard meta payload for create/update audits. */
export function buildChangeMeta(input: {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  extra?: Record<string, unknown>;
  omitKeys?: string[];
}): Prisma.InputJsonValue {
  const before =
    input.before == null
      ? null
      : (toAuditJson(input.before) as Record<string, unknown>);
  const after =
    input.after == null
      ? null
      : (toAuditJson(input.after) as Record<string, unknown>);
  const changes = diffAuditRecords(before, after, {
    omitKeys: input.omitKeys,
  });
  return {
    ...(input.extra ?? {}),
    before,
    after,
    changes,
  } as Prisma.InputJsonValue;
}

export function parseAuditMeta(meta: unknown): {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changes: AuditChange[];
  rest: Record<string, unknown> | null;
} {
  if (!isPlainObject(meta)) {
    return { before: null, after: null, changes: [], rest: null };
  }
  const before = isPlainObject(meta.before) ? meta.before : null;
  const after = isPlainObject(meta.after) ? meta.after : null;
  let changes: AuditChange[] = [];
  if (Array.isArray(meta.changes)) {
    changes = meta.changes
      .filter((c): c is Record<string, unknown> => isPlainObject(c))
      .map((c) => ({
        path: String(c.path ?? ""),
        before: c.before,
        after: c.after,
      }))
      .filter((c) => c.path);
  } else if (before || after) {
    changes = diffAuditRecords(before, after);
  }
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "before" || k === "after" || k === "changes") continue;
    rest[k] = v;
  }
  return {
    before,
    after,
    changes,
    rest: Object.keys(rest).length ? rest : null,
  };
}
