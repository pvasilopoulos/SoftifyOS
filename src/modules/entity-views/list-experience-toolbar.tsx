"use client";

import { useMemo, useState } from "react";
import {
  Columns3,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import type {
  ListColumn,
  ListDensity,
  ListFilter,
  ListMode,
  ListViewConfig,
} from "@/modules/entity-views/list-experience-types";
import type { BuiltinField } from "@/modules/entity-views/registry";
import type { CustomFieldDef } from "@/modules/entity-views/dynamic-ui";

export type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";

export type ListToolbarView = {
  id: string;
  code: string;
  name: string;
  isDefault?: boolean;
};

function columnLabel(
  col: ListColumn,
  builtins: BuiltinField[],
  customDefs: CustomFieldDef[],
) {
  if (col.label) return col.label;
  if (col.source === "system") {
    return builtins.find((b) => b.key === col.key)?.label ?? col.key;
  }
  return customDefs.find((d) => d.code === col.key)?.label ?? col.key;
}

function filterLabel(
  f: ListFilter,
  builtins: BuiltinField[],
  customDefs: CustomFieldDef[],
) {
  const field =
    f.source === "system"
      ? builtins.find((b) => b.key === f.key)?.label ?? f.key
      : customDefs.find((d) => d.code === f.key)?.label ?? f.key;
  const opMap: Record<string, string> = {
    eq: "=",
    neq: "≠",
    contains: "περιέχει",
    empty: "κενό",
    not_empty: "συμπληρωμένο",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
  };
  const op = opMap[f.op] ?? f.op;
  if (f.op === "empty" || f.op === "not_empty") return `${field} ${op}`;
  return `${field} ${op} ${String(f.value ?? "")}`;
}

const MODE_META: Partial<
  Record<ListMode, { label: string; icon: typeof List }>
> = {
  browse: { label: "Πίνακας", icon: List },
  select: { label: "Επιλογή", icon: List },
  compact: { label: "Compact", icon: List },
  peek: { label: "Peek", icon: List },
  cards: { label: "Κάρτες", icon: LayoutGrid },
  kanban: { label: "Kanban", icon: LayoutGrid },
};

export function ListExperienceToolbar({
  q,
  onQChange,
  onSearch,
  showSearch = true,
  searchPlaceholder = "Αναζήτηση…",
  views,
  viewId,
  onViewChange,
  status,
  onStatusChange,
  showStatusFilter = true,
  density,
  onDensityChange,
  config,
  builtins,
  customDefs,
  hiddenKeys,
  onHiddenKeysChange,
  interactiveFilters,
  onInteractiveFilterChange,
  onClearFilters,
  resultCount,
  totalLoaded,
  ms,
  pending,
  extraActions,
}: {
  q: string;
  onQChange: (v: string) => void;
  onSearch: () => void;
  showSearch?: boolean;
  searchPlaceholder?: string;
  views: ListToolbarView[];
  viewId: string;
  onViewChange: (id: string) => void;
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  showStatusFilter?: boolean;
  density: ListDensity;
  onDensityChange: (d: ListDensity) => void;
  config: ListViewConfig;
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
  hiddenKeys: Set<string>;
  onHiddenKeysChange: (next: Set<string>) => void;
  /** Runtime overrides for interactive filters (key → value or null to clear) */
  interactiveFilters: Record<string, string | null>;
  onInteractiveFilterChange: (key: string, value: string | null) => void;
  onClearFilters: () => void;
  resultCount: number;
  totalLoaded: number;
  ms: number;
  pending?: boolean;
  extraActions?: React.ReactNode;
}) {
  const [colsOpen, setColsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const mode = config.mode ?? "browse";
  const modeMeta = MODE_META[mode];
  const ModeIcon = modeMeta?.icon ?? List;

  const allColumns = config.columns ?? [];
  const filterableCols = useMemo(
    () =>
      allColumns.filter(
        (c) => c.filterable !== false && !c.hidden && c.key !== "id",
      ),
    [allColumns],
  );

  const viewLockedFilters = (config.filters ?? []).filter(
    (f) => f.interactive === false || f.key === "status",
  );
  const interactiveDefs = (config.filters ?? []).filter(
    (f) => f.interactive !== false && f.key !== "status",
  );

  const activeChipCount =
    (status !== "ALL" ? 1 : 0) +
    (q.trim() ? 1 : 0) +
    Object.values(interactiveFilters).filter((v) => v != null && v !== "")
      .length;

  const hasActiveFilters = activeChipCount > 0 || viewLockedFilters.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {showSearch ? (
          <label className="soft-surface flex flex-1 items-center gap-2 px-3 py-2.5">
            <Search size={16} className="shrink-0 text-slate-400" />
            <input
              value={q}
              onChange={(e) => onQChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearch();
              }}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none"
            />
            {q ? (
              <button
                type="button"
                className="rounded p-0.5 text-slate-400 hover:text-ink-900"
                onClick={() => {
                  onQChange("");
                  queueMicrotask(onSearch);
                }}
                aria-label="Καθαρισμός αναζήτησης"
              >
                <X size={14} />
              </button>
            ) : null}
          </label>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <ViewSwitcher
            label="Λίστα"
            views={views}
            value={viewId}
            onChange={onViewChange}
          />
          <span
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200/80 bg-white/80 px-2 text-xs text-slate-500"
            title={modeMeta?.label ?? mode}
          >
            <ModeIcon size={12} />
            <span className="hidden sm:inline">{modeMeta?.label ?? mode}</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={onSearch}
            disabled={pending}
          >
            Αναζήτηση
          </Button>
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFiltersOpen((v) => !v);
                setColsOpen(false);
              }}
            >
              <SlidersHorizontal size={14} />
              Φίλτρα
              {activeChipCount > 0 ? (
                <span className="ml-1 rounded-full bg-teal-600 px-1.5 text-[10px] text-white">
                  {activeChipCount}
                </span>
              ) : null}
            </Button>
            {filtersOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Γρήγορα φίλτρα
                </p>
                {filterableCols
                  .filter((c) =>
                    ["email", "phone", "vatNumber", "name"].includes(c.key),
                  )
                  .map((col) => {
                    const key = `${col.source}:${col.key}`;
                    const current = interactiveFilters[key];
                    return (
                      <div key={key} className="mb-2">
                        <p className="mb-1 text-xs text-slate-500">
                          {columnLabel(col, builtins, customDefs)}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(
                            [
                              [null, "Όλα"],
                              ["not_empty", "Συμπληρωμένο"],
                              ["empty", "Κενό"],
                            ] as const
                          ).map(([val, label]) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() =>
                                onInteractiveFilterChange(key, val)
                              }
                              className={cn(
                                "rounded-lg border px-2 py-1 text-[11px]",
                                current === val || (val === null && current == null)
                                  ? "border-ink-900 bg-ink-900 text-white"
                                  : "border-slate-200 text-slate-600 hover:border-slate-300",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                {interactiveDefs.map((f) => {
                  const key = `${f.source}:${f.key}:${f.op}`;
                  return (
                    <p key={key} className="text-xs text-slate-500">
                      Προβολή: {filterLabel(f, builtins, customDefs)}
                    </p>
                  );
                })}
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-teal-700 hover:underline"
                  onClick={() => {
                    onClearFilters();
                    setFiltersOpen(false);
                  }}
                >
                  Καθαρισμός φίλτρων
                </button>
              </div>
            ) : null}
          </div>

          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setColsOpen((v) => !v);
                setFiltersOpen(false);
              }}
            >
              <Columns3 size={14} />
              Στήλες
            </Button>
            {colsOpen ? (
              <div className="absolute right-0 z-30 mt-1 max-h-72 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {allColumns.map((col) => {
                  const id = `${col.source}:${col.key}`;
                  const checked = !hiddenKeys.has(id) && !col.hidden;
                  return (
                    <label
                      key={col.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = new Set(hiddenKeys);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          onHiddenKeysChange(next);
                        }}
                      />
                      <span className="truncate">
                        {columnLabel(col, builtins, customDefs)}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white">
            {(
              [
                ["compact", "Compact"],
                ["comfortable", "Normal"],
                ["detailed", "Loose"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onDensityChange(value)}
                className={cn(
                  "px-2.5 py-1.5 text-[11px] font-medium",
                  density === value
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {extraActions}
          <Badge tone={ms < 200 ? "emerald" : "amber"}>{ms} ms</Badge>
        </div>
      </div>

      {showStatusFilter ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["ALL", "Όλοι"],
              ["ACTIVE", "Ενεργοί"],
              ["INACTIVE", "Ανενεργοί"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onStatusChange(value)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                status === value
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink-900",
              )}
            >
              {label}
            </button>
          ))}

          {hasActiveFilters ? (
            <div className="ml-1 flex flex-wrap items-center gap-1.5 border-l border-slate-200 pl-2">
              {q.trim() ? (
                <ActiveChip
                  label={`Αναζήτηση: ${q.trim()}`}
                  onClear={() => {
                    onQChange("");
                    queueMicrotask(onSearch);
                  }}
                />
              ) : null}
              {status !== "ALL" ? (
                <ActiveChip
                  label={status === "ACTIVE" ? "Ενεργοί" : "Ανενεργοί"}
                  onClear={() => onStatusChange("ALL")}
                />
              ) : null}
              {Object.entries(interactiveFilters).map(([key, val]) => {
                if (val == null) return null;
                const [, field] = key.split(":");
                return (
                  <ActiveChip
                    key={key}
                    label={`${field}: ${val === "empty" ? "κενό" : "συμπληρωμένο"}`}
                    onClear={() => onInteractiveFilterChange(key, null)}
                  />
                );
              })}
              {viewLockedFilters
                .filter((f) => f.key !== "status" || status === "ALL")
                .map((f, i) => (
                  <span
                    key={`${f.key}-${i}`}
                    className="rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] text-teal-800"
                  >
                    Προβολή · {filterLabel(f, builtins, customDefs)}
                  </span>
                ))}
              {activeChipCount > 0 ? (
                <button
                  type="button"
                  className="text-xs font-medium text-slate-500 hover:text-ink-900"
                  onClick={onClearFilters}
                >
                  Καθαρισμός
                </button>
              ) : null}
            </div>
          ) : null}

          <span className="ml-auto text-xs text-slate-500">
            {resultCount} εμφανίζονται
            {totalLoaded !== resultCount ? ` · ${totalLoaded} φορτωμένα` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ActiveChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
        aria-label="Αφαίρεση"
      >
        <X size={12} />
      </button>
    </span>
  );
}
