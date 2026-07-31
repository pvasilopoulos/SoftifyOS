"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import type { BuiltinField } from "./registry";
import type { CustomFieldDef } from "./dynamic-ui";
import {
  applyListConfig,
  formatFieldValue,
  type CustomFieldsMap,
  type ListViewConfig,
} from "./types";
import {
  normalizeListConfig,
  visibleColumns,
  type ListColumn,
} from "./list-experience-types";
import { evaluateListRules, rowToneClass } from "./list-rules";

function colLabel(
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

function cellText(
  col: ListColumn,
  row: Record<string, unknown>,
  builtins: BuiltinField[],
  customDefs: CustomFieldDef[],
) {
  const cf = (row.customFields ?? {}) as CustomFieldsMap;
  const raw = col.source === "custom" ? cf[col.key] : row[col.key];
  const builtin = builtins.find((b) => b.key === col.key);
  const custom = customDefs.find((d) => d.code === col.key);
  const type =
    col.format === "money"
      ? "money"
      : col.format === "date"
        ? "date"
        : col.format === "boolean"
          ? "BOOLEAN"
          : col.source === "system"
            ? builtin?.type
            : custom?.type;
  return formatFieldValue(raw, type);
}

function densityPad(density?: string) {
  if (density === "compact") return "px-3 py-1.5";
  if (density === "detailed") return "px-4 py-4";
  return "px-4 py-3";
}

function exportCsv(
  rows: Array<Record<string, unknown>>,
  columns: ListColumn[],
  builtins: BuiltinField[],
  customDefs: CustomFieldDef[],
) {
  const header = columns.map((c) => colLabel(c, builtins, customDefs));
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      columns
        .map((c) => {
          const t = cellText(c, row, builtins, customDefs).replace(/"/g, '""');
          return `"${t}"`;
        })
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ListExperienceRenderer({
  config: rawConfig,
  builtins,
  customDefs,
  rows,
  hrefForRow,
  onPeek,
  onQuickCreate,
  onNavigateNew,
  emptyActionLabel,
}: {
  config: ListViewConfig;
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
  rows: Array<Record<string, unknown> & { id: string }>;
  hrefForRow: (row: Record<string, unknown> & { id: string }) => string;
  onPeek?: (row: Record<string, unknown> & { id: string }) => void;
  onQuickCreate?: () => void;
  onNavigateNew?: () => void;
  emptyActionLabel?: string;
}) {
  const config = useMemo(() => normalizeListConfig(rawConfig), [rawConfig]);
  const mode = config.mode ?? "browse";
  const density = config.page?.density ?? "comfortable";
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visibleRows = useMemo(
    () => applyListConfig(rows, config),
    [rows, config],
  );

  const rulesEval = useMemo(
    () => evaluateListRules(config, visibleRows),
    [config, visibleRows],
  );

  const columns = useMemo(
    () => visibleColumns(config, rulesEval.hiddenColumns),
    [config, rulesEval.hiddenColumns],
  );

  const selectMode = mode === "select" || (config.bulkActions?.length ?? 0) > 0;
  const isCards = mode === "cards";

  function toggleAll() {
    if (selected.size === visibleRows.length) setSelected(new Set());
    else setSelected(new Set(visibleRows.map((r) => r.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(type: string) {
    const picked = visibleRows.filter((r) => selected.has(r.id));
    if (type === "export_csv") {
      exportCsv(picked.length ? picked : visibleRows, columns, builtins, customDefs);
    }
  }

  function handleRowClick(row: Record<string, unknown> & { id: string }) {
    const click = config.page?.rowClick ?? "navigate";
    if (click === "none") return;
    if (click === "peek" && onPeek) {
      onPeek(row);
      return;
    }
  }

  if (visibleRows.length === 0) {
    return (
      <div className="soft-panel px-4 py-12 text-center">
        <p className="text-sm font-medium text-ink-950">
          {config.page?.emptyTitle || "Δεν βρέθηκαν εγγραφές"}
        </p>
        {config.page?.emptyDescription ? (
          <p className="mt-1 text-xs text-slate-500">
            {config.page.emptyDescription}
          </p>
        ) : null}
        <div className="mt-4 flex justify-center gap-2">
          {config.page?.emptyCta === "form_quick" && onQuickCreate ? (
            <Button size="sm" onClick={onQuickCreate}>
              {emptyActionLabel || "Γρήγορη καταχώριση"}
            </Button>
          ) : null}
          {config.page?.emptyCta === "navigate_new" && onNavigateNew ? (
            <Button size="sm" onClick={onNavigateNew}>
              {emptyActionLabel || "Νέα εγγραφή"}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {selectMode && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm">
          <span className="font-medium text-teal-900">
            {selected.size} επιλεγμένα
          </span>
          {(config.bulkActions ?? []).map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant="secondary"
              onClick={() => runBulk(a.type)}
            >
              {a.label}
            </Button>
          ))}
          <button
            type="button"
            className="text-xs text-teal-700 underline"
            onClick={() => setSelected(new Set())}
          >
            Καθαρισμός
          </button>
        </div>
      ) : null}

      {isCards ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleRows.map((row) => {
            const st = rulesEval.rows.get(row.id);
            const href = hrefForRow(row);
            return (
              <div
                key={row.id}
                className={cn(
                  "soft-panel space-y-2 p-4",
                  rowToneClass(st?.tone),
                )}
              >
                <Link href={href} className="block space-y-1.5">
                  {columns.slice(0, 4).map((col) => (
                    <div key={col.id} className="text-sm">
                      <span className="text-[10px] uppercase text-slate-400">
                        {colLabel(col, builtins, customDefs)}{" "}
                      </span>
                      <span
                        className={cn(
                          col.pin === "left" && "font-semibold text-ink-950",
                          "text-slate-700",
                        )}
                      >
                        {cellText(col, row, builtins, customDefs)}
                      </span>
                    </div>
                  ))}
                </Link>
                {st?.badges?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {st.badges.map((b) => (
                      <Badge key={b} tone="amber">
                        {b}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <RowActions
                  config={config}
                  row={row}
                  hidden={st?.hiddenActions}
                  href={href}
                  onPeek={onPeek}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <section className="soft-panel overflow-hidden">
          <div
            className="hidden border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:items-center md:gap-3"
            style={{
              gridTemplateColumns: gridCols(columns, selectMode),
            }}
          >
            {selectMode ? (
              <div className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={
                    visibleRows.length > 0 &&
                    selected.size === visibleRows.length
                  }
                  onChange={toggleAll}
                />
              </div>
            ) : null}
            {columns.map((col) => (
              <span
                key={col.id}
                className={cn(
                  "px-2 py-2.5",
                  col.align === "end" && "text-right",
                  col.align === "center" && "text-center",
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {colLabel(col, builtins, customDefs)}
              </span>
            ))}
            <span className="px-2 py-2.5 text-right">Ενέργειες</span>
          </div>

          <ul className="divide-y divide-slate-100">
            {visibleRows.map((row) => {
              const st = rulesEval.rows.get(row.id);
              const href = hrefForRow(row);
              const click = config.page?.rowClick ?? "navigate";
              const pad = densityPad(density);
              const inner = (
                <>
                  {columns.map((col, idx) => (
                    <div
                      key={col.id}
                      className={cn(
                        "text-sm",
                        idx === 0 || col.pin === "left"
                          ? "font-medium text-ink-950"
                          : "text-slate-600",
                        col.align === "end" && "md:text-right",
                        col.truncate && "truncate",
                      )}
                    >
                      <span className="text-[10px] uppercase text-slate-400 md:hidden">
                        {colLabel(col, builtins, customDefs)}{" "}
                      </span>
                      {cellText(col, row, builtins, customDefs)}
                    </div>
                  ))}
                </>
              );

              return (
                <li
                  key={row.id}
                  className={cn("soft-row", rowToneClass(st?.tone))}
                >
                  <div
                    className={cn("grid w-full items-center gap-2 md:gap-3", pad)}
                    style={{
                      gridTemplateColumns: gridCols(columns, selectMode),
                    }}
                  >
                    {selectMode ? (
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                      />
                    ) : null}
                    {click === "navigate" ? (
                      <Link
                        href={href}
                        className="contents hover:opacity-90"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="contents text-left"
                        onClick={() => handleRowClick(row)}
                      >
                        {inner}
                      </button>
                    )}
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {st?.badges?.map((b) => (
                        <Badge key={b} tone="amber">
                          {b}
                        </Badge>
                      ))}
                      <RowActions
                        config={config}
                        row={row}
                        hidden={st?.hiddenActions}
                        href={href}
                        onPeek={onPeek}
                        compact
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function gridCols(columns: ListColumn[], selectMode: boolean) {
  const parts = [
    ...(selectMode ? ["28px"] : []),
    ...columns.map((c) =>
      c.width ? `${c.width}px` : "minmax(0, 1fr)",
    ),
    "120px",
  ];
  return parts.join(" ");
}

function RowActions({
  config,
  row,
  hidden,
  href,
  onPeek,
  compact,
}: {
  config: ListViewConfig;
  row: Record<string, unknown> & { id: string };
  hidden?: Set<string>;
  href: string;
  onPeek?: (row: Record<string, unknown> & { id: string }) => void;
  compact?: boolean;
}) {
  const actions = (config.rowActions ?? []).filter(
    (a) => !hidden?.has(a.id),
  );
  if (actions.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", compact && "justify-end")}>
      {actions.map((a) => {
        if (a.type === "navigate") {
          return (
            <Link
              key={a.id}
              href={href}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-50"
            >
              {a.label}
            </Link>
          );
        }
        if (
          (a.type === "form_peek" || a.type === "form_edit") &&
          onPeek
        ) {
          return (
            <button
              key={a.id}
              type="button"
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => onPeek(row)}
            >
              {a.label}
            </button>
          );
        }
        return (
          <span
            key={a.id}
            className="rounded-lg px-2 py-1 text-[11px] text-slate-400"
          >
            {a.label}
          </span>
        );
      })}
    </div>
  );
}
