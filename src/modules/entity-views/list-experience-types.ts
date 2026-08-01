/** List Experience Engine — schema v2 */

export type ListMode =
  | "browse"
  | "select"
  | "compact"
  | "peek"
  | "cards"
  | "kanban"
  | "map";
export type ListLifecycle = "draft" | "published";
export type ListDensity = "compact" | "comfortable" | "detailed";
export type ListRowClick = "navigate" | "peek" | "none";
export type ColumnPin = "left" | "right" | "none";
export type ColumnAlign = "start" | "end" | "center";

export type ListFilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "empty"
  | "not_empty";

export type ListColumn = {
  id: string;
  key: string;
  source: "system" | "custom";
  label?: string;
  width?: number;
  minWidth?: number;
  pin?: ColumnPin;
  align?: ColumnAlign;
  format?: "default" | "money" | "date" | "badge" | "boolean";
  sortable?: boolean;
  filterable?: boolean;
  truncate?: boolean;
  hidden?: boolean;
};

export type ListFilter = {
  id?: string;
  key: string;
  source: "system" | "custom";
  op: ListFilterOp;
  value: string | number | boolean | null;
  interactive?: boolean;
};

export type ListSort = {
  id?: string;
  key: string;
  source: "system" | "custom";
  dir: "asc" | "desc";
};

export type ListRowAction = {
  id: string;
  label: string;
  type: "navigate" | "form_edit" | "form_peek" | "form_quick" | "print" | "custom";
  formCode?: string;
  hrefTemplate?: string;
  icon?: string;
};

export type ListBulkAction = {
  id: string;
  label: string;
  type: "export_csv" | "delete" | "status" | "custom";
  statusValue?: string;
};

export type ListRule = {
  id: string;
  when: {
    source: "system" | "custom";
    key: string;
    op: ListFilterOp;
    value?: string | number | boolean | null;
  };
  then: {
    action:
      | "hide_column"
      | "show_column"
      | "row_tone"
      | "hide_action"
      | "show_badge";
    targetId?: string;
    tone?: "danger" | "warning" | "success" | "muted";
    badge?: string;
  };
};

export type ListViewConfig = {
  schemaVersion: 2;
  mode?: ListMode;
  lifecycle?: ListLifecycle;
  page?: {
    density?: ListDensity;
    peekFormCode?: string | null;
    editFormCode?: string | null;
    rowClick?: ListRowClick;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyCta?: "form_quick" | "navigate_new" | "none";
    showSearch?: boolean;
    /** Kanban grouping field */
    groupByKey?: string;
    groupBySource?: "system" | "custom";
  };
  columns: ListColumn[];
  filters: ListFilter[];
  /** Primary sort (compat) */
  sort?: ListSort;
  /** Extra sorts */
  sorts?: ListSort[];
  pageSize?: number;
  rowActions?: ListRowAction[];
  bulkActions?: ListBulkAction[];
  rules?: ListRule[];
};

/** Legacy v1 */
export type ListViewConfigV1 = {
  columns: Array<{
    key: string;
    source: "system" | "custom";
    label?: string;
  }>;
  filters: Array<{
    key: string;
    source: "system" | "custom";
    op: ListFilterOp;
    value: string | number | boolean | null;
  }>;
  sort?: {
    key: string;
    source: "system" | "custom";
    dir: "asc" | "desc";
  };
  pageSize?: number;
};

export function lxId(prefix = "lx") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyListConfig(): ListViewConfig {
  return {
    schemaVersion: 2,
    mode: "browse",
    lifecycle: "published",
    page: {
      density: "comfortable",
      rowClick: "navigate",
      peekFormCode: null,
      editFormCode: null,
      emptyTitle: "Δεν βρέθηκαν εγγραφές",
      emptyCta: "none",
      showSearch: true,
      groupByKey: "status",
      groupBySource: "system",
    },
    columns: [],
    filters: [],
    sort: { key: "createdAt", source: "system", dir: "desc" },
    sorts: [],
    pageSize: 50,
    rowActions: [
      { id: "open", label: "Άνοιγμα", type: "navigate", icon: "external-link" },
    ],
    bulkActions: [],
    rules: [],
  };
}

export function migrateListV1ToV2(v1: ListViewConfigV1): ListViewConfig {
  const base = emptyListConfig();
  return {
    ...base,
    columns: (v1.columns ?? []).map((c, i) => ({
      id: `col_${i}_${c.key}`,
      key: c.key,
      source: c.source,
      label: c.label,
      pin: i === 0 ? "left" : "none",
      align: "start",
      format: "default",
      truncate: true,
      sortable: true,
      filterable: true,
    })),
    filters: (v1.filters ?? []).map((f, i) => ({
      ...f,
      id: `flt_${i}`,
    })),
    sort: v1.sort
      ? { ...v1.sort, id: "sort_primary" }
      : base.sort,
    pageSize: v1.pageSize ?? 50,
  };
}

export function isListV2(raw: unknown): raw is ListViewConfig {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as ListViewConfig).schemaVersion === 2 &&
    Array.isArray((raw as ListViewConfig).columns)
  );
}

export function normalizeListConfig(raw: unknown): ListViewConfig {
  if (isListV2(raw)) {
    const c = raw;
    return {
      ...emptyListConfig(),
      ...c,
      schemaVersion: 2,
      mode: c.mode ?? "browse",
      lifecycle: c.lifecycle ?? "published",
      page: {
        ...emptyListConfig().page,
        ...c.page,
      },
      columns: (c.columns ?? []).map((col, i) => ({
        id: col.id || `col_${i}_${col.key}`,
        key: col.key,
        source: col.source,
        label: col.label,
        width: col.width,
        minWidth: col.minWidth,
        pin: col.pin ?? "none",
        align: col.align ?? "start",
        format: col.format ?? "default",
        sortable: col.sortable !== false,
        filterable: col.filterable !== false,
        truncate: col.truncate !== false,
        hidden: col.hidden === true,
      })),
      filters: (c.filters ?? []).map((f, i) => ({
        ...f,
        id: f.id ?? `flt_${i}`,
      })),
      sort: c.sort,
      sorts: c.sorts ?? [],
      pageSize: c.pageSize ?? 50,
      rowActions: c.rowActions ?? emptyListConfig().rowActions,
      bulkActions: c.bulkActions ?? [],
      rules: c.rules ?? [],
    };
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as ListViewConfigV1).columns)) {
    return migrateListV1ToV2(raw as ListViewConfigV1);
  }
  return emptyListConfig();
}

export function visibleColumns(
  config: ListViewConfig,
  hiddenIds: Set<string>,
): ListColumn[] {
  return config.columns.filter(
    (c) => !c.hidden && !hiddenIds.has(c.id),
  );
}

export function primarySort(config: ListViewConfig): ListSort | undefined {
  return config.sort ?? config.sorts?.[0];
}
