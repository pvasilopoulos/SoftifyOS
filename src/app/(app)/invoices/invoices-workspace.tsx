"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  FileDown,
  Filter,
  Hash,
  LayoutList,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Receipt,
  Rows3,
  Search,
  Send,
  SlidersHorizontal,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  formatEUR,
  invoiceStatusLabel,
  invoiceStatusTone,
  paidRatio,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";
import { invoiceKindLabel } from "@/modules/documents/series";
import { InvoiceActions } from "./invoice-actions";
import { openInvoicePrint } from "@/modules/print-forms/open-invoice-print";
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import {
  DynamicListCells,
  DynamicListHeader,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import {
  applyListConfig,
  normalizeListConfig,
  type ListViewConfig,
} from "@/modules/entity-views/types";
import { periodPresetDates } from "@/app/(app)/finance/finance-filters";

type ListViewOpt = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  config: ListViewConfig;
};

export type InvoiceListItem = {
  id: string;
  number: string;
  status: string;
  kind?: string;
  issuedAt: string | null;
  dueAt: string | null;
  total: number;
  paidAmount: number;
  createdAt: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  branchName: string | null;
  spaceName: string | null;
  customFields?: Record<string, unknown>;
};

type Counts = {
  all: number;
  draft: number;
  pending: number;
  issued: number;
  overdue: number;
  paid: number;
  partial?: number;
  cancelled?: number;
};

type ListResponse = {
  items: InvoiceListItem[];
  nextCursor: string | null;
  counts?: Counts;
  meta: { ms: number };
  error?: string;
};

type DetailItem = InvoiceListItem & {
  subtotal: number;
  vatAmount: number;
  notes: string | null;
  customer: {
    name: string;
    code?: string;
    email: string | null;
    vatNumber: string | null;
    phone: string | null;
    mobile?: string | null;
  };
  branch: { name: string; city: string | null } | null;
  space: { name: string; code: string } | null;
  series?: {
    code: string;
    name: string;
    myDataInvoiceType?: string | null;
  } | null;
  site?: { code: string; name: string } | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    lineTotal: number;
    product?: { sku: string; name: string } | null;
  }>;
  payments?: Array<{
    id: string;
    amount: number;
    method: string;
    paidAt: string;
    note?: string | null;
    externalRef?: string | null;
  }>;
};

type DetailResponse = {
  item?: DetailItem;
  error?: string;
};

type KindFilter = "" | "SALES_INVOICE" | "SALES_CREDIT" | "RETAIL_RECEIPT";
type Density = "comfortable" | "compact";

const tabs: Array<{ id: keyof Counts | "all"; label: string; apiTab: string }> =
  [
    { id: "all", label: "Όλα", apiTab: "all" },
    { id: "pending", label: "Εκκρεμή", apiTab: "pending" },
    { id: "issued", label: "Εκδομένα", apiTab: "issued" },
    { id: "partial", label: "Μερικά", apiTab: "partial" },
    { id: "overdue", label: "Ληξιπρόθεσμα", apiTab: "overdue" },
    { id: "paid", label: "Πληρωμένα", apiTab: "paid" },
    { id: "draft", label: "Πρόχειρα", apiTab: "draft" },
    { id: "cancelled", label: "Ακυρωμένα", apiTab: "cancelled" },
  ];

const kindOptions: Array<{ id: KindFilter; label: string }> = [
  { id: "", label: "Όλα τα είδη" },
  { id: "SALES_INVOICE", label: "Τιμολόγια" },
  { id: "SALES_CREDIT", label: "Πιστωτικά" },
  { id: "RETAIL_RECEIPT", label: "ΑΠΥ" },
];

function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("el-GR", {
    day: "2-digit",
    month: "short",
  });
}

