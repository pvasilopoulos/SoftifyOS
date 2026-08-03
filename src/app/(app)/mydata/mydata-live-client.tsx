"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileCode2,
  Filter,
  Hash,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  Settings2,
  X,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import { cn } from "@/shared/lib/cn";
import {
  entityHref,
  myDataEntityTypeLabel,
  myDataStatusLabel,
} from "@/modules/mydata/labels";

type MyDataEnv = "simulator" | "test" | "prod";
type ProviderId = "NONE" | "AADE" | "MOCK" | "NOVAON" | "IMPACT";

export type MyDataRow = {
  id: string;
  entityType: string;
  entityId: string;
  entityNumber: string | null;
  invoiceType: string | null;
  vatCategory: string | null;
  status: string;
  mark: string | null;
  uid: string | null;
  errorMessage: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  response?: unknown;
  payload?: unknown;
};

type Counts = {
  PENDING: number;
  SENT: number;
  ACCEPTED: number;
  REJECTED: number;
  CANCELLED: number;
  total: number;
};

type DetailTab = "overview" | "errors" | "xml" | "raw";

function statusTone(
  status: string,
): "teal" | "amber" | "slate" | "rose" | "emerald" {
  switch (status) {
    case "ACCEPTED":
      return "emerald";
    case "PENDING":
    case "SENT":
      return "amber";
    case "REJECTED":
      return "rose";
    case "CANCELLED":
      return "slate";
    default:
      return "teal";
  }
}

function kpiStyle(key: string, active: boolean) {
  const base =
    "rounded-2xl border px-4 py-3 text-left transition shadow-sm";
  if (active) {
    switch (key) {
      case "ACCEPTED":
        return cn(base, "border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200");
      case "REJECTED":
        return cn(base, "border-rose-300 bg-rose-50 ring-1 ring-rose-200");
      case "PENDING":
      case "SENT":
        return cn(base, "border-amber-300 bg-amber-50 ring-1 ring-amber-200");
      case "CANCELLED":
        return cn(base, "border-slate-300 bg-slate-100 ring-1 ring-slate-200");
      default:
        return cn(base, "border-teal-300 bg-teal-50 ring-1 ring-teal-200");
    }
  }
  switch (key) {
    case "ACCEPTED":
      return cn(base, "border-emerald-100 bg-white hover:border-emerald-200");
    case "REJECTED":
      return cn(base, "border-rose-100 bg-white hover:border-rose-200");
    case "PENDING":
    case "SENT":
      return cn(base, "border-amber-100 bg-white hover:border-amber-200");
    default:
      return cn(base, "border-slate-200 bg-white hover:border-slate-300");
  }
}

function fmtDt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("el-GR");
  } catch {
    return iso;
  }
}

function fmtShort(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("el-GR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function extractErrors(response: unknown): Array<{ code?: string; message: string }> {
  const r = asRecord(response);
  const errors = r?.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => {
      const er = asRecord(e);
      if (!er) return null;
      const message =
        typeof er.message === "string"
          ? er.message
          : typeof er.errorMessage === "string"
            ? er.errorMessage
            : null;
      if (!message) return null;
      return {
        code: typeof er.code === "string" ? er.code : undefined,
        message,
      };
    })
    .filter(Boolean) as Array<{ code?: string; message: string }>;
}

function extractRequestXml(payload: unknown): string | null {
  const p = asRecord(payload);
  return typeof p?.requestXml === "string" ? p.requestXml : null;
}

