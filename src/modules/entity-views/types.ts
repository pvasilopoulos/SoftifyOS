export type ListViewConfig = {
  columns: Array<{ key: string; source: "system" | "custom" }>;
  filters: Array<{
    key: string;
    source: "system" | "custom";
    op: "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";
    value: string | number | boolean | null;
  }>;
  sort?: {
    key: string;
    source: "system" | "custom";
    dir: "asc" | "desc";
  };
  pageSize?: number;
};

export type FormViewConfig = {
  sections: Array<{
    id: string;
    title: string;
    fields: Array<{
      key: string;
      source: "system" | "custom";
      required?: boolean;
    }>;
  }>;
};

export type CustomFieldsMap = Record<
  string,
  string | number | boolean | string[] | null
>;

export function parseCustomFields(raw: unknown): CustomFieldsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as CustomFieldsMap;
}

export function parseListConfig(raw: unknown): ListViewConfig {
  const c = raw as Partial<ListViewConfig>;
  return {
    columns: Array.isArray(c.columns) ? c.columns : [],
    filters: Array.isArray(c.filters) ? c.filters : [],
    sort: c.sort,
    pageSize: c.pageSize ?? 50,
  };
}

export function parseFormConfig(raw: unknown): FormViewConfig {
  const c = raw as Partial<FormViewConfig>;
  return {
    sections: Array.isArray(c.sections) ? c.sections : [],
  };
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
    switch (f.op) {
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