export function InvoicesWorkspace({
  initialItems,
  initialNextCursor,
  initialCounts,
  initialMs,
  listViews = [],
  customFields = [],
}: {
  initialItems: InvoiceListItem[];
  initialNextCursor: string | null;
  initialCounts: Counts;
  initialMs: number;
  listViews?: ListViewOpt[];
  customFields?: CustomFieldDef[];
}) {
  const defaultView =
    listViews.find((v) => v.isDefault) ?? listViews[0] ?? null;
  const [viewId, setViewId] = useState(defaultView?.id ?? "");
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [counts, setCounts] = useState(initialCounts);
  const [ms, setMs] = useState(initialMs);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("");
  const [issuedFrom, setIssuedFrom] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [unpaid, setUnpaid] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [density, setDensity] = useState<Density>("comfortable");
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(
    initialItems[0]?.id ?? null,
  );
  const [preview, setPreview] = useState<DetailItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activeView = listViews.find((v) => v.id === viewId) ?? defaultView;
  const config = useMemo(
    () => normalizeListConfig(activeView?.config),
    [activeView],
  );
  const useDynamic = Boolean(config.columns?.length);
  const builtins = ENTITY_REGISTRY.INVOICES.builtins;

  const visibleItems = useMemo(() => {
    return applyListConfig(
      items as unknown as Array<Record<string, unknown>>,
      config,
    ) as unknown as InvoiceListItem[];
  }, [items, config]);

  const activeFilterCount =
    (kind ? 1 : 0) +
    (issuedFrom || issuedTo ? 1 : 0) +
    (unpaid ? 1 : 0) +
    (q.trim() ? 1 : 0);

  const loadList = useCallback(
    async (
      opts: {
        nextTab?: string;
        append?: boolean;
        cursor?: string | null;
        nextQ?: string;
        nextKind?: KindFilter;
        nextFrom?: string;
        nextTo?: string;
        nextUnpaid?: boolean;
      } = {},
    ) => {
      const nextTab = opts.nextTab ?? tab;
      const nextQ = opts.nextQ ?? q;
      const nextKind = opts.nextKind ?? kind;
      const nextFrom = opts.nextFrom ?? issuedFrom;
      const nextTo = opts.nextTo ?? issuedTo;
      const nextUnpaid = opts.nextUnpaid ?? unpaid;
      const append = opts.append ?? false;

      setError(null);
      const params = new URLSearchParams({ limit: "50", tab: nextTab });
      if (nextQ.trim()) params.set("q", nextQ.trim());
      if (nextKind) params.set("kind", nextKind);
      if (nextFrom) params.set("issuedFrom", nextFrom);
      if (nextTo) params.set("issuedTo", nextTo);
      if (nextUnpaid) params.set("unpaid", "1");
      if (append && opts.cursor) params.set("cursor", opts.cursor);

      const res = await fetch(`/api/invoices?${params}`, { cache: "no-store" });
      const data = (await res.json()) as ListResponse;
      if (!res.ok) {
        setError(data.error || "Αποτυχία φόρτωσης");
        return;
      }
      startTransition(() => {
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
        if (data.counts) setCounts(data.counts);
        setMs(data.meta.ms);
        if (!append) {
          setSelectedIds([]);
          setPreviewId(data.items[0]?.id ?? null);
        }
      });
    },
    [tab, q, kind, issuedFrom, issuedTo, unpaid],
  );

  useEffect(() => {
    if (!previewId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/invoices/${previewId}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as DetailResponse;
      if (cancelled) return;
      if (!res.ok || !data.item) {
        setError(data.error || "Αποτυχία προεπισκόπησης");
        return;
      }
      setPreview(data.item);
    })();
    return () => {
      cancelled = true;
    };
  }, [previewId]);

  function selectPreview(id: string) {
    setPreviewId(id);
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      setMobilePreviewOpen(true);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleAll() {
    if (selectedIds.length === visibleItems.length) setSelectedIds([]);
    else setSelectedIds(visibleItems.map((i) => i.id));
  }

  function clearAdvancedFilters() {
    setKind("");
    setIssuedFrom("");
    setIssuedTo("");
    setUnpaid(false);
    void loadList({
      nextKind: "",
      nextFrom: "",
      nextTo: "",
      nextUnpaid: false,
    });
  }

  function applyPreset(kindPreset: "month" | "quarter" | "ytd" | "year") {
    const { from, to } = periodPresetDates(kindPreset);
    setIssuedFrom(from);
    setIssuedTo(to);
    void loadList({ nextFrom: from, nextTo: to });
  }

  const rowPad = density === "compact" ? "px-3 py-2" : "px-4 py-3";

  const previewPanel =
    preview && preview.id === previewId ? (
      <InvoicePreviewPanel
        preview={preview}
        onClose={() => setMobilePreviewOpen(false)}
        onDone={() => {
          void loadList();
          void (async () => {
            const res = await fetch(`/api/invoices/${preview.id}`, {
              cache: "no-store",
            });
            const data = (await res.json()) as DetailResponse;
            if (res.ok && data.item) setPreview(data.item);
          })();
        }}
      />
    ) : (
      <div className="flex h-full min-h-[22rem] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <Receipt size={26} strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-900">
            Επιλέξτε παραστατικό
          </p>
          <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-slate-500">
            Σύνολα, πελάτης, γραμμές, εισπράξεις και γρήγορες ενέργειες.
          </p>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Status tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const count =
            counts[t.id as keyof Counts] ??
            (t.id === "partial" || t.id === "cancelled" ? 0 : counts.all);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.apiTab);
                void loadList({ nextTab: t.apiTab });
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition",
                tab === t.apiTab
                  ? "bg-ink-950 text-white shadow-sm"
                  : "bg-white text-slate-600 ring-1 ring-slate-200/90 hover:bg-slate-50",
              )}
            >
              {t.label}
              <span className="ml-1.5 tabular-nums text-xs opacity-70">
                {count}
              </span>
            </button>
          );
        })}
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
                if (e.key === "Enter") void loadList({ nextQ: q });
              }}
              placeholder="Αριθμός, πελάτης ή κωδικός…"
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
            {q ? (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  void loadList({ nextQ: "" });
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
                aria-label="Καθαρισμός αναζήτησης"
              >
                <X size={14} />
              </button>
            ) : null}
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadList()}
              disabled={isPending}
            >
              <Search size={14} />
              Αναζήτηση
            </Button>
            <Button
              variant={filtersOpen || activeFilterCount > 0 ? "primary" : "secondary"}
              size="sm"
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <SlidersHorizontal size={14} />
              Φίλτρα
              {activeFilterCount > 0 ? (
                <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-[11px] font-semibold">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                title="Άνετη προβολή"
                onClick={() => setDensity("comfortable")}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg transition",
                  density === "comfortable"
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-50",
                )}
              >
                <LayoutList size={14} />
              </button>
              <button
                type="button"
                title="Συμπαγής προβολή"
                onClick={() => setDensity("compact")}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg transition",
                  density === "compact"
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-50",
                )}
              >
                <Rows3 size={14} />
              </button>
            </div>
            {listViews.length > 0 ? (
              <ViewSwitcher
                views={listViews}
                value={viewId}
                onChange={setViewId}
              />
            ) : null}
          </div>
        </div>

        {/* Kind chips always visible */}
        <div className="flex flex-wrap items-center gap-1.5">
          {kindOptions.map((k) => (
            <button
              key={k.id || "all-kinds"}
              type="button"
              onClick={() => {
                setKind(k.id);
                void loadList({ nextKind: k.id });
              }}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                kind === k.id
                  ? "bg-teal-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200/80",
              )}
            >
              {k.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const next = !unpaid;
              setUnpaid(next);
              void loadList({ nextUnpaid: next });
            }}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-medium transition",
              unpaid
                ? "bg-amber-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200/80",
            )}
          >
            Ανεξόφλητα
          </button>
        </div>

        {filtersOpen ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-slate-600">
                  Από έκδοση
                </span>
                <input
                  type="date"
                  value={issuedFrom}
                  onChange={(e) => setIssuedFrom(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-slate-600">
                  Έως έκδοση
                </span>
                <input
                  type="date"
                  value={issuedTo}
                  onChange={(e) => setIssuedTo(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                />
              </label>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["month", "Μήνας"],
                    ["quarter", "Τρίμηνο"],
                    ["ytd", "YTD"],
                    ["year", "Έτος"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                onClick={() => void loadList()}
                disabled={isPending}
              >
                <Filter size={14} />
                Εφαρμογή
              </Button>
              {activeFilterCount > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearAdvancedFilters}
                >
                  Καθαρισμός
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Active chips */}
        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-400">Ενεργά:</span>
            {q.trim() ? (
              <FilterChip
                label={`«${q.trim()}»`}
                onClear={() => {
                  setQ("");
                  void loadList({ nextQ: "" });
                }}
              />
            ) : null}
            {kind ? (
              <FilterChip
                label={
                  kindOptions.find((k) => k.id === kind)?.label ?? kind
                }
                onClear={() => {
                  setKind("");
                  void loadList({ nextKind: "" });
                }}
              />
            ) : null}
            {unpaid ? (
              <FilterChip
                label="Ανεξόφλητα"
                onClear={() => {
                  setUnpaid(false);
                  void loadList({ nextUnpaid: false });
                }}
              />
            ) : null}
            {issuedFrom || issuedTo ? (
              <FilterChip
                label={`${issuedFrom || "…"} → ${issuedTo || "…"}`}
                onClear={() => {
                  setIssuedFrom("");
                  setIssuedTo("");
                  void loadList({ nextFrom: "", nextTo: "" });
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-ink-950 px-4 py-2.5 text-sm text-white">
          <span className="font-medium">{selectedIds.length} επιλεγμένα</span>
          <Button
            size="sm"
            variant="secondary"
            className="bg-white/10 text-white hover:bg-white/20"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                setError(null);
                let ok = 0;
                for (const id of selectedIds) {
                  const res = await fetch(`/api/invoices/${id}/send`, {
                    method: "POST",
                  });
                  if (res.ok) ok += 1;
                }
                setError(
                  ok === selectedIds.length
                    ? null
                    : `Αποστολή: ${ok}/${selectedIds.length} επιτυχημένες`,
                );
                void loadList();
              });
            }}
          >
            <Send size={14} />
            Αποστολή
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="bg-white/10 text-white hover:bg-white/20"
            onClick={() => {
              for (const id of selectedIds.slice(0, 5)) {
                openInvoicePrint(id, { auto: true });
              }
            }}
          >
            <FileDown size={14} />
            PDF
          </Button>
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

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <section className="soft-panel overflow-hidden">
          {useDynamic && config.columns?.length ? (
            <div
              className={cn(
                "hidden items-center gap-3 border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400 md:flex",
                rowPad,
              )}
            >
              <input
                type="checkbox"
                checked={
                  visibleItems.length > 0 &&
                  selectedIds.length === visibleItems.length
                }
                onChange={toggleAll}
                aria-label="Επιλογή όλων"
              />
              <div className="min-w-0 flex-1">
                <DynamicListHeader
                  columns={config.columns}
                  builtins={builtins}
                  customDefs={customFields}
                />
              </div>
              <span className="w-9" />
            </div>
          ) : (
            <div
              className={cn(
                "hidden border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1.2fr)_5.5rem_6.5rem_5.5rem_auto] md:items-center md:gap-3",
                rowPad,
              )}
            >
              <input
                type="checkbox"
                checked={
                  visibleItems.length > 0 &&
                  selectedIds.length === visibleItems.length
                }
                onChange={toggleAll}
                aria-label="Επιλογή όλων"
              />
              <span>Αριθμός</span>
              <span>Πελάτης</span>
              <span className="text-right">Ποσό</span>
              <span>Κατάσταση</span>
              <span>Υπόλοιπο</span>
              <span className="w-9" />
            </div>
          )}

          <ul className="divide-y divide-slate-100">
            {visibleItems.map((inv) => {
              const status = inv.status as InvoiceStatusKey;
              const ratio = paidRatio(inv.paidAmount, inv.total);
              const balance = Math.max(
                0,
                Math.round((inv.total - inv.paidAmount) * 100) / 100,
              );
              const overdue =
                Boolean(inv.dueAt) &&
                balance > 0 &&
                new Date(inv.dueAt!).getTime() < Date.now() &&
                status !== "CANCELLED" &&
                status !== "PAID";

              if (useDynamic && config) {
                return (
                  <li key={inv.id} className="soft-row">
                    <div
                      className={cn(
                        "flex items-center gap-3 transition-colors",
                        rowPad,
                        previewId === inv.id && "bg-teal-50/70",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(inv.id)}
                        onChange={() => toggleSelect(inv.id)}
                        aria-label={`Επιλογή ${inv.number}`}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => selectPreview(inv.id)}
                      >
                        <DynamicListCells
                          columns={config.columns}
                          builtins={builtins}
                          customDefs={customFields}
                          row={inv as unknown as Record<string, unknown>}
                        />
                      </button>
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"
                        aria-label={`Επεξεργασία ${inv.number}`}
                      >
                        <Pencil size={15} />
                      </Link>
                    </div>
                  </li>
                );
              }

              return (
                <li key={inv.id} className="soft-row">
                  <div
                    className={cn(
                      "grid grid-cols-[auto_1fr_auto] gap-3 transition-colors md:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1.2fr)_5.5rem_6.5rem_5.5rem_auto] md:items-center",
                      rowPad,
                      previewId === inv.id && "bg-teal-50/70",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(inv.id)}
                      onChange={() => toggleSelect(inv.id)}
                      aria-label={`Επιλογή ${inv.number}`}
                      className="mt-1 md:mt-0"
                    />
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => selectPreview(inv.id)}
                    >
                      <p className="truncate text-sm font-semibold text-ink-950">
                        {inv.number}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {fmtShortDate(inv.issuedAt ?? inv.createdAt)}
                        {inv.kind && inv.kind !== "SALES_INVOICE"
                          ? ` · ${
                              invoiceKindLabel[
                                inv.kind as keyof typeof invoiceKindLabel
                              ] ?? inv.kind
                            }`
                          : ""}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500 md:hidden">
                        {inv.customerName}
                      </p>
                    </button>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 md:hidden"
                      aria-label={`Επεξεργασία ${inv.number}`}
                    >
                      <Pencil size={15} />
                    </Link>
                    <button
                      type="button"
                      className="hidden min-w-0 text-left md:block"
                      onClick={() => selectPreview(inv.id)}
                    >
                      <p className="truncate text-sm font-medium text-ink-900">
                        {inv.customerName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {[inv.branchName, inv.spaceName]
                          .filter(Boolean)
                          .join(" · ") || inv.customerCode}
                      </p>
                    </button>
                    <p className="col-start-2 text-sm font-semibold tabular-nums md:col-start-auto md:text-right">
                      {formatEUR(inv.total)}
                    </p>
                    <div className="col-start-3 row-start-2 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-auto">
                      <Badge tone={invoiceStatusTone[status] ?? "slate"}>
                        {invoiceStatusLabel[status] ?? inv.status}
                      </Badge>
                    </div>
                    <div className="col-span-2 col-start-2 md:col-span-1 md:col-start-auto">
                      <p
                        className={cn(
                          "text-sm font-medium tabular-nums",
                          balance > 0
                            ? overdue
                              ? "text-rose-700"
                              : "text-amber-700"
                            : "text-emerald-700",
                        )}
                      >
                        {formatEUR(balance)}
                      </p>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            ratio >= 1
                              ? "bg-emerald-500"
                              : ratio > 0
                                ? "bg-teal-500"
                                : "bg-slate-300",
                          )}
                          style={{ width: `${Math.round(ratio * 100)}%` }}
                        />
                      </div>
                    </div>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="hidden h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 md:inline-flex"
                      aria-label={`Επεξεργασία ${inv.number}`}
                    >
                      <Pencil size={15} />
                    </Link>
                  </div>
                </li>
              );
            })}
            {visibleItems.length === 0 ? (
              <li className="px-4 py-14 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Receipt size={22} />
                </div>
                <p className="mt-3 text-sm font-medium text-ink-900">
                  Κανένα αποτέλεσμα
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Δοκιμάστε άλλο tab, είδος ή εύρος ημερομηνιών.
                </p>
                {activeFilterCount > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    onClick={clearAdvancedFilters}
                  >
                    Καθαρισμός φίλτρων
                  </Button>
                ) : null}
              </li>
            ) : null}
          </ul>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">
              <span className="font-medium text-ink-800">
                {visibleItems.length}
              </span>{" "}
              εμφανίζονται
              {nextCursor ? " · περισσότερα διαθέσιμα" : ""}
              <span className="ml-2 tabular-nums text-slate-400">{ms} ms</span>
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={!nextCursor || isPending}
              onClick={() =>
                void loadList({ append: true, cursor: nextCursor })
              }
            >
              Επόμενα
            </Button>
          </div>
        </section>

        <aside className="soft-panel hidden min-h-0 self-start overflow-hidden xl:sticky xl:top-20 xl:block xl:h-[calc(100dvh-6rem)] xl:max-h-[calc(100dvh-6rem)]">
          {previewPanel}
        </aside>
      </div>

      {mobilePreviewOpen && previewId ? (
        <MobilePreviewSheet onClose={() => setMobilePreviewOpen(false)}>
          {previewPanel}
        </MobilePreviewSheet>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-800 ring-1 ring-teal-200/80">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="rounded-full p-0.5 hover:bg-teal-100"
        aria-label={`Αφαίρεση ${label}`}
      >
        <X size={12} />
      </button>
    </span>
  );
}

function MobilePreviewSheet({
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
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-center py-2">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function InvoicePreviewPanel({
  preview,
  onDone,
  onClose,
}: {
  preview: DetailItem;
  onDone: () => void;
  onClose?: () => void;
}) {
  const status = preview.status as InvoiceStatusKey;
  const balance = Math.max(
    0,
    Math.round((preview.total - preview.paidAmount) * 100) / 100,
  );
  const ratio = paidRatio(preview.paidAmount, preview.total);
  const pct = Math.round(ratio * 100);
  const kindLabel =
    invoiceKindLabel[preview.kind as keyof typeof invoiceKindLabel] ??
    preview.kind ??
    "Παραστατικό";
  const overdue =
    Boolean(preview.dueAt) &&
    balance > 0 &&
    new Date(preview.dueAt!).getTime() < Date.now() &&
    status !== "CANCELLED";
  const daysToDue = preview.dueAt
    ? Math.ceil(
        (new Date(preview.dueAt).getTime() - Date.now()) / 86_400_000,
      )
    : null;
  const payments = preview.payments ?? [];
  const contactPhone = preview.customer.mobile || preview.customer.phone;

  return (
    <div className="flex h-full min-h-0 max-h-full flex-col">
      <div className="relative shrink-0 overflow-hidden border-b border-slate-100 bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 px-5 pb-5 pt-4 text-white">
        <div
          className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-teal-400/20 blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 left-8 size-36 rounded-full bg-sky-400/10 blur-2xl"
          aria-hidden
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
              Προεπισκόπηση
            </p>
            <h2 className="mt-1 truncate font-mono text-xl font-semibold tracking-tight">
              {preview.number}
            </h2>
            <p className="mt-0.5 truncate text-sm text-white/75">
              {preview.customer.name}
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <Badge
              tone={invoiceStatusTone[status] ?? "slate"}
              className="bg-white/95 shadow-sm"
            >
              {invoiceStatusLabel[status] ?? preview.status}
            </Badge>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-white/10 p-1.5 text-white/80 ring-1 ring-white/15 hover:bg-white/20 xl:hidden"
                aria-label="Κλείσιμο"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 ring-1 ring-white/15">
            {kindLabel}
          </span>
          {preview.series ? (
            <span className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 ring-1 ring-white/15">
              Σειρά {preview.series.code}
            </span>
          ) : null}
          {preview.series?.myDataInvoiceType ? (
            <span className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 ring-1 ring-white/15">
              myDATA {preview.series.myDataInvoiceType}
            </span>
          ) : null}
          {overdue ? (
            <span className="rounded-lg bg-rose-400/25 px-2 py-0.5 text-[11px] font-semibold text-rose-100 ring-1 ring-rose-300/30">
              Ληξιπρόθεσμο
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
        <div className="rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50 to-white p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Σύνολο
              </p>
              <p className="mt-0.5 text-3xl font-semibold tracking-tight text-ink-950 tabular-nums">
                {formatEUR(preview.total)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Υπόλοιπο
              </p>
              <p
                className={cn(
                  "mt-0.5 text-lg font-semibold tabular-nums",
                  balance > 0 ? "text-amber-700" : "text-emerald-700",
                )}
              >
                {formatEUR(balance)}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Εξόφληση</span>
              <span className="font-medium text-ink-800">
                {pct}% · {formatEUR(preview.paidAmount)} εισπραχθέντα
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200/80">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  pct >= 100
                    ? "bg-emerald-500"
                    : pct > 0
                      ? "bg-teal-500"
                      : "bg-slate-300",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                Καθαρή
              </dt>
              <dd className="mt-0.5 text-xs font-semibold tabular-nums text-ink-900">
                {formatEUR(preview.subtotal)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                ΦΠΑ
              </dt>
              <dd className="mt-0.5 text-xs font-semibold tabular-nums text-ink-900">
                {formatEUR(preview.vatAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                Γραμμές
              </dt>
              <dd className="mt-0.5 text-xs font-semibold tabular-nums text-ink-900">
                {preview.lines.length}
              </dd>
            </div>
          </dl>
        </div>

        <section>
          <SectionLabel>Πελάτης</SectionLabel>
          <div className="mt-2 rounded-2xl border border-slate-100 p-3">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <UserRound size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">
                  {preview.customer.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {[
                    preview.customer.code || preview.customerCode,
                    preview.customer.vatNumber
                      ? `ΑΦΜ ${preview.customer.vatNumber}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                  {preview.customer.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail size={12} className="text-slate-400" />
                      <span className="truncate">{preview.customer.email}</span>
                    </span>
                  ) : null}
                  {contactPhone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone size={12} className="text-slate-400" />
                      {contactPhone}
                    </span>
                  ) : null}
                  {!preview.customer.email && !contactPhone ? (
                    <span className="text-slate-400">
                      Χωρίς στοιχεία επικοινωνίας
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Στοιχεία</SectionLabel>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <MetaTile
              icon={CalendarDays}
              label="Έκδοση"
              value={
                preview.issuedAt
                  ? new Date(preview.issuedAt).toLocaleDateString("el-GR")
                  : "—"
              }
            />
            <MetaTile
              icon={CalendarClock}
              label="Λήξη"
              value={
                preview.dueAt
                  ? new Date(preview.dueAt).toLocaleDateString("el-GR")
                  : "—"
              }
              hint={
                daysToDue == null
                  ? undefined
                  : daysToDue < 0
                    ? `${Math.abs(daysToDue)}η καθυστ.`
                    : daysToDue === 0
                      ? "Σήμερα"
                      : `σε ${daysToDue}η`
              }
              tone={overdue ? "rose" : undefined}
            />
            {preview.branch?.name ? (
              <MetaTile
                icon={Building2}
                label="Υποκατάστημα"
                value={preview.branch.name}
                hint={preview.branch.city ?? undefined}
              />
            ) : null}
            {preview.space?.name || preview.site?.code ? (
              <MetaTile
                icon={MapPin}
                label="Χώρος"
                value={preview.space?.name ?? preview.site?.code ?? "—"}
                hint={preview.space?.code ?? preview.site?.name}
              />
            ) : null}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel className="mb-0">Γραμμές</SectionLabel>
            <span className="text-[11px] text-slate-400">
              {preview.lines.length} είδη
            </span>
          </div>
          <ul className="space-y-1.5">
            {preview.lines.map((line, idx) => {
              const net =
                Math.round(line.quantity * line.unitPrice * 100) / 100;
              const vat =
                Math.round(((net * line.vatRate) / 100) * 100) / 100;
              return (
                <li
                  key={line.id}
                  className="rounded-xl border border-slate-100 bg-white px-3 py-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-mono text-[10px] font-semibold text-slate-500">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-snug text-ink-900">
                          {line.description}
                        </p>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-ink-950">
                          {formatEUR(line.lineTotal)}
                        </p>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {line.quantity} × {formatEUR(line.unitPrice)}
                        {line.product?.sku ? ` · ${line.product.sku}` : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Καθαρή {formatEUR(net)} · ΦΠΑ {line.vatRate}% (
                        {formatEUR(vat)})
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
            {preview.lines.length === 0 ? (
              <li className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                Καμία γραμμή
              </li>
            ) : null}
          </ul>
        </section>

        {payments.length > 0 ? (
          <section>
            <SectionLabel>Εισπράξεις</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {payments.slice(0, 5).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100/80 bg-emerald-50/40 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium text-ink-900">
                      <Wallet size={13} className="shrink-0 text-emerald-600" />
                      {p.method}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {new Date(p.paidAt).toLocaleString("el-GR")}
                      {p.externalRef ? ` · ${p.externalRef}` : ""}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums text-emerald-800">
                    {formatEUR(p.amount)}
                  </p>
                </li>
              ))}
              {payments.length > 5 ? (
                <li className="text-center text-[11px] text-slate-400">
                  +{payments.length - 5} ακόμη στην πλήρη καρτέλα
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        {preview.notes ? (
          <section>
            <SectionLabel>Σημειώσεις</SectionLabel>
            <p className="mt-2 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 text-xs leading-relaxed text-slate-700">
              {preview.notes}
            </p>
          </section>
        ) : null}
      </div>

      <div className="shrink-0 space-y-2 border-t border-slate-100 bg-white px-5 py-3">
        <InvoiceActions
          invoiceId={preview.id}
          status={preview.status}
          total={preview.total}
          paidAmount={preview.paidAmount}
          onDone={onDone}
        />
        <Link
          href={`/invoices/${preview.id}`}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-teal-700 hover:bg-teal-50"
        >
          <Hash size={12} />
          Πλήρης καρτέλα
        </Link>
      </div>
    </div>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wide text-slate-400",
        className,
      )}
    >
      {children}
    </p>
  );
}

function MetaTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  hint?: string;
  tone?: "rose";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        tone === "rose"
          ? "border-rose-100 bg-rose-50/50"
          : "border-slate-100 bg-slate-50/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        <Icon size={11} />
        {label}
      </div>
      <p
        className={cn(
          "mt-1 truncate text-sm font-semibold",
          tone === "rose" ? "text-rose-800" : "text-ink-900",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p
          className={cn(
            "mt-0.5 truncate text-[11px]",
            tone === "rose" ? "text-rose-600" : "text-slate-500",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
