"use client";

import { useMemo, useState, useTransition } from "react";
import {
  BarChart3,
  Layers3,
  Loader2,
  Play,
  Sparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import {
  REPORT_CATEGORY_LABEL,
  type ReportCategory,
  type ReportDefinition,
} from "./catalog";
import type { ReportKpi, ReportResult } from "./engine";
import { ReportResultPanel } from "./report-result-panel";
import { ReportBuilder } from "./report-builder";

type Tab = "overview" | "catalog" | "builder";

export function ReportsWorkspace({
  initialKpis,
  initialReports,
  catalog,
}: {
  initialKpis: ReportKpi[];
  initialReports: ReportResult[];
  catalog: ReportDefinition[];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [category, setCategory] = useState<ReportCategory | "all">("all");
  const [period, setPeriod] = useState<"mtd" | "qtd" | "ytd" | "12m">("ytd");
  const [active, setActive] = useState<ReportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      category === "all"
        ? catalog
        : catalog.filter((r) => r.category === category),
    [catalog, category],
  );

  function runCatalogReport(def: ReportDefinition) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/reports/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reportId: def.id,
            period: def.defaultPeriod ?? period,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Αποτυχία");
        setActive(data.result as ReportResult);
        setTab("catalog");
        toast.success(`Εκτελέστηκε: ${def.title}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  const tabs: Array<[Tab, string, typeof BarChart3]> = [
    ["overview", "Dashboard", BarChart3],
    ["catalog", "Κατάλογος", Layers3],
    ["builder", "Builder", Wrench],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
              tab === key
                ? "bg-teal-800 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {initialKpis.map((k) => (
              <div key={k.label} className="soft-panel px-4 py-4">
                <p className="text-xs font-medium text-slate-500">{k.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {initialReports.map((r) => (
              <section key={r.id} className="soft-panel p-4 sm:p-5">
                <ReportResultPanel result={r} compact />
              </section>
            ))}
          </div>

          <div className="soft-panel flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-2">
              <Sparkles size={16} className="mt-0.5 text-teal-700" />
              <div>
                <p className="text-sm font-semibold text-ink-950">
                  BI Engine · ApexCharts
                </p>
                <p className="text-xs text-slate-500">
                  Ζωντανά aggregates από τιμολόγια, AR/AP, αποθήκη, παραγγελίες
                  και HR. Ανοίξτε τον κατάλογο ή τον Builder για προσαρμογή.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTab("catalog")}
              >
                Κατάλογος
              </Button>
              <Button size="sm" onClick={() => setTab("builder")}>
                Άνοιγμα Builder
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "catalog" ? (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <aside className="space-y-3">
            <div className="soft-panel space-y-2 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Κατηγορία
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategory("all")}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium",
                    category === "all"
                      ? "bg-teal-800 text-white"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  Όλα
                </button>
                {(
                  Object.keys(REPORT_CATEGORY_LABEL) as ReportCategory[]
                ).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-medium",
                      category === c
                        ? "bg-teal-800 text-white"
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {REPORT_CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
              <label className="block pt-1 text-xs text-slate-500">
                Περίοδος
                <select
                  value={period}
                  onChange={(e) =>
                    setPeriod(e.target.value as typeof period)
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="mtd">Τρέχων μήνας</option>
                  <option value="qtd">Τρίμηνο</option>
                  <option value="ytd">Έτος έως σήμερα</option>
                  <option value="12m">12 μήνες</option>
                </select>
              </label>
            </div>

            <ul className="soft-panel divide-y divide-slate-100 overflow-hidden">
              {filtered.map((def) => (
                <li key={def.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => runCatalogReport(def)}
                    className="flex w-full items-start gap-2 px-3 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Play size={14} className="mt-0.5 shrink-0 text-teal-700" />
                    <span>
                      <span className="block text-sm font-medium text-ink-950">
                        {def.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {REPORT_CATEGORY_LABEL[def.category]} · {def.chartType}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="soft-panel min-h-[420px] p-4 sm:p-5">
            {pending ? (
              <div className="flex h-[360px] items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Εκτέλεση αναφοράς…
              </div>
            ) : active ? (
              <ReportResultPanel result={active} />
            ) : (
              <div className="flex h-[360px] flex-col items-center justify-center text-center">
                <BarChart3 size={28} className="text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-600">
                  Επιλέξτε αναφορά από τον κατάλογο
                </p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  11 έτοιμα BI reports με ApexCharts, KPIs, πίνακα και CSV
                  εξαγωγή.
                </p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "builder" ? <ReportBuilder /> : null}
    </div>
  );
}
