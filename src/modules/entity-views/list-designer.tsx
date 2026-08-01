"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Filter,
  ListFilter as ListFilterIcon,
  Plus,
  Save,
  SortAsc,
  Trash2,
  Zap,
} from "lucide-react";
import type { EntityModule } from "@/generated/prisma/client";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { entityLabel, type BuiltinField } from "./registry";
import {
  FILTER_OPS,
  FILTER_OP_LABELS,
  emptyListConfig,
  lxId,
  normalizeListConfig,
  type ListBulkAction,
  type ListColumn,
  type ListDensity,
  type ListFilter,
  type ListMode,
  type ListRowAction,
  type ListRule,
  type ListSort,
  type ListViewConfig,
} from "./types";
import type {
  ColumnAlign,
  ColumnPin,
  ListFilterOp,
  ListRowClick,
} from "./list-experience-types";
import { ListExperienceRenderer } from "./list-experience-renderer";

type CustomFieldItem = {
  id: string;
  code: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  filterable: boolean;
  showInList: boolean;
  sortOrder: number;
  isActive: boolean;
};

type ListViewItem = {
  id: string;
  entity: EntityModule;
  code: string;
  name: string;
  description: string | null;
  config: ListViewConfig;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
};

type FormViewOption = { id: string; code: string; name: string };

type Selection =
  | { kind: "page" }
  | { kind: "column"; id: string }
  | { kind: "filter"; id: string }
  | { kind: "sort"; id: string }
  | { kind: "rowAction"; id: string }
  | { kind: "bulkAction"; id: string }
  | { kind: "rule"; id: string };

const MODES: ListMode[] = [
  "browse",
  "select",
  "compact",
  "peek",
  "cards",
  "kanban",
  "map",
];

const MODE_LABELS: Record<ListMode, string> = {
  browse: "Λίστα",
  select: "Επιλογή",
  compact: "Compact",
  peek: "Peek",
  cards: "Cards",
  kanban: "Kanban",
  map: "Χάρτης",
};

const RULE_ACTIONS: ListRule["then"]["action"][] = [
  "hide_column",
  "show_column",
  "row_tone",
  "hide_action",
  "show_badge",
];

const ROW_ACTION_TYPES: ListRowAction["type"][] = [
  "navigate",
  "form_edit",
  "form_peek",
  "form_quick",
  "print",
  "custom",
];

const BULK_ACTION_TYPES: ListBulkAction["type"][] = [
  "export_csv",
  "delete",
  "status",
  "custom",
];

function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const next = index + dir;
  if (next < 0 || next >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[next]] = [copy[next]!, copy[index]!];
  return copy;
}

