"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { BookmarkPlus, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "@/shared/ui/toaster";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type Saved = {
  id: string;
  name: string;
  payload: {
    metrics?: string[];
    groupBy?: string;
    period?: string;
  };
  updatedAt: string;
};

const METRICS = [
  { id: "revenue", label: "Έσοδα" },
  { id: "invoices", label: "Τιμολόγια" },
  { id: "orders", label: "Παραγγελίες" },
  { id: "cash", label: "Ταμείο" },
  { id: "stock", label: "Αποθέματα" },
];

const GROUPS = [
  { id: "month", label: "Ανά μήνα" },
  { id: "customer", label: "Ανά πελάτη" },
  { id: "product", label: "Ανά είδος" },
  { id: "site", label: "Ανά αποθήκη" },
];

export function ReportBuilder() {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Νέα αναφορά");
  const [metrics, setMetrics] = useState<string[]>(["revenue", "invoices"]);
  const [groupBy, setGroupBy] = useState("month");
  const [period, setPeriod] = useState("ytd");
  const [pending, startTransition] = useTransition();

  async function load() {
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
    void load();
  }, []);

  const preview = useMemo(
    () =>
      `Μετρήσεις: ${
        metrics
          .map((m) => METRICS.find((x) => x.id === m)?.label || m)
          .join(", ") || "—"
      } · Ομαδοποίηση: ${
        GROUPS.find((g) => g.id === groupBy)?.label || groupBy
      } · Περίοδος: ${period}`,
    [metrics, groupBy, period],
  );

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
    toast.message(`Φορτώθηκε: ${item.name}`);
  }

  function save() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/saved-filters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            module: "reports",
            name,
            payload: { metrics, groupBy, period },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Αποτυχία αποθήκευσης");
        toast.success("Αναφορά αποθηκεύτηκε");
        await load();
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
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  return (
    <section className="soft-panel space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Report builder
          </p>
          <h2 className="mt-1 text-base font-semibold text-ink-950">
            Προσαρμοσμένες αναφορές
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Αποθήκευση ορισμών για επανάληψη και μελλοντικό schedule.
          </p>
        </div>
        <Button
          size="sm"
          disabled={pending || !metrics.length || !name.trim()}
          onClick={() => save()}
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Αποθήκευση
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
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
      </div>

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

      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-ink-900">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Προεπισκόπηση ορισμού
        </p>
        <p className="mt-2">{preview}</p>
        <p className="mt-2 text-xs text-slate-500">
          Schedule shell: οι αποθηκευμένες αναφορές μπορούν αργότερα να τρέχουν
          αυτόματα (email/PDF). Προς το παρόν αποθηκεύονται ως ορισμοί.
        </p>
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
                    {item.payload.groupBy || "month"} ·{" "}
                    {item.payload.period || "ytd"}
                  </span>
                </button>
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
