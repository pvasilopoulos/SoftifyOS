"use client";

import { useEffect, useState, useTransition } from "react";
import { BookmarkPlus, Loader2, Play, Save, Trash2 } from "lucide-react";
import { toast } from "@/shared/ui/toaster";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import type { ReportResult } from "./engine";
import { ReportResultPanel } from "./report-result-panel";

type Saved = {
  id: string;
  name: string;
  payload: {
    metrics?: string[];
    groupBy?: string;
    period?: string;
    chartType?: string;
    viewMode?: string;
    includeTotals?: boolean;
    limit?: number;
  };
  updatedAt: string;
};

const METRICS = [
  { id: "revenue", label: "Έσοδα" },
  { id: "invoices", label: "Τιμολόγια" },
  { id: "orders", label: "Παραγγελίες" },
  { id: "cash", label: "Ταμείο" },
  { id: "vat", label: "ΦΠΑ" },
  { id: "stock", label: "Αποθέματα" },
];

const GROUPS = [
  { id: "month", label: "Ανά μήνα" },
  { id: "customer", label: "Ανά πελάτη" },
  { id: "product", label: "Ανά είδος" },
  { id: "site", label: "Ανά αποθήκη" },
];

const CHARTS = [
  { id: "area", label: "Area" },
  { id: "line", label: "Line" },
  { id: "bar", label: "Bar" },
  { id: "donut", label: "Donut" },
];

const VIEWS = [
  { id: "both", label: "Chart + Grid" },
  { id: "table", label: "Μόνο Grid" },
  { id: "chart", label: "Μόνο Chart" },
] as const;

export function ReportBuilder() {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Νέα αναφορά");
  const [metrics, setMetrics] = useState<string[]>(["revenue", "invoices"]);
  const [groupBy, setGroupBy] = useState("month");
  const [period, setPeriod] = useState("ytd");
  const [chartType, setChartType] = useState("area");
  const [viewMode, setViewMode] = useState<"chart" | "table" | "both">("both");
  const [includeTotals, setIncludeTotals] = useState(true);
  const [limit, setLimit] = useState(50);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [pending, startTransition] = useTransition();

  async function loadSaved() {
    setLoading(true);
    try {
      const res = await fetch("/api/saved-filters?module=reports", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία φόρτωσης");
      setSaved(data.items || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Σφάλμα");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSaved();
  }, []);

  function toggleMetric(id: string) {
    setMetrics((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function applySaved(item: Saved) {
    setName(item.name);
    setMetrics(item.payload.metrics || ["revenue"]);
    setGroupBy(item.payload.groupBy || "month");
    setPeriod(item.payload.period || "ytd");
    setChartType(item.payload.chartType || "area");
    setViewMode(
      (item.payload.viewMode as "chart" | "table" | "both") || "both",
    );
    setIncludeTotals(item.payload.includeTotals !== false);
    setLimit(item.payload.limit ?? 50);
    toast.message(`Φορτώθηκε: ${item.name}`);
  }

  function buildBody(override?: Saved["payload"]) {
    const mode =
      (override?.viewMode as typeof viewMode | undefined) || viewMode;
    return {
      metrics: override?.metrics || metrics,
      groupBy: override?.groupBy || groupBy,
      period: override?.period || period,
      chartType:
        mode === "table"
          ? "table"
          : override?.chartType || chartType,
      viewMode: mode,
      includeTotals:
        override?.includeTotals !== undefined
          ? override.includeTotals
          : includeTotals,
      limit: override?.limit ?? limit,
    };
  }

  function run(override?: Saved["payload"]) {
    const body = buildBody(override);
    startTransition(async () => {
      try {
        const res = await fetch("/api/reports/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Αποτυχία εκτέλεσης");
        setResult(data.result as ReportResult);
        toast.success("Η αναφορά εκτελέστηκε");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  function save() {
    startTransition(async () => {
      try {
        const payload = buildBody();
        const res = await fetch("/api/saved-filters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            module: "reports",
            name,
            payload,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Αποτυχία αποθήκευσης");
        toast.success("Αναφορά αποθηκεύτηκε");
        await loadSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/saved-filters?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Αποτυχία διαγραφής");
        toast.success("Διαγράφηκε");
        await loadSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <section className="soft-panel space-y-4 p-4 sm:p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Report builder
          </p>
          <h2 className="mt-1 text-base font-semibold text-ink-950">
            Προσαρμοσμένο BI
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Charts και advanced Grids — μετρήσεις × διάσταση × περίοδος.
          </p>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Όνομα</span>
          <input
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">
            Προβολή
          </span>
          <select
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3"
            value={viewMode}
            onChange={(e) =>
              setViewMode(e.target.value as typeof viewMode)
            }
          >
            {VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">
            Ομαδοποίηση
          </span>
          <select
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Περίοδος</span>
          <select
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="mtd">Τρέχων μήνας</option>
            <option value="qtd">Τρέχον τρίμηνο</option>
            <option value="ytd">Έτος έως σήμερα</option>
            <option value="12m">12 μήνες</option>
          </select>
        </label>

        {viewMode !== "table" ? (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">
              Τύπος γραφήματος
            </span>
            <select
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3"
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
            >
              {CHARTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">
            Όριο γραμμών (grid)
          </span>
          <select
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeTotals}
            onChange={(e) => setIncludeTotals(e.target.checked)}
          />
          Σύνολα στο footer του grid
        </label>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Μετρήσεις
          </p>
          <div className="flex flex-wrap gap-2">
            {METRICS.map((m) => {
              const on = metrics.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMetric(m.id)}
                  className={cn(
                    "rounded-xl border px-3 py-1.5 text-sm font-medium",
                    on
                      ? "border-teal-300 bg-teal-50 text-teal-900"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending || !metrics.length}
            onClick={() => run()}
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            Εκτέλεση
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !metrics.length || !name.trim()}
            onClick={() => save()}
          >
            <Save size={14} />
            Αποθήκευση
          </Button>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            <BookmarkPlus size={14} />
            Αποθηκευμένες
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Φόρτωση…</p>
          ) : saved.length === 0 ? (
            <p className="text-sm text-slate-500">
              Δεν υπάρχουν ακόμα αποθηκευμένες αναφορές.
            </p>
          ) : (
            <ul className="space-y-2">
              {saved.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2"
                >
                  <button
                    type="button"
                    className="text-left text-sm font-medium text-ink-900 hover:underline"
                    onClick={() => applySaved(item)}
                  >
                    {item.name}
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      {(item.payload.metrics || []).join(", ") || "—"} ·{" "}
                      {item.payload.viewMode || "both"} ·{" "}
                      {item.payload.groupBy || "month"}
                    </span>
                  </button>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => {
                        applySaved(item);
                        run(item.payload);
                      }}
                      aria-label="Εκτέλεση"
                    >
                      <Play size={16} className="text-teal-700" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => remove(item.id)}
                      aria-label="Διαγραφή"
                    >
                      <Trash2 size={16} className="text-rose-600" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="soft-panel min-h-[480px] p-4 sm:p-5">
        {pending && !result ? (
          <div className="flex h-[400px] items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Υπολογισμός BI…
          </div>
        ) : result ? (
          <ReportResultPanel result={result} />
        ) : (
          <div className="flex h-[400px] flex-col items-center justify-center text-center text-sm text-slate-500">
            <p className="font-medium text-slate-700">
              Δεν υπάρχει ακόμη αποτέλεσμα
            </p>
            <p className="mt-1 max-w-sm text-xs">
              Επίλεξε «Μόνο Grid» για advanced tabular report με sort, σύνολα
              και CSV — ή Chart + Grid για συνδυασμό.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
