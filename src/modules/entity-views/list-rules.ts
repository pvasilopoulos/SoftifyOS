import type { CustomFieldsMap } from "./types";
import type {
  ListFilterOp,
  ListRule,
  ListViewConfig,
} from "./list-experience-types";

function readValue(
  source: "system" | "custom",
  key: string,
  row: Record<string, unknown>,
): unknown {
  if (source === "custom") {
    const cf = (row.customFields ?? {}) as CustomFieldsMap;
    return cf[key];
  }
  return row[key];
}

function matchOp(
  raw: unknown,
  op: ListFilterOp,
  expected?: string | number | boolean | null,
): boolean {
  const empty =
    raw == null ||
    raw === "" ||
    (Array.isArray(raw) && raw.length === 0);
  switch (op) {
    case "empty":
      return empty;
    case "not_empty":
      return !empty;
    case "eq":
      return String(raw ?? "") === String(expected ?? "");
    case "neq":
      return String(raw ?? "") !== String(expected ?? "");
    case "contains":
      return String(raw ?? "")
        .toLowerCase()
        .includes(String(expected ?? "").toLowerCase());
    case "gt":
      return Number(raw) > Number(expected);
    case "gte":
      return Number(raw) >= Number(expected);
    case "lt":
      return Number(raw) < Number(expected);
    case "lte":
      return Number(raw) <= Number(expected);
    default:
      return false;
  }
}

export type RowRuntimeState = {
  tone?: "danger" | "warning" | "success" | "muted";
  badges: string[];
  hiddenActions: Set<string>;
};

export type ListRulesEvaluation = {
  hiddenColumns: Set<string>;
  rows: Map<string, RowRuntimeState>;
};

export function evaluateListRules(
  config: ListViewConfig,
  rows: Array<Record<string, unknown> & { id: string }>,
): ListRulesEvaluation {
  const hiddenColumns = new Set<string>();
  const rowMap = new Map<string, RowRuntimeState>();

  for (const row of rows) {
    rowMap.set(row.id, { badges: [], hiddenActions: new Set() });
  }

  for (const rule of config.rules ?? []) {
    applyGlobalOrRow(rule, config, rows, hiddenColumns, rowMap);
  }

  return { hiddenColumns, rows: rowMap };
}

function applyGlobalOrRow(
  rule: ListRule,
  _config: ListViewConfig,
  rows: Array<Record<string, unknown> & { id: string }>,
  hiddenColumns: Set<string>,
  rowMap: Map<string, RowRuntimeState>,
) {
  const { action, targetId, tone, badge } = rule.then;

  // Column hide/show evaluated if ANY row matches (or we evaluate per typical ERP: hide column if rule is global-ish)
  // We apply column visibility when the rule matches the "first matching semantics":
  // for hide_column/show_column we check if rule matches against a synthetic "any" — better: apply when
  // evaluating without row context only for filters that are about schema. Here we hide column if
  // the rule's when matches at least one approach: use page-level when op on a dedicated path.
  // Practical approach: column rules apply if ANY row matches.
  if (action === "hide_column" || action === "show_column") {
    const anyMatch = rows.some((row) =>
      matchOp(
        readValue(rule.when.source, rule.when.key, row),
        rule.when.op,
        rule.when.value,
      ),
    );
    if (!anyMatch || !targetId) return;
    if (action === "hide_column") hiddenColumns.add(targetId);
    if (action === "show_column") hiddenColumns.delete(targetId);
    return;
  }

  for (const row of rows) {
    const raw = readValue(rule.when.source, rule.when.key, row);
    if (!matchOp(raw, rule.when.op, rule.when.value)) continue;
    const st = rowMap.get(row.id) ?? {
      badges: [],
      hiddenActions: new Set<string>(),
    };
    if (action === "row_tone" && tone) st.tone = tone;
    if (action === "show_badge" && badge) st.badges.push(badge);
    if (action === "hide_action" && targetId) st.hiddenActions.add(targetId);
    rowMap.set(row.id, st);
  }
}

export function rowToneClass(
  tone?: RowRuntimeState["tone"],
): string {
  switch (tone) {
    case "danger":
      return "bg-rose-50/80";
    case "warning":
      return "bg-amber-50/80";
    case "success":
      return "bg-emerald-50/40";
    case "muted":
      return "bg-slate-50";
    default:
      return "";
  }
}
