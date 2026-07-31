export type {
  ListViewConfig,
  ListViewConfigV1,
  ListColumn,
  ListFilter,
  ListSort,
  ListMode,
  ListLifecycle,
  ListDensity,
  ListRowAction,
  ListBulkAction,
  ListRule,
} from "./list-experience-types";

export {
  emptyListConfig,
  normalizeListConfig,
  migrateListV1ToV2,
  visibleColumns,
  primarySort,
  lxId,
} from "./list-experience-types";

export type {
  FormViewConfig,
  FormViewConfigV1,
  FormBlock,
  FormFieldRef,
  FormRule,
  FormMode,
  FormLifecycle,
  FieldWidth,
} from "./form-experience-types";

export {
  emptyFormConfig,
  normalizeFormConfig,
  migrateFormV1ToV2,
  walkFormFields,
  fxId,
} from "./form-experience-types";

import type { FormViewConfig } from "./form-experience-types";
import type { ListViewConfig } from "./list-experience-types";
import { normalizeFormConfig, walkFormFields } from "./form-experience-types";
import { normalizeListConfig, primarySort } from "./list-experience-types";
import { collectFormRequiredErrors } from "./form-rules";

export const FILTER_OP_LABELS: Record<
  ListViewConfig["filters"][number]["op"],
  string
> = {
  eq: "=",
  neq: "≠",
  contains: "περιέχει",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  empty: "κενό",
  not_empty: "όχι κενό",
};

export const FILTER_OPS = Object.keys(FILTER_OP_LABELS) as Array<
  ListViewConfig["filters"][number]["op"]
>;

export type CustomFieldsMap = Record<
  string,
  string | number | boolean | string[] | null
>;

export function parseCustomFields(raw: unknown): CustomFieldsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as CustomFieldsMap;
}

export function parseListConfig(raw: unknown): ListViewConfig {
  return normalizeListConfig(raw);
}

export function parseFormConfig(raw: unknown): FormViewConfig {
  return normalizeFormConfig(raw);
}

export function formatFieldValue(
  value: unknown,
  type?: string,
): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Ναι" : "Όχι";
  if (type === "money" || type === "NUMBER") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isNaN(n)) {
      return new Intl.NumberFormat("el-GR", {
        style: type === "money" ? "currency" : "decimal",
        currency: "EUR",
        maximumFractionDigits: 2,
      }).format(n);
    }
  }
  if (type === "date" || type === "DATE") {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("el-GR");
  }
  return String(value);
}

/** Read a system or custom value from a flattened row */
export function readRowValue(
  row: Record<string, unknown>,
  key: string,
  source: "system" | "custom",
): unknown {
  if (source === "custom") {
    const cf = parseCustomFields(row.customFields);
    return cf[key];
  }
  return row[key];
}

export function matchesFilters(
  row: Record<string, unknown>,
  filters: ListViewConfig["filters"],
): boolean {
  for (const f of filters) {
    const raw = readRowValue(row, f.key, f.source);
    const val = f.value;
    const empty =
      raw == null ||
      raw === "" ||
      (Array.isArray(raw) && raw.length === 0);
    switch (f.op) {
      case "empty":
        if (!empty) return false;
        break;
      case "not_empty":
        if (empty) return false;
        break;
      case "eq":
        if (String(raw ?? "") !== String(val ?? "")) return false;
        break;
      case "neq":
        if (String(raw ?? "") === String(val ?? "")) return false;
        break;
      case "contains":
        if (!String(raw ?? "")
          .toLowerCase()
          .includes(String(val ?? "").toLowerCase()))
          return false;
        break;
      case "gt":
        if (!(Number(raw) > Number(val))) return false;
        break;
      case "gte":
        if (!(Number(raw) >= Number(val))) return false;
        break;
      case "lt":
        if (!(Number(raw) < Number(val))) return false;
        break;
      case "lte":
        if (!(Number(raw) <= Number(val))) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

export function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  sort?: ListViewConfig["sort"],
): T[] {
  const s = sort ?? undefined;
  if (!s?.key) return rows;
  const dir = s.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = readRowValue(a, s.key, s.source);
    const bv = readRowValue(b, s.key, s.source);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      return (an - bn) * dir;
    }
    return String(av).localeCompare(String(bv), "el") * dir;
  });
}

/** Apply list config filters + primary sort */
export function applyListConfig<T extends Record<string, unknown>>(
  rows: T[],
  config: ListViewConfig,
): T[] {
  const filtered = !config.filters?.length
    ? rows
    : rows.filter((row) => matchesFilters(row, config.filters));
  return sortRows(filtered, primarySort(config));
}

export function collectRequiredErrors(
  config: FormViewConfig,
  builtins: Array<{ key: string; label: string; required?: boolean }>,
  customDefs: Array<{ code: string; label: string; required: boolean }>,
  values: Record<string, unknown>,
  customValues: CustomFieldsMap,
  role?: string | null,
): string[] {
  return collectFormRequiredErrors(
    config,
    builtins,
    customDefs,
    values,
    customValues,
    role,
  );
}

/** Flat field list helper for simple UIs */
export function flattenFormFields(config: FormViewConfig) {
  const out: Array<{
    key: string;
    source: "system" | "custom";
    required?: boolean;
    label?: string;
  }> = [];
  walkFormFields(config.page.root, (f) => {
    out.push({
      key: f.key,
      source: f.source,
      required: f.required,
      label: f.label,
    });
  });
  return out;
}