export function MyDataLiveClient({
  canWrite,
  myDataEnv,
  eInvoicingProvider,
  hasCredentials,
  initialItems,
  initialCounts,
}: {
  canWrite: boolean;
  myDataEnv: MyDataEnv;
  eInvoicingProvider: ProviderId;
  hasCredentials: boolean;
  initialItems: MyDataRow[];
  initialCounts: Counts;
}) {
  const [items, setItems] = useState(initialItems);
  const [counts, setCounts] = useState(initialCounts);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItems[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<MyDataRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [status, setStatus] = useState("ALL");
  const [entityType, setEntityType] = useState("ALL");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) ?? null,
    [items, selectedId],
  );

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (entityType !== "ALL") params.set("entityType", entityType);
    if (q.trim()) params.set("q", q.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("take", "300");
    const res = await fetch(`/api/mydata/submissions?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    const next = (data.items ?? []) as MyDataRow[];
    setItems(next);
    if (data.counts) setCounts(data.counts as Counts);
    setSelectedIds([]);
    setSelectedId((prev) =>
      prev && next.some((r) => r.id === prev) ? prev : (next[0]?.id ?? null),
    );
  }, [status, entityType, q, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/mydata/submissions/${selectedId}`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (res.ok && data.item) setDetail(data.item as MyDataRow);
      else setDetail(selected);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, selected]);

  useEffect(() => {
    setDetailTab("overview");
    setCancelConfirmId(null);
  }, [selectedId]);

  async function processOne(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/process`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία διαβίβασης");
      toast.success(`myDATA ${data.item?.status ?? "OK"}`);
      await load();
      setSelectedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelOne(id: string) {
    setBusyId(id);
    setError(null);
    setCancelConfirmId(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία ακύρωσης");
      toast.success("Ακυρώθηκε στην ΑΑΔΕ / ουρά");
      await load();
      setSelectedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function processBatch(ids?: string[]) {
    setBusyId(ids ? "bulk" : "batch");
    setError(null);
    try {
      if (ids?.length) {
        let ok = 0;
        for (const id of ids) {
          const res = await fetch(`/api/mydata/submissions/${id}/process`, {
            method: "POST",
          });
          if (res.ok) ok += 1;
        }
        toast.success(`Διαβίβαση: ${ok}/${ids.length}`);
      } else {
        const res = await fetch("/api/mydata/submissions/process-batch", {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Αποτυχία batch");
        toast.success(`Επεξεργάστηκαν ${data.processed ?? 0} εγγραφές`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function previewXml(id: string) {
    setBusyId(`xml-${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/preview`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία preview");
      const xml = data.item?.xml as string | undefined;
      if (!xml) throw new Error("Κενό XML");
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(
          `<pre style="white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;padding:16px">${xml
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</pre>`,
        );
        w.document.title = `myDATA XML · ${data.item?.entityNumber || id}`;
      } else {
        toast.success("Επίτρεψε pop-ups για προεπισκόπηση XML");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  const entityTypes = useMemo(() => {
    const set = new Set(initialItems.map((i) => i.entityType));
    for (const i of items) set.add(i.entityType);
    return [...set].sort();
  }, [items, initialItems]);

  const view = detail ?? selected;
  const viewErrors = extractErrors(view?.response);
  const requestXml = extractRequestXml(view?.payload);
  const responseRec = asRecord(view?.response);
  const activeFilterCount =
    (status !== "ALL" ? 1 : 0) +
    (entityType !== "ALL" ? 1 : 0) +
    (q.trim() ? 1 : 0) +
    (from || to ? 1 : 0);

  const processableSelected = selectedIds.filter((id) => {
    const row = items.find((r) => r.id === id);
    return (
      row &&
      (row.status === "PENDING" ||
        row.status === "SENT" ||
        row.status === "REJECTED")
    );
  });

  function selectRow(id: string) {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      setMobileOpen(true);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function clearFilters() {
    setStatus("ALL");
    setEntityType("ALL");
    setQ("");
    setFrom("");
    setTo("");
  }

  const detailPanel = view ? (
    <DetailPanel
      view={view}
      canWrite={canWrite}
      busyId={busyId}
      cancelConfirmId={cancelConfirmId}
      setCancelConfirmId={setCancelConfirmId}
      detailTab={detailTab}
      setDetailTab={setDetailTab}
      viewErrors={viewErrors}
      requestXml={requestXml}
      responseRec={responseRec}
      onProcess={() => void processOne(view.id)}
      onCancel={() => void cancelOne(view.id)}
      onXml={() => void previewXml(view.id)}
      onCloseMobile={() => setMobileOpen(false)}
    />
  ) : (
    <div className="flex h-full min-h-[22rem] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <ScrollText size={26} strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink-900">Επίλεξε εγγραφή</p>
        <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-slate-500">
          Η ουρά δείχνει κατάσταση, MARK και σφάλματα ΑΑΔΕ. Το panel δεξιά ανοίγει
          λεπτομέρειες και ενέργειες.
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="myDATA Live"
        description="Ουρά διαβίβασης ΑΑΔΕ · λίστα · επεξεργασία · XML"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                myDataEnv === "prod"
                  ? "rose"
                  : myDataEnv === "test"
                    ? "amber"
                    : "teal"
              }
            >
              {myDataEnv}
            </Badge>
            <Badge tone="slate">πάροχος · {eInvoicingProvider}</Badge>
            <Link
              href="/settings/integrations"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm text-ink-900 hover:bg-slate-50"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Integrations
            </Link>
            <Button
              size="sm"
              variant="secondary"
              disabled={busyId !== null}
              onClick={() => void load()}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Ανανέωση
            </Button>
            {canWrite ? (
              <Button
                size="sm"
                disabled={busyId !== null}
                onClick={() => void processBatch()}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {busyId === "batch" ? "Επεξεργασία…" : "Επεξεργασία ουράς"}
              </Button>
            ) : null}
          </div>
        }
      />

      {myDataEnv !== "simulator" && !hasCredentials ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Λείπουν credentials ΑΑΔΕ για περιβάλλον <strong>{myDataEnv}</strong>.
          Ρύθμισέ τα στο{" "}
          <Link href="/settings/integrations" className="underline">
            Integrations → myDATA
          </Link>
          .
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {/* KPI status strip */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            ["PENDING", counts.PENDING, Clock3],
            ["SENT", counts.SENT, Send],
            ["ACCEPTED", counts.ACCEPTED, CheckCircle2],
            ["REJECTED", counts.REJECTED, AlertTriangle],
            ["CANCELLED", counts.CANCELLED, XCircle],
          ] as const
        ).map(([key, n, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus((s) => (s === key ? "ALL" : key))}
            className={kpiStyle(key, status === key)}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-600">
                {myDataStatusLabel[key] ?? key}
              </p>
              <Icon
                size={14}
                className={cn(
                  key === "ACCEPTED" && "text-emerald-600",
                  key === "REJECTED" && "text-rose-600",
                  (key === "PENDING" || key === "SENT") && "text-amber-600",
                  key === "CANCELLED" && "text-slate-500",
                )}
              />
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-950">
              {n}
            </p>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="soft-panel space-y-3 p-3 sm:p-3.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="flex min-h-10 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-teal-300 focus-within:ring-2 focus-within:ring-teal-500/20">
            <Search size={16} className="shrink-0 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
              placeholder="Αριθμός, MARK, UID ή κείμενο σφάλματος…"
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Καθαρισμός"
              >
                <X size={14} />
              </button>
            ) : null}
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={busyId !== null}
              onClick={() => void load()}
            >
              <Search size={14} />
              Αναζήτηση
            </Button>
            <Button
              size="sm"
              variant={filtersOpen || activeFilterCount > 0 ? "primary" : "secondary"}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <Filter size={14} />
              Φίλτρα
              {activeFilterCount > 0 ? (
                <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-[11px] font-semibold">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["ALL", "Όλα"],
              ["PENDING", "Εκκρεμεί"],
              ["REJECTED", "Απορρίψεις"],
              ["ACCEPTED", "Αποδοχές"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatus(id)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                status === id
                  ? "bg-ink-950 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200/80",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {filtersOpen ? (
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-600">
              Οντότητα
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="ALL">Όλες</option>
                {entityTypes.map((t) => (
                  <option key={t} value={t}>
                    {myDataEntityTypeLabel[t] ?? t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Από
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Έως
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              />
            </label>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={() => void load()}>
                Εφαρμογή
              </Button>
              {activeFilterCount > 0 ? (
                <Button size="sm" variant="ghost" onClick={clearFilters}>
                  Καθαρισμός
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="text-xs text-slate-500">
          <span className="font-medium text-ink-800">{items.length}</span>{" "}
          εμφανίζονται · ουρά{" "}
          <span className="tabular-nums">{counts.total}</span>
        </p>
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-ink-950 px-4 py-2.5 text-sm text-white">
          <span className="font-medium">{selectedIds.length} επιλεγμένα</span>
          {canWrite && processableSelected.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/10 text-white hover:bg-white/20"
              disabled={busyId !== null}
              onClick={() => void processBatch(processableSelected)}
            >
              <Send size={14} />
              Διαβίβαση ({processableSelected.length})
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={() => setSelectedIds([])}
          >
            Καθαρισμός
          </Button>
        </div>
      ) : null}

      {/* List + detail */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
        <section className="soft-panel overflow-hidden">
          <div className="hidden border-b border-slate-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[auto_minmax(0,1.3fr)_5.5rem_6.5rem_minmax(0,1fr)_6.5rem] md:gap-3">
            <input
              type="checkbox"
              checked={
                items.length > 0 && selectedIds.length === items.length
              }
              onChange={() =>
                setSelectedIds(
                  selectedIds.length === items.length
                    ? []
                    : items.map((i) => i.id),
                )
              }
              aria-label="Επιλογή όλων"
            />
            <span>Παραστατικό</span>
            <span>Τύπος</span>
            <span>Κατάσταση</span>
            <span>MARK / σφάλμα</span>
            <span>Ημ/νία</span>
          </div>

          <ul className="divide-y divide-slate-100">
            {items.map((r) => {
              const errShort =
                r.errorMessage?.replace(/\s+/g, " ").slice(0, 72) || null;
              return (
                <li key={r.id}>
                  <div
                    className={cn(
                      "grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3 transition-colors md:grid-cols-[auto_minmax(0,1.3fr)_5.5rem_6.5rem_minmax(0,1fr)_6.5rem] md:items-center",
                      selectedId === r.id && "bg-teal-50/70",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      aria-label={`Επιλογή ${r.entityNumber || r.id}`}
                      className="mt-1 md:mt-0"
                    />
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => selectRow(r.id)}
                    >
                      <p className="truncate font-mono text-sm font-semibold text-ink-950">
                        {r.entityNumber || r.id.slice(0, 10)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {myDataEntityTypeLabel[r.entityType] ?? r.entityType}
                        {r.attempts > 1 ? ` · ${r.attempts} προσπάθειες` : ""}
                      </p>
                    </button>
                    <button
                      type="button"
                      className="text-xs text-slate-600 md:text-left"
                      onClick={() => selectRow(r.id)}
                    >
                      {r.invoiceType || "—"}
                    </button>
                    <div className="col-start-3 row-start-1 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-auto">
                      <Badge tone={statusTone(r.status)}>
                        {myDataStatusLabel[r.status] ?? r.status}
                      </Badge>
                    </div>
                    <button
                      type="button"
                      className="col-span-2 col-start-2 min-w-0 text-left md:col-span-1 md:col-start-auto"
                      onClick={() => selectRow(r.id)}
                    >
                      {r.mark ? (
                        <p className="truncate font-mono text-[11px] text-slate-600">
                          {r.mark}
                        </p>
                      ) : errShort ? (
                        <p className="truncate text-[11px] text-rose-700">
                          {errShort}
                          {r.errorMessage && r.errorMessage.length > 72
                            ? "…"
                            : ""}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-400">—</p>
                      )}
                    </button>
                    <button
                      type="button"
                      className="hidden text-left text-xs text-slate-500 md:block"
                      onClick={() => selectRow(r.id)}
                    >
                      {fmtShort(r.createdAt)}
                    </button>
                  </div>
                </li>
              );
            })}
            {items.length === 0 ? (
              <li className="px-4 py-14 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <ScrollText size={22} />
                </div>
                <p className="mt-3 text-sm font-medium text-ink-900">
                  Κενή ουρά για αυτά τα φίλτρα
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Δοκίμασε «Όλα» ή καθάρισε την αναζήτηση.
                </p>
                {activeFilterCount > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    onClick={clearFilters}
                  >
                    Καθαρισμός φίλτρων
                  </Button>
                ) : null}
              </li>
            ) : null}
          </ul>
        </section>

        <aside className="soft-panel hidden min-h-0 self-start overflow-hidden xl:sticky xl:top-20 xl:block xl:h-[calc(100dvh-6rem)] xl:max-h-[calc(100dvh-6rem)]">
          {detailPanel}
        </aside>
      </div>

      {mobileOpen && selectedId ? (
        <MobileSheet onClose={() => setMobileOpen(false)}>
          {detailPanel}
        </MobileSheet>
      ) : null}
    </div>
  );
}

function DetailPanel({
  view,
  canWrite,
  busyId,
  cancelConfirmId,
  setCancelConfirmId,
  detailTab,
  setDetailTab,
  viewErrors,
  requestXml,
  responseRec,
  onProcess,
  onCancel,
  onXml,
  onCloseMobile,
}: {
  view: MyDataRow;
  canWrite: boolean;
  busyId: string | null;
  cancelConfirmId: string | null;
  setCancelConfirmId: (id: string | null) => void;
  detailTab: DetailTab;
  setDetailTab: (t: DetailTab) => void;
  viewErrors: Array<{ code?: string; message: string }>;
  requestXml: string | null;
  responseRec: Record<string, unknown> | null;
  onProcess: () => void;
  onCancel: () => void;
  onXml: () => void;
  onCloseMobile: () => void;
}) {
  const canProcess =
    view.status === "PENDING" ||
    view.status === "SENT" ||
    view.status === "REJECTED";

  return (
    <div className="flex h-full min-h-0 max-h-full flex-col">
      <div
        className={cn(
          "relative shrink-0 overflow-hidden border-b px-5 pb-4 pt-4 text-white",
          view.status === "ACCEPTED" &&
            "border-emerald-800 bg-gradient-to-br from-emerald-900 via-slate-900 to-teal-900",
          view.status === "REJECTED" &&
            "border-rose-800 bg-gradient-to-br from-rose-950 via-slate-900 to-slate-800",
          view.status !== "ACCEPTED" &&
            view.status !== "REJECTED" &&
            "border-slate-800 bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
              Εγγραφή ουράς
            </p>
            <h2 className="mt-1 truncate font-mono text-lg font-semibold tracking-tight">
              {view.entityNumber || view.id}
            </h2>
            <p className="mt-0.5 truncate text-sm text-white/75">
              {myDataEntityTypeLabel[view.entityType] ?? view.entityType}
              {view.invoiceType ? ` · τύπος ${view.invoiceType}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <Badge
              tone={statusTone(view.status)}
              className="bg-white/95 shadow-sm"
            >
              {myDataStatusLabel[view.status] ?? view.status}
            </Badge>
            <button
              type="button"
              onClick={onCloseMobile}
              className="rounded-lg bg-white/10 p-1.5 text-white/80 ring-1 ring-white/15 hover:bg-white/20 xl:hidden"
              aria-label="Κλείσιμο"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {view.mark ? (
            <span className="rounded-lg bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/90 ring-1 ring-white/15">
              MARK {view.mark}
            </span>
          ) : null}
          {view.attempts > 0 ? (
            <span className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] text-white/90 ring-1 ring-white/15">
              {view.attempts} προσπάθειες
            </span>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-100 px-3 pt-2">
        <div className="flex gap-1 overflow-x-auto pb-2">
          {(
            [
              ["overview", "Επισκόπηση"],
              ["errors", `Σφάλματα${viewErrors.length ? ` (${viewErrors.length})` : ""}`],
              ["xml", "XML"],
              ["raw", "Raw"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDetailTab(id)}
              className={cn(
                "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                detailTab === id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
        {detailTab === "overview" ? (
          <>
            {view.errorMessage ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">
                  Μήνυμα
                </p>
                <p className="mt-1 leading-relaxed">{view.errorMessage}</p>
              </div>
            ) : null}

            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Meta label="MARK" value={view.mark || "—"} mono />
              <Meta label="UID" value={view.uid || "—"} mono />
              <Meta label="Προσπάθειες" value={String(view.attempts)} />
              <Meta label="Τελευταία" value={fmtDt(view.lastAttemptAt)} />
              <Meta label="Δημιουργία" value={fmtDt(view.createdAt)} />
              <Meta label="Ενημέρωση" value={fmtDt(view.updatedAt)} />
              {typeof responseRec?.endpoint === "string" ? (
                <Meta
                  label="Endpoint"
                  value={responseRec.endpoint}
                  className="col-span-2"
                />
              ) : null}
              {typeof responseRec?.httpStatus === "number" ? (
                <Meta
                  label="HTTP"
                  value={String(responseRec.httpStatus)}
                />
              ) : null}
              {typeof responseRec?.channel === "string" ? (
                <Meta label="Κανάλι" value={String(responseRec.channel)} />
              ) : null}
            </dl>

            {viewErrors.length > 0 ? (
              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">
                  Σφάλματα ΑΑΔΕ
                </p>
                <ul className="mt-2 space-y-2">
                  {viewErrors.slice(0, 3).map((e, i) => (
                    <li key={i} className="text-sm text-rose-900">
                      {e.code ? (
                        <span className="mr-1.5 font-mono text-xs font-semibold">
                          {e.code}
                        </span>
                      ) : null}
                      <span className="leading-snug">{e.message}</span>
                    </li>
                  ))}
                </ul>
                {viewErrors.length > 3 ? (
                  <button
                    type="button"
                    className="mt-2 text-xs font-medium text-rose-700 hover:underline"
                    onClick={() => setDetailTab("errors")}
                  >
                    Όλα τα σφάλματα ({viewErrors.length})
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {detailTab === "errors" ? (
          viewErrors.length === 0 && !view.errorMessage ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Δεν υπάρχουν δομημένα σφάλματα σε αυτή την απόκριση.
            </p>
          ) : (
            <ul className="space-y-2">
              {view.errorMessage ? (
                <li className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {view.errorMessage}
                </li>
              ) : null}
              {viewErrors.map((e, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-rose-100 bg-white px-3 py-2.5 text-sm"
                >
                  {e.code ? (
                    <p className="font-mono text-xs font-semibold text-rose-700">
                      {e.code}
                    </p>
                  ) : null}
                  <p className="mt-0.5 leading-relaxed text-ink-900">
                    {e.message}
                  </p>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {detailTab === "xml" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                Request XML (αποθηκευμένο ή live preview)
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={busyId === `xml-${view.id}`}
                onClick={onXml}
              >
                <FileCode2 size={14} />
                Άνοιγμα
              </Button>
            </div>
            {requestXml ? (
              <pre className="max-h-[28rem] overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-emerald-100">
                {requestXml}
              </pre>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500">
                Δεν υπάρχει αποθηκευμένο requestXml — πάτα «Άνοιγμα» για live
                build.
              </p>
            )}
          </div>
        ) : null}

        {detailTab === "raw" ? (
          <div className="space-y-3">
            <CollapsibleBlock title="Response JSON" defaultOpen>
              <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                {prettyJson(view.response)}
              </pre>
            </CollapsibleBlock>
            <CollapsibleBlock title="Payload JSON">
              <pre className="max-h-56 overflow-auto rounded-xl bg-slate-100 p-3 text-[11px] leading-relaxed text-slate-800">
                {prettyJson(view.payload)}
              </pre>
            </CollapsibleBlock>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 space-y-2 border-t border-slate-100 bg-white px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {canWrite && canProcess ? (
            <Button
              size="sm"
              disabled={busyId === view.id}
              onClick={onProcess}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {busyId === view.id ? "Διαβίβαση…" : "Διαβίβαση"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={busyId === `xml-${view.id}`}
            onClick={onXml}
          >
            <FileCode2 className="mr-1.5 h-3.5 w-3.5" />
            XML
          </Button>
          {canWrite && view.status === "ACCEPTED" && view.mark ? (
            cancelConfirmId === view.id ? (
              <>
                <Button
                  size="sm"
                  className="bg-rose-700 hover:bg-rose-800"
                  disabled={busyId === view.id}
                  onClick={onCancel}
                >
                  Επιβεβαίωση ακύρωσης
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCancelConfirmId(null)}
                >
                  Άκυρο
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busyId === view.id}
                onClick={() => setCancelConfirmId(view.id)}
              >
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                Ακύρωση ΑΑΔΕ
              </Button>
            )
          ) : null}
        </div>
        {entityHref(view.entityType, view.entityId) ? (
          <Link
            href={entityHref(view.entityType, view.entityId)!}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-teal-700 hover:bg-teal-50"
          >
            <Hash size={12} />
            Άνοιγμα παραστατικού
            <ExternalLink size={12} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2", className)}>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 break-all text-xs font-medium text-ink-900",
          mono && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function CollapsibleBlock({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50"
      >
        {title}
        <ChevronDown
          size={14}
          className={cn("transition", open && "rotate-180")}
        />
      </button>
      {open ? <div className="border-t border-slate-100 p-2">{children}</div> : null}
    </div>
  );
}

function MobileSheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] xl:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/45"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-center py-2">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