function FieldInput({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-8 w-full rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-teal-400";

function makeColumn(
  key: string,
  source: "system" | "custom",
  label: string,
  opts?: { pin?: ColumnPin; format?: ListColumn["format"] },
): ListColumn {
  return {
    id: lxId("col"),
    key,
    source,
    label,
    pin: opts?.pin ?? "none",
    align: "start",
    format: opts?.format ?? "default",
    sortable: true,
    filterable: true,
    truncate: true,
    hidden: false,
  };
}

function sampleValueForColumn(col: ListColumn, rowIndex: number): unknown {
  const n = rowIndex + 1;
  switch (col.format) {
    case "money":
      return 100 * n + 0.5 * n;
    case "date":
      return new Date(2026, 0, n * 3).toISOString();
    case "boolean":
      return n % 2 === 0;
    case "badge":
      return n % 2 === 0 ? "ACTIVE" : "DRAFT";
    default:
      if (col.key.toLowerCase().includes("status")) {
        return n % 2 === 0 ? "ACTIVE" : "INACTIVE";
      }
      if (col.key.toLowerCase().includes("email")) {
        return `sample${n}@example.com`;
      }
      if (col.key.toLowerCase().includes("phone")) {
        return `21000000${n}`;
      }
      return `${col.label || col.key} #${n}`;
  }
}

function buildSampleRows(
  columns: ListColumn[],
): Array<Record<string, unknown> & { id: string }> {
  return [0, 1, 2].map((i) => {
    const row: Record<string, unknown> & { id: string } = {
      id: `sample_${i + 1}`,
      customFields: {},
    };
    const cf: Record<string, unknown> = {};
    for (const col of columns) {
      const val = sampleValueForColumn(col, i);
      if (col.source === "custom") {
        cf[col.key] = val;
      } else {
        row[col.key] = val;
      }
    }
    row.customFields = cf;
    return row;
  });
}

function formatFromBuiltin(type: BuiltinField["type"]): ListColumn["format"] {
  if (type === "money") return "money";
  if (type === "date") return "date";
  if (type === "boolean") return "boolean";
  if (type === "badge" || type === "select") return "badge";
  return "default";
}

function allSorts(config: ListViewConfig): ListSort[] {
  const primary = config.sort
    ? [{ ...config.sort, id: config.sort.id ?? "sort_primary" }]
    : [];
  const extras = (config.sorts ?? []).map((s, i) => ({
    ...s,
    id: s.id ?? `sort_${i}`,
  }));
  const seen = new Set<string>();
  const out: ListSort[] = [];
  for (const s of [...primary, ...extras]) {
    const id = s.id!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}

export function ListExperienceDesigner({
  entity,
  builtins,
  customFields,
  items,
  formViews = [],
  pending,
  onSave,
  onCreate,
  onDelete,
}: {
  entity: EntityModule;
  builtins: BuiltinField[];
  customFields: CustomFieldItem[];
  items: ListViewItem[];
  formViews?: FormViewOption[];
  pending: boolean;
  onSave: (
    item: {
      id: string;
      isSystem: boolean;
      isDefault: boolean;
      isActive: boolean;
      name: string;
    },
    config: ListViewConfig,
    meta: { name: string; isDefault: boolean; isActive: boolean },
  ) => void;
  onCreate: (payload: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  const [draft, setDraft] = useState<ListViewConfig>(() =>
    normalizeListConfig(items[0]?.config),
  );
  const [name, setName] = useState(items[0]?.name ?? "");
  const [selection, setSelection] = useState<Selection>({ kind: "page" });
  const [previewMode, setPreviewMode] = useState<ListMode>(
    () => normalizeListConfig(items[0]?.config).mode ?? "browse",
  );
  const [validateMsg, setValidateMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      const first = items[0];
      if (first) {
        const cfg = normalizeListConfig(first.config);
        setSelectedId(first.id);
        setDraft(cfg);
        setName(first.name);
        setSelection({ kind: "page" });
        setPreviewMode(cfg.mode ?? "browse");
      }
      return;
    }
    if (!items.some((i) => i.id === selectedId)) {
      const first = items[0];
      if (first) {
        const cfg = normalizeListConfig(first.config);
        setSelectedId(first.id);
        setDraft(cfg);
        setName(first.name);
        setSelection({ kind: "page" });
        setPreviewMode(cfg.mode ?? "browse");
      } else {
        setSelectedId("");
        setDraft(emptyListConfig());
        setName("");
        setSelection({ kind: "page" });
      }
    }
  }, [items, selectedId]);

  const selectView = (item: ListViewItem) => {
    const cfg = normalizeListConfig(item.config);
    setSelectedId(item.id);
    setDraft(cfg);
    setName(item.name);
    setSelection({ kind: "page" });
    setPreviewMode(cfg.mode ?? "browse");
    setValidateMsg(null);
  };

  const updateDraft = (next: ListViewConfig) => {
    setDraft(normalizeListConfig(next));
    setValidateMsg(null);
  };

  const patchPage = (patch: Partial<NonNullable<ListViewConfig["page"]>>) => {
    updateDraft({
      ...draft,
      page: { ...draft.page, ...patch },
    });
  };

  const listableBuiltins = builtins.filter((b) => b.listable !== false);
  const activeCustoms = customFields.filter((f) => f.isActive);

  const customDefs = useMemo(
    () =>
      customFields
        .filter((f) => f.isActive)
        .map((f) => ({
          code: f.code,
          label: f.label,
          type: f.type as never,
          optionsJson: f.options,
          required: f.required,
        })),
    [customFields],
  );

  const hasColumn = (key: string, source: "system" | "custom") =>
    draft.columns.some((c) => c.key === key && c.source === source);

  const createDefaultConfig = (): ListViewConfig => {
    const base = emptyListConfig();
    const cols = listableBuiltins.slice(0, 5).map((b, i) =>
      makeColumn(b.key, "system", b.label, {
        pin: i === 0 ? "left" : "none",
        format: formatFromBuiltin(b.type),
      }),
    );
    return { ...base, columns: cols };
  };

  const handleCreate = () => {
    onCreate({
      entity,
      code: `list_${Date.now().toString(36)}`,
      name: `Νέα λίστα ${entityLabel(entity)}`,
      configJson: createDefaultConfig(),
    });
  };

  const handleDuplicate = () => {
    if (!selected) return;
    onCreate({
      entity,
      code: `list_${Date.now().toString(36)}`,
      name: `${name || selected.name} (αντίγραφο)`,
      configJson: draft,
    });
  };

  const handleValidate = () => {
    if (draft.columns.length === 0) {
      setValidateMsg("Προσοχή: η λίστα δεν έχει στήλες.");
      return;
    }
    setValidateMsg("OK — υπάρχουν στήλες στη λίστα.");
  };

  const addColumn = (
    key: string,
    source: "system" | "custom",
    label: string,
    format?: ListColumn["format"],
  ) => {
    if (hasColumn(key, source)) return;
    const col = makeColumn(key, source, label, {
      pin: draft.columns.length === 0 ? "left" : "none",
      format,
    });
    updateDraft({ ...draft, columns: [...draft.columns, col] });
    setSelection({ kind: "column", id: col.id });
  };

  const addFilter = () => {
    const first = listableBuiltins[0];
    const f: ListFilter = {
      id: lxId("flt"),
      key: first?.key ?? "status",
      source: "system",
      op: "eq",
      value: "",
      interactive: true,
    };
    updateDraft({ ...draft, filters: [...draft.filters, f] });
    setSelection({ kind: "filter", id: f.id! });
  };

  const addSort = () => {
    const first = draft.columns[0] ?? listableBuiltins[0];
    const s: ListSort = {
      id: lxId("sort"),
      key: first && "key" in first ? first.key : "createdAt",
      source:
        first && "source" in first
          ? (first as ListColumn).source
          : "system",
      dir: "asc",
    };
    if (!draft.sort) {
      updateDraft({ ...draft, sort: s });
    } else {
      updateDraft({ ...draft, sorts: [...(draft.sorts ?? []), s] });
    }
    setSelection({ kind: "sort", id: s.id! });
  };

  const addRowAction = () => {
    const a: ListRowAction = {
      id: lxId("ra"),
      label: "Ενέργεια",
      type: "navigate",
    };
    updateDraft({
      ...draft,
      rowActions: [...(draft.rowActions ?? []), a],
    });
    setSelection({ kind: "rowAction", id: a.id });
  };

  const addBulkAction = () => {
    const a: ListBulkAction = {
      id: lxId("ba"),
      label: "Μαζική",
      type: "export_csv",
    };
    updateDraft({
      ...draft,
      bulkActions: [...(draft.bulkActions ?? []), a],
    });
    setSelection({ kind: "bulkAction", id: a.id });
  };

  const addRule = () => {
    const first = listableBuiltins[0];
    const rule: ListRule = {
      id: lxId("rule"),
      when: {
        source: "system",
        key: first?.key ?? "status",
        op: "eq",
        value: "",
      },
      then: {
        action: "row_tone",
        tone: "warning",
      },
    };
    updateDraft({ ...draft, rules: [...(draft.rules ?? []), rule] });
    setSelection({ kind: "rule", id: rule.id });
  };

  const selectedColumn =
    selection.kind === "column"
      ? (draft.columns.find((c) => c.id === selection.id) ?? null)
      : null;

  const sorts = allSorts(draft);

  const patchColumn = (id: string, patch: Partial<ListColumn>) => {
    updateDraft({
      ...draft,
      columns: draft.columns.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  };

  const removeColumn = (id: string) => {
    updateDraft({
      ...draft,
      columns: draft.columns.filter((c) => c.id !== id),
    });
    setSelection({ kind: "page" });
  };

  const patchFilter = (id: string, patch: Partial<ListFilter>) => {
    updateDraft({
      ...draft,
      filters: draft.filters.map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      ),
    });
  };

  const writeSorts = (next: ListSort[]) => {
    if (next.length === 0) {
      updateDraft({ ...draft, sort: undefined, sorts: [] });
      return;
    }
    const [primary, ...rest] = next;
    updateDraft({
      ...draft,
      sort: primary,
      sorts: rest,
    });
  };

  const patchSort = (id: string, patch: Partial<ListSort>) => {
    writeSorts(
      sorts.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  };

  const previewConfig = useMemo(
    () =>
      normalizeListConfig({
        ...draft,
        mode: previewMode,
      }),
    [draft, previewMode],
  );

  const sampleRows = useMemo(
    () => buildSampleRows(draft.columns),
    [draft.columns],
  );

  const fieldOptions = (
    <>
      {listableBuiltins.map((b) => (
        <option key={`s:${b.key}`} value={`system:${b.key}`}>
          sys:{b.label}
        </option>
      ))}
      {activeCustoms.map((f) => (
        <option key={`c:${f.code}`} value={`custom:${f.code}`}>
          cus:{f.label}
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-3">
      {selected ? (
        <div className="soft-panel flex flex-wrap items-center gap-2 p-3">
          <input
            value={name || selected.name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 min-w-[180px] flex-1 rounded-xl border border-slate-200 px-3 text-sm font-medium"
          />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              onSave(selected, draft, {
                name: name || selected.name,
                isDefault: selected.isDefault,
                isActive: selected.isActive,
              })
            }
          >
            <Save size={14} /> Αποθήκευση
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              onSave(selected, draft, {
                name: name || selected.name,
                isDefault: true,
                isActive: true,
              })
            }
          >
            Default
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={handleDuplicate}
          >
            <Copy size={14} /> Διπλότυπο
          </Button>
          <Button size="sm" variant="secondary" onClick={handleValidate}>
            Έλεγχος
          </Button>
          {!selected.isSystem ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onDelete(selected.id)}
            >
              <Trash2 size={14} />
            </Button>
          ) : null}
          {validateMsg ? (
            <span
              className={cn(
                "text-xs",
                validateMsg.startsWith("OK")
                  ? "text-emerald-700"
                  : "text-amber-700",
              )}
            >
              {validateMsg}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
        {/* Left: views list */}
        <aside className="soft-panel flex flex-col gap-2 p-2">
          <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Προβολές λίστας
          </p>
          <ul className="max-h-[420px] space-y-1 overflow-y-auto">
            {items.map((item) => {
              const life =
                normalizeListConfig(item.config).lifecycle ?? "published";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => selectView(item)}
                    className={cn(
                      "w-full rounded-xl px-3 py-2 text-left text-sm",
                      selectedId === item.id
                        ? "bg-teal-50 text-teal-900"
                        : "hover:bg-slate-50",
                    )}
                  >
                    <span className="block truncate font-medium">
                      {item.name}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {item.isDefault ? (
                        <Badge tone="teal">Default</Badge>
                      ) : null}
                      <Badge tone={life === "draft" ? "amber" : "emerald"}>
                        {life === "draft" ? "Draft" : "Published"}
                      </Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            className="w-full"
            disabled={pending}
            onClick={handleCreate}
          >
            <Plus size={14} /> Νέα λίστα
          </Button>
          {selected ? (
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={handleDuplicate}
            >
              <Copy size={14} /> Διπλότυπο
            </Button>
          ) : null}
          {selected && !selected.isSystem ? (
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-rose-600"
              disabled={pending}
              onClick={() => onDelete(selected.id)}
            >
              <Trash2 size={14} /> Διαγραφή
            </Button>
          ) : null}
        </aside>

        {/* Center: palette + canvas */}
        <div className="grid gap-3 min-[900px]:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="soft-panel space-y-3 p-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Mode
            </p>
            <div className="flex flex-wrap gap-1">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!selected}
                  onClick={() => {
                    updateDraft({ ...draft, mode: m });
                    setPreviewMode(m);
                  }}
                  className={cn(
                    "rounded-lg px-2 py-1 text-[10px] font-medium disabled:opacity-40",
                    (draft.mode ?? "browse") === m
                      ? "bg-teal-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>

            <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Προσθήκη
            </p>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={!selected}
                onClick={addFilter}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-teal-50 disabled:opacity-40"
              >
                <Filter size={14} className="shrink-0 text-teal-700" />
                Φίλτρο
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={addSort}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-teal-50 disabled:opacity-40"
              >
                <SortAsc size={14} className="shrink-0 text-teal-700" />
                Ταξινόμηση
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={addRowAction}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-teal-50 disabled:opacity-40"
              >
                <Zap size={14} className="shrink-0 text-teal-700" />
                Row action
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={addBulkAction}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-teal-50 disabled:opacity-40"
              >
                <ListFilterIcon size={14} className="shrink-0 text-teal-700" />
                Bulk action
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={addRule}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-teal-50 disabled:opacity-40"
              >
                <Plus size={14} className="shrink-0 text-teal-700" />
                Κανόνας
              </button>
            </div>

            <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Πεδία συστήματος
            </p>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {listableBuiltins.map((b) => {
                const used = hasColumn(b.key, "system");
                return (
                  <button
                    key={b.key}
                    type="button"
                    disabled={!selected || used}
                    onClick={() =>
                      addColumn(
                        b.key,
                        "system",
                        b.label,
                        formatFromBuiltin(b.type),
                      )
                    }
                    className="rounded-lg px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {b.label}
                    {used ? " ✓" : ""}
                  </button>
                );
              })}
            </div>

            <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Custom
            </p>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {activeCustoms.length === 0 ? (
                <p className="px-2 text-[11px] text-slate-400">Κανένα ενεργό</p>
              ) : (
                activeCustoms.map((f) => {
                  const used = hasColumn(f.code, "custom");
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={!selected || used}
                      onClick={() => addColumn(f.code, "custom", f.label)}
                      className="rounded-lg px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {f.label}
                      {used ? " ✓" : ""}
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <div className="soft-panel space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Καμβάς
              </p>
              <div className="ml-auto flex flex-wrap gap-1">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPreviewMode(m)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-[11px] font-medium",
                      previewMode === m
                        ? "bg-teal-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
              {selected ? (
                <ListExperienceRenderer
                  config={previewConfig}
                  builtins={builtins}
                  customDefs={customDefs}
                  rows={sampleRows}
                  hrefForRow={() => "#"}
                />
              ) : (
                <p className="text-sm text-slate-400">
                  Επιλέξτε ή δημιουργήστε μια προβολή λίστας.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Στήλες
                </p>
                <button
                  type="button"
                  className="text-[11px] text-teal-700 hover:underline"
                  onClick={() => setSelection({ kind: "page" })}
                >
                  Σελίδα
                </button>
              </div>
              <ul className="space-y-0.5">
                {draft.columns.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelection({ kind: "column", id: c.id })
                      }
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px]",
                        selection.kind === "column" && selection.id === c.id
                          ? "bg-teal-50 font-medium text-teal-900"
                          : "text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <span className="truncate text-slate-400">
                        {c.source}
                      </span>
                      <span className="truncate">{c.label || c.key}</span>
                      {c.hidden ? (
                        <span className="ml-auto text-[10px] text-slate-400">
                          hidden
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              {draft.columns.length === 0 ? (
                <p className="text-[11px] text-slate-400">Καμία στήλη</p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right: inspector */}
        <aside className="soft-panel max-h-[720px] space-y-3 overflow-y-auto p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Inspector
          </p>

          {selection.kind === "page" ? (
            <div className="space-y-2">
              <FieldInput label="Density">
                <select
                  className={inputCls}
                  value={draft.page?.density ?? "comfortable"}
                  onChange={(e) =>
                    patchPage({ density: e.target.value as ListDensity })
                  }
                >
                  <option value="compact">compact</option>
                  <option value="comfortable">comfortable</option>
                  <option value="detailed">detailed</option>
                </select>
              </FieldInput>
              <FieldInput label="Row click">
                <select
                  className={inputCls}
                  value={draft.page?.rowClick ?? "navigate"}
                  onChange={(e) =>
                    patchPage({ rowClick: e.target.value as ListRowClick })
                  }
                >
                  <option value="navigate">navigate</option>
                  <option value="peek">peek</option>
                  <option value="none">none</option>
                </select>
              </FieldInput>
              <FieldInput label="Peek form">
                <select
                  className={inputCls}
                  value={draft.page?.peekFormCode ?? ""}
                  onChange={(e) =>
                    patchPage({
                      peekFormCode: e.target.value || null,
                    })
                  }
                >
                  <option value="">—</option>
                  {formViews.map((fv) => (
                    <option key={fv.id} value={fv.code}>
                      {fv.name} ({fv.code})
                    </option>
                  ))}
                </select>
              </FieldInput>
              <FieldInput label="Edit form (peek edit)">
                <select
                  className={inputCls}
                  value={draft.page?.editFormCode ?? ""}
                  onChange={(e) =>
                    patchPage({
                      editFormCode: e.target.value || null,
                    })
                  }
                >
                  <option value="">— (ίδιο με peek)</option>
                  {formViews.map((fv) => (
                    <option key={fv.id} value={fv.code}>
                      {fv.name} ({fv.code})
                    </option>
                  ))}
                </select>
              </FieldInput>
              <FieldInput label="Kanban group by">
                <select
                  className={inputCls}
                  value={`${draft.page?.groupBySource ?? "system"}:${draft.page?.groupByKey ?? "status"}`}
                  onChange={(e) => {
                    const [source, key] = e.target.value.split(":") as [
                      "system" | "custom",
                      string,
                    ];
                    patchPage({ groupBySource: source, groupByKey: key });
                  }}
                >
                  {builtins
                    .filter((b) => b.listable)
                    .map((b) => (
                      <option key={`system:${b.key}`} value={`system:${b.key}`}>
                        {b.label} (system)
                      </option>
                    ))}
                  {customFields.map((f) => (
                    <option
                      key={`custom:${f.code}`}
                      value={`custom:${f.code}`}
                    >
                      {f.label} (custom)
                    </option>
                  ))}
                </select>
              </FieldInput>
              <FieldInput label="Empty title">
                <input
                  className={inputCls}
                  value={draft.page?.emptyTitle ?? ""}
                  onChange={(e) =>
                    patchPage({ emptyTitle: e.target.value || undefined })
                  }
                />
              </FieldInput>
              <FieldInput label="Empty CTA">
                <select
                  className={inputCls}
                  value={draft.page?.emptyCta ?? "none"}
                  onChange={(e) =>
                    patchPage({
                      emptyCta: e.target.value as
                        | "form_quick"
                        | "navigate_new"
                        | "none",
                    })
                  }
                >
                  <option value="none">none</option>
                  <option value="form_quick">form_quick</option>
                  <option value="navigate_new">navigate_new</option>
                </select>
              </FieldInput>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={draft.page?.showSearch ?? true}
                  onChange={(e) =>
                    patchPage({ showSearch: e.target.checked })
                  }
                />
                Show search
              </label>
              <FieldInput label="Mode">
                <select
                  className={inputCls}
                  value={draft.mode ?? "browse"}
                  onChange={(e) => {
                    const m = e.target.value as ListMode;
                    updateDraft({ ...draft, mode: m });
                    setPreviewMode(m);
                  }}
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </FieldInput>
              <FieldInput label="Lifecycle">
                <select
                  className={inputCls}
                  value={draft.lifecycle ?? "published"}
                  onChange={(e) =>
                    updateDraft({
                      ...draft,
                      lifecycle: e.target.value as "draft" | "published",
                    })
                  }
                >
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                </select>
              </FieldInput>
              <FieldInput label="Page size">
                <input
                  type="number"
                  min={1}
                  max={500}
                  className={inputCls}
                  value={draft.pageSize ?? 50}
                  onChange={(e) =>
                    updateDraft({
                      ...draft,
                      pageSize: Number(e.target.value) || 50,
                    })
                  }
                />
              </FieldInput>
            </div>
          ) : null}

          {/* Columns ordered list (always visible when page or column selected) */}
          {(selection.kind === "page" || selection.kind === "column") && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Στήλες
              </p>
              <ul className="space-y-1">
                {draft.columns.map((c, idx) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-1 rounded-lg border border-slate-100 px-1.5 py-1"
                  >
                    <button
                      type="button"
                      disabled={idx === 0}
                      className="text-slate-400 disabled:opacity-30"
                      onClick={() =>
                        updateDraft({
                          ...draft,
                          columns: moveItem(draft.columns, idx, -1),
                        })
                      }
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === draft.columns.length - 1}
                      className="text-slate-400 disabled:opacity-30"
                      onClick={() =>
                        updateDraft({
                          ...draft,
                          columns: moveItem(draft.columns, idx, 1),
                        })
                      }
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-[11px]",
                        selection.kind === "column" && selection.id === c.id
                          ? "font-medium text-teal-800"
                          : "",
                      )}
                      onClick={() =>
                        setSelection({ kind: "column", id: c.id })
                      }
                    >
                      {c.label || c.key}
                    </button>
                    <button
                      type="button"
                      className="text-rose-600"
                      onClick={() => removeColumn(c.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selection.kind === "column" && selectedColumn ? (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-[11px] text-slate-400">
                {selectedColumn.source}:{selectedColumn.key}
              </p>
              <FieldInput label="Ετικέτα">
                <input
                  className={inputCls}
                  value={selectedColumn.label ?? ""}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      label: e.target.value || undefined,
                    })
                  }
                />
              </FieldInput>
              <FieldInput label="Width">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedColumn.width ?? ""}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      width: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                />
              </FieldInput>
              <FieldInput label="Pin">
                <select
                  className={inputCls}
                  value={selectedColumn.pin ?? "none"}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      pin: e.target.value as ColumnPin,
                    })
                  }
                >
                  <option value="none">none</option>
                  <option value="left">left</option>
                  <option value="right">right</option>
                </select>
              </FieldInput>
              <FieldInput label="Align">
                <select
                  className={inputCls}
                  value={selectedColumn.align ?? "start"}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      align: e.target.value as ColumnAlign,
                    })
                  }
                >
                  <option value="start">start</option>
                  <option value="center">center</option>
                  <option value="end">end</option>
                </select>
              </FieldInput>
              <FieldInput label="Format">
                <select
                  className={inputCls}
                  value={selectedColumn.format ?? "default"}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      format: e.target.value as ListColumn["format"],
                    })
                  }
                >
                  <option value="default">default</option>
                  <option value="money">money</option>
                  <option value="date">date</option>
                  <option value="badge">badge</option>
                  <option value="boolean">boolean</option>
                </select>
              </FieldInput>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={selectedColumn.sortable !== false}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      sortable: e.target.checked,
                    })
                  }
                />
                Sortable
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={selectedColumn.filterable !== false}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      filterable: e.target.checked,
                    })
                  }
                />
                Filterable
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={selectedColumn.truncate !== false}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      truncate: e.target.checked,
                    })
                  }
                />
                Truncate
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!!selectedColumn.hidden}
                  onChange={(e) =>
                    patchColumn(selectedColumn.id, {
                      hidden: e.target.checked,
                    })
                  }
                />
                Hidden
              </label>
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-600"
                onClick={() => removeColumn(selectedColumn.id)}
              >
                <Trash2 size={12} /> Αφαίρεση στήλης
              </Button>
            </div>
          ) : null}

          {/* Filters */}
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Φίλτρα
            </p>
            <ul className="mb-2 space-y-2">
              {draft.filters.map((f) => (
                <li
                  key={f.id}
                  className={cn(
                    "space-y-1 rounded-lg border p-2 text-[10px]",
                    selection.kind === "filter" && selection.id === f.id
                      ? "border-teal-300 bg-teal-50/40"
                      : "border-slate-100",
                  )}
                >
                  <button
                    type="button"
                    className="mb-1 text-[10px] font-medium text-teal-700"
                    onClick={() =>
                      setSelection({ kind: "filter", id: f.id! })
                    }
                  >
                    Επεξεργασία
                  </button>
                  <div className="flex gap-1">
                    <select
                      className={inputCls}
                      value={`${f.source}:${f.key}`}
                      onChange={(e) => {
                        const [source, ...rest] = e.target.value.split(":");
                        patchFilter(f.id!, {
                          source: source as "system" | "custom",
                          key: rest.join(":"),
                        });
                      }}
                    >
                      {fieldOptions}
                    </select>
                    <select
                      className={inputCls}
                      value={f.op}
                      onChange={(e) =>
                        patchFilter(f.id!, {
                          op: e.target.value as ListFilterOp,
                        })
                      }
                    >
                      {FILTER_OPS.map((op) => (
                        <option key={op} value={op}>
                          {FILTER_OP_LABELS[op]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    className={inputCls}
                    placeholder="value"
                    value={f.value == null ? "" : String(f.value)}
                    onChange={(e) =>
                      patchFilter(f.id!, {
                        value: e.target.value || null,
                      })
                    }
                  />
                  <label className="flex items-center gap-2 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={f.interactive !== false}
                      onChange={(e) =>
                        patchFilter(f.id!, {
                          interactive: e.target.checked,
                        })
                      }
                    />
                    Interactive
                  </label>
                  <button
                    type="button"
                    className="text-rose-600"
                    onClick={() => {
                      updateDraft({
                        ...draft,
                        filters: draft.filters.filter((x) => x.id !== f.id),
                      });
                      if (
                        selection.kind === "filter" &&
                        selection.id === f.id
                      ) {
                        setSelection({ kind: "page" });
                      }
                    }}
                  >
                    Αφαίρεση
                  </button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={addFilter}
            >
              <Plus size={12} /> Φίλτρο
            </Button>
          </div>

          {/* Sorts */}
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Ταξινόμηση
            </p>
            <ul className="mb-2 space-y-2">
              {sorts.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "space-y-1 rounded-lg border p-2 text-[10px]",
                    selection.kind === "sort" && selection.id === s.id
                      ? "border-teal-300 bg-teal-50/40"
                      : "border-slate-100",
                  )}
                >
                  <div className="flex gap-1">
                    <select
                      className={inputCls}
                      value={`${s.source}:${s.key}`}
                      onChange={(e) => {
                        const [source, ...rest] = e.target.value.split(":");
                        patchSort(s.id!, {
                          source: source as "system" | "custom",
                          key: rest.join(":"),
                        });
                      }}
                    >
                      {fieldOptions}
                    </select>
                    <select
                      className={inputCls}
                      value={s.dir}
                      onChange={(e) =>
                        patchSort(s.id!, {
                          dir: e.target.value as "asc" | "desc",
                        })
                      }
                    >
                      <option value="asc">asc</option>
                      <option value="desc">desc</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="text-rose-600"
                    onClick={() => {
                      writeSorts(sorts.filter((x) => x.id !== s.id));
                      if (
                        selection.kind === "sort" &&
                        selection.id === s.id
                      ) {
                        setSelection({ kind: "page" });
                      }
                    }}
                  >
                    Αφαίρεση
                  </button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={addSort}
            >
              <Plus size={12} /> Sort
            </Button>
          </div>

          {/* Row actions */}
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Row actions
            </p>
            <ul className="mb-2 space-y-2">
              {(draft.rowActions ?? []).map((a) => (
                <li
                  key={a.id}
                  className={cn(
                    "space-y-1 rounded-lg border p-2 text-[10px]",
                    selection.kind === "rowAction" && selection.id === a.id
                      ? "border-teal-300 bg-teal-50/40"
                      : "border-slate-100",
                  )}
                >
                  <input
                    className={inputCls}
                    value={a.label}
                    onChange={(e) =>
                      updateDraft({
                        ...draft,
                        rowActions: (draft.rowActions ?? []).map((x) =>
                          x.id === a.id
                            ? { ...x, label: e.target.value }
                            : x,
                        ),
                      })
                    }
                  />
                  <select
                    className={inputCls}
                    value={a.type}
                    onChange={(e) =>
                      updateDraft({
                        ...draft,
                        rowActions: (draft.rowActions ?? []).map((x) =>
                          x.id === a.id
                            ? {
                                ...x,
                                type: e.target.value as ListRowAction["type"],
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    {ROW_ACTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputCls}
                    value={a.formCode ?? ""}
                    onChange={(e) =>
                      updateDraft({
                        ...draft,
                        rowActions: (draft.rowActions ?? []).map((x) =>
                          x.id === a.id
                            ? {
                                ...x,
                                formCode: e.target.value || undefined,
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="">formCode —</option>
                    {formViews.map((fv) => (
                      <option key={fv.id} value={fv.code}>
                        {fv.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-rose-600"
                    onClick={() =>
                      updateDraft({
                        ...draft,
                        rowActions: (draft.rowActions ?? []).filter(
                          (x) => x.id !== a.id,
                        ),
                      })
                    }
                  >
                    Αφαίρεση
                  </button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={addRowAction}
            >
              <Plus size={12} /> Row action
            </Button>
          </div>

          {/* Bulk actions */}
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Bulk actions
            </p>
            <ul className="mb-2 space-y-2">
              {(draft.bulkActions ?? []).map((a) => (
                <li
                  key={a.id}
                  className="space-y-1 rounded-lg border border-slate-100 p-2 text-[10px]"
                >
                  <input
                    className={inputCls}
                    value={a.label}
                    onChange={(e) =>
                      updateDraft({
                        ...draft,
                        bulkActions: (draft.bulkActions ?? []).map((x) =>
                          x.id === a.id
                            ? { ...x, label: e.target.value }
                            : x,
                        ),
                      })
                    }
                  />
                  <select
                    className={inputCls}
                    value={a.type}
                    onChange={(e) =>
                      updateDraft({
                        ...draft,
                        bulkActions: (draft.bulkActions ?? []).map((x) =>
                          x.id === a.id
                            ? {
                                ...x,
                                type: e.target
                                  .value as ListBulkAction["type"],
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    {BULK_ACTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-rose-600"
                    onClick={() =>
                      updateDraft({
                        ...draft,
                        bulkActions: (draft.bulkActions ?? []).filter(
                          (x) => x.id !== a.id,
                        ),
                      })
                    }
                  >
                    Αφαίρεση
                  </button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={addBulkAction}
            >
              <Plus size={12} /> Bulk action
            </Button>
          </div>

          {/* Rules */}
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Κανόνες
            </p>
            <ul className="mb-2 space-y-2">
              {(draft.rules ?? []).map((r, idx) => {
                const rules = draft.rules ?? [];
                return (
                  <li
                    key={r.id}
                    className="space-y-1 rounded-lg border border-slate-100 p-2 text-[10px]"
                  >
                    <div className="flex gap-1">
                      <select
                        className={inputCls}
                        value={`${r.when.source}:${r.when.key}`}
                        onChange={(e) => {
                          const [source, ...rest] = e.target.value.split(":");
                          const next = [...rules];
                          next[idx] = {
                            ...r,
                            when: {
                              ...r.when,
                              source: source as "system" | "custom",
                              key: rest.join(":"),
                            },
                          };
                          updateDraft({ ...draft, rules: next });
                        }}
                      >
                        {fieldOptions}
                      </select>
                      <select
                        className={inputCls}
                        value={r.when.op}
                        onChange={(e) => {
                          const next = [...rules];
                          next[idx] = {
                            ...r,
                            when: {
                              ...r.when,
                              op: e.target.value as ListFilterOp,
                            },
                          };
                          updateDraft({ ...draft, rules: next });
                        }}
                      >
                        {FILTER_OPS.map((op) => (
                          <option key={op} value={op}>
                            {FILTER_OP_LABELS[op]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      className={inputCls}
                      placeholder="value"
                      value={
                        r.when.value == null ? "" : String(r.when.value)
                      }
                      onChange={(e) => {
                        const next = [...rules];
                        next[idx] = {
                          ...r,
                          when: {
                            ...r.when,
                            value: e.target.value || null,
                          },
                        };
                        updateDraft({ ...draft, rules: next });
                      }}
                    />
                    <select
                      className={inputCls}
                      value={r.then.action}
                      onChange={(e) => {
                        const next = [...rules];
                        next[idx] = {
                          ...r,
                          then: {
                            ...r.then,
                            action: e.target
                              .value as ListRule["then"]["action"],
                          },
                        };
                        updateDraft({ ...draft, rules: next });
                      }}
                    >
                      {RULE_ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    {(r.then.action === "hide_column" ||
                      r.then.action === "show_column" ||
                      r.then.action === "hide_action") && (
                      <select
                        className={inputCls}
                        value={r.then.targetId ?? ""}
                        onChange={(e) => {
                          const next = [...rules];
                          next[idx] = {
                            ...r,
                            then: {
                              ...r.then,
                              targetId: e.target.value || undefined,
                            },
                          };
                          updateDraft({ ...draft, rules: next });
                        }}
                      >
                        <option value="">target —</option>
                        {r.then.action === "hide_action"
                          ? (draft.rowActions ?? []).map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.label}
                              </option>
                            ))
                          : draft.columns.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label || c.key}
                              </option>
                            ))}
                      </select>
                    )}
                    {r.then.action === "row_tone" ? (
                      <select
                        className={inputCls}
                        value={r.then.tone ?? "warning"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[idx] = {
                            ...r,
                            then: {
                              ...r.then,
                              tone: e.target.value as ListRule["then"]["tone"],
                            },
                          };
                          updateDraft({ ...draft, rules: next });
                        }}
                      >
                        <option value="danger">danger</option>
                        <option value="warning">warning</option>
                        <option value="success">success</option>
                        <option value="muted">muted</option>
                      </select>
                    ) : null}
                    {r.then.action === "show_badge" ? (
                      <input
                        className={inputCls}
                        placeholder="badge text"
                        value={r.then.badge ?? ""}
                        onChange={(e) => {
                          const next = [...rules];
                          next[idx] = {
                            ...r,
                            then: {
                              ...r.then,
                              badge: e.target.value || undefined,
                            },
                          };
                          updateDraft({ ...draft, rules: next });
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="text-rose-600"
                      onClick={() =>
                        updateDraft({
                          ...draft,
                          rules: rules.filter((_, i) => i !== idx),
                        })
                      }
                    >
                      Αφαίρεση κανόνα
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={addRule}
            >
              <Plus size={12} /> Κανόνας
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
