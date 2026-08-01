"use client";

import { Download } from "lucide-react";
import { SoftifyApexChart } from "./apex-chart";
import type { ReportResult } from "./engine";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";

function formatCell(v: string | number | null | undefined) {
  if (v == null) return "—";
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? v.toLocaleString("el-GR")
      : v.toLocaleString("el-GR", { maximumFractionDigits: 2 });
  }
  return v;
}

function exportCsv(
  rows: Array<Record<string, string | number | null>>,
  filename: string,
) {
  if (!rows.length) {
    toast.error("Δεν υπάρχουν δεδομένα");
    return;
  }
  const keys = Object.keys(rows[0]!);
  const lines = [
    keys.join(","),
    ...rows.map((r) =>
      keys
        .map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
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

export function ReportResultPanel({
  result,
  compact,
}: {
  result: ReportResult;
  compact?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink-950">{result.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {result.periodLabel}
            {result.description ? ` · ${result.description}` : ""}
          </p>
        </div>
        {result.table?.rows?.length ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              exportCsv(
                result.table!.rows,
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

      <SoftifyApexChart chart={result.chart} height={compact ? 240 : 320} />

      {!compact && result.table?.rows?.length ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {result.table.columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.table.rows.slice(0, 50).map((row, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  {result.table!.columns.map((c) => (
                    <td
                      key={c.key}
                      className="px-3 py-2 tabular-nums text-slate-700"
                    >
                      {formatCell(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
