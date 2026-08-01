"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Table2,
} from "lucide-react";
import { SoftifyApexChart } from "./apex-chart";
import type {
  ReportColumnType,
  ReportResult,
  ReportTable,
  ReportTableColumn,
} from "./engine";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { toast } from "@/shared/ui/toaster";

function formatCell(
  v: string | number | null | undefined,
  type?: ReportColumnType,
) {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    if (type === "currency") {
      return v.toLocaleString("el-GR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 2,
      });
    }
    if (type === "percent") {
      return `${v.toLocaleString("el-GR", { maximumFractionDigits: 2 })}%`;
    }
    if (type === "int") {
      return Math.round(v).toLocaleString("el-GR");
    }
    return Number.isInteger(v)
      ? v.toLocaleString("el-GR")
      : v.toLocaleString("el-GR", { maximumFractionDigits: 3 });
  }
  return String(v);
}

function exportCsv(table: ReportTable, filename: string) {
  if (!table.rows.length) {
    toast.error("Δεν υπάρχουν δεδομένα");
    return;
  }
  const keys = table.columns.map((c) => c.key);
  const header = table.columns.map((c) => c.label);
  const lines = [
    header.map((h) => `"${h.replace(/"/g, '""')}"`).join(","),
    ...table.rows.map((r) =>
      keys
        .map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];
  if (table.totals) {
    lines.push(
      keys
        .map((k) => `"${String(table.totals![k] ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Εξαγωγή CSV");
}

function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "el", { numeric: true });
}

function AdvancedReportGrid({
  table,
  compact,
}: {
  table: ReportTable;
  compact?: boolean;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const pageSize = compact ? 8 : (table.pageSize ?? 25);

  const columns = table.columns;

  const sorted = useMemo(() => {
    if (!sortKey) return table.rows;
    const col = columns.find((c) => c.key === sortKey);
    const copy = [...table.rows];
    copy.sort((ra, rb) => {
      const cmp = compareValues(ra[sortKey], rb[sortKey]);
      return sortDir === "asc" ? cmp : -cmp;
    });
    void col;
    return copy;
  }, [table.rows, sortKey, sortDir, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  );

  function toggleSort(col: ReportTableColumn) {
    if (col.sortable === false) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir(
        col.type === "currency" ||
          col.type === "number" ||
          col.type === "int" ||
          col.type === "percent"
          ? "desc"
          : "asc",
      );
    }
    setPage(0);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
          <Table2 size={14} className="text-teal-700" />
          Grid · {sorted.length.toLocaleString("el-GR")} γραμμές
        </span>
        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md border border-slate-200 p-1 disabled:opacity-30"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-[4.5rem] text-center tabular-nums">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="rounded-md border border-slate-200 p-1 disabled:opacity-30"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {columns.map((c) => {
                const align =
                  c.align === "end"
                    ? "text-right"
                    : c.align === "center"
                      ? "text-center"
                      : "text-left";
                const sortable = c.sortable !== false;
                return (
                  <th
                    key={c.key}
                    className={cn("px-3 py-2 font-medium", align)}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c)}
                        className="inline-flex items-center gap-1 hover:text-teal-800"
                      >
                        {c.label}
                        {sortKey === c.key ? (
                          sortDir === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          )
                        ) : (
                          <ArrowUpDown size={11} className="opacity-40" />
                        )}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => (
              <tr
                key={idx}
                className="border-t border-slate-100 odd:bg-white even:bg-slate-50/40"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2 text-slate-700",
                      (c.type === "currency" ||
                        c.type === "number" ||
                        c.type === "int" ||
                        c.type === "percent" ||
                        c.align === "end") &&
                        "text-right tabular-nums",
                      c.align === "center" && "text-center",
                    )}
                  >
                    {formatCell(row[c.key], c.type)}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-slate-400"
                >
                  Δεν υπάρχουν γραμμές
                </td>
              </tr>
            ) : null}
          </tbody>
          {table.totals ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-teal-50/60 text-sm font-semibold text-ink-950">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2",
                      (c.type === "currency" ||
                        c.type === "number" ||
                        c.type === "int" ||
                        c.type === "percent" ||
                        c.align === "end") &&
                        "text-right tabular-nums",
                    )}
                  >
                    {table.totals![c.key] != null
                      ? formatCell(table.totals![c.key], c.type)
                      : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

export function ReportResultPanel({
  result,
  compact,
}: {
  result: ReportResult;
  compact?: boolean;
}) {
  const presentation =
    result.presentation ??
    (result.chart?.type === "table" || !result.chart
      ? "table"
      : result.table?.rows?.length
        ? "both"
        : "chart");

  const showChart =
    presentation !== "table" &&
    result.chart &&
    result.chart.type !== "table";
  const showGrid =
    presentation !== "chart" && Boolean(result.table?.rows?.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink-950">{result.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {result.periodLabel}
            {result.description ? ` · ${result.description}` : ""}
            {presentation === "table" ? " · Grid" : ""}
          </p>
        </div>
        {result.table?.rows?.length ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              exportCsv(
                result.table!,
                `${result.id}-${new Date().toISOString().slice(0, 10)}.csv`,
              )
            }
          >
            <Download size={14} /> CSV
          </Button>
        ) : null}
      </div>

      {result.kpis?.length ? (
        <div
          className={`grid gap-2 ${compact ? "grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}
        >
          {result.kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {k.label}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink-950">
                {k.value}
              </p>
              {k.hint ? (
                <p className="text-[11px] text-amber-700">{k.hint}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {showChart ? (
        <SoftifyApexChart
          chart={result.chart!}
          height={compact ? 240 : 320}
        />
      ) : null}

      {showGrid && result.table ? (
        <AdvancedReportGrid table={result.table} compact={compact} />
      ) : null}

      {!showChart && !showGrid ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400">
          Δεν υπάρχουν δεδομένα για εμφάνιση.
        </p>
      ) : null}
    </div>
  );
}
