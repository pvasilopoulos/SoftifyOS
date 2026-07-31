"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { FileDown, Filter, Pencil, Search, Send } from "lucide-react";
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
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import {
  DynamicListCells,
  DynamicListHeader,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import {
  matchesFilters,
  sortRows,
  type ListViewConfig,
} from "@/modules/entity-views/types";

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
    email: string | null;
    vatNumber: string | null;
    phone: string | null;
  };
  branch: { name: string; city: string | null } | null;
  space: { name: string; code: string } | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    lineTotal: number;
  }>;
};

type DetailResponse = {
  item?: DetailItem;
  error?: string;
};

const tabs: Array<{ id: keyof Counts | "all"; label: string; apiTab: string }> =
  [
    { id: "all", label: "Όλα", apiTab: "all" },
    { id: "pending", label: "Εκκρεμή", apiTab: "pending" },
    { id: "issued", label: "Εκδομένα", apiTab: "issued" },
    { id: "overdue", label: "Ληξιπρόθεσμα", apiTab: "overdue" },
    { id: "paid", label: "Πληρωμένα", apiTab: "paid" },
    { id: "draft", label: "Πρόχειρα", apiTab: "draft" },
  ];

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(
    initialItems[0]?.id ?? null,
  );
  const [preview, setPreview] = useState<DetailItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activeView = listViews.find((v) => v.id === viewId) ?? defaultView;
  const config = activeView?.config;
  const useDynamic = Boolean(config?.columns?.length);
  const builtins = ENTITY_REGISTRY.INVOICES.builtins;

  const visibleItems = useMemo(() => {
    const filtered = !config?.filters?.length
      ? items
      : items.filter((row) =>
          matchesFilters(
            row as unknown as Record<string, unknown>,
            config.filters,
          ),
        );
    return sortRows(
      filtered as unknown as Array<Record<string, unknown>>,
      config?.sort,
    ) as unknown as InvoiceListItem[];
  }, [items, config]);

  useEffect(() => {
    if (!previewId) return;
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

  async function loadList(
    nextTab = tab,
    append = false,
    cursor?: string | null,
  ) {
    setError(null);
    const params = new URLSearchParams({ limit: "50", tab: nextTab });
    if (q.trim()) params.set("q", q.trim());
    if (append && cursor) params.set("cursor", cursor);
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

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.apiTab);
              void loadList(t.apiTab, false);
            }}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition",
              tab === t.apiTab
                ? "bg-ink-950 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-70">
              {counts[t.id as keyof Counts] ?? counts.all}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <ViewSwitcher
          views={listViews}
          value={viewId}
          onChange={setViewId}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="soft-surface flex flex-1 items-center gap-2 px-3 py-2.5">
          <Search size={16} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadList(tab, false);
            }}
            placeholder="Αναζήτηση αριθμού ή πελάτη..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => void loadList(tab, false)}
          disabled={isPending}
        >
          <Filter size={16} />
          Εφαρμογή
        </Button>
        <Badge tone={ms < 200 ? "emerald" : "amber"}>{ms} ms</Badge>
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
                void loadList(tab, false);
                if (previewId) {
                  const res = await fetch(`/api/invoices/${previewId}`, {
                    cache: "no-store",
                  });
                  const data = (await res.json()) as DetailResponse;
                  if (res.ok && data.item) setPreview(data.item);
                }
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
                window.open(`/invoices/${id}/print`, "_blank", "noopener");
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

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
        <section className="soft-panel overflow-hidden">
          <div className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[auto_1fr_1.2fr_0.7fr_0.8fr_0.8fr] md:gap-3">
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
            <span>{useDynamic ? "Προβολή" : "Πληρωμή"}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {visibleItems.map((inv) => {
              const status = inv.status as InvoiceStatusKey;
              const ratio = paidRatio(inv.paidAmount, inv.total);
              if (useDynamic && config) {
                return (
                  <li key={inv.id} className="soft-row">
                    <div
                      className={cn(
                        "flex items-center gap-3 px-4 py-3",
                        previewId === inv.id && "bg-teal-50/60",
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
                        onClick={() => setPreviewId(inv.id)}
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
                      "grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3 md:grid-cols-[auto_1fr_1.2fr_0.7fr_0.8fr_0.8fr] md:items-center",
                      previewId === inv.id && "bg-teal-50/60",
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
                      onClick={() => setPreviewId(inv.id)}
                    >
                      <p className="text-sm font-semibold text-ink-950">
                        {inv.number}
                      </p>
                      {inv.kind && inv.kind !== "SALES_INVOICE" ? (
                        <p className="text-[11px] font-medium text-amber-800">
                          {invoiceKindLabel[
                            inv.kind as keyof typeof invoiceKindLabel
                          ] ?? inv.kind}
                        </p>
                      ) : null}
                      <p className="text-xs text-slate-500 md:hidden">
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
                      onClick={() => setPreviewId(inv.id)}
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
                    <p className="col-start-2 text-sm font-medium md:col-start-auto md:text-right">
                      {formatEUR(inv.total)}
                    </p>
                    <div className="col-start-3 row-start-2 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-auto">
                      <Badge tone={invoiceStatusTone[status] ?? "slate"}>
                        {invoiceStatusLabel[status] ?? inv.status}
                      </Badge>
                    </div>
                    <div className="col-span-2 col-start-2 md:col-span-1 md:col-start-auto">
                      <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                        <span>{Math.round(ratio * 100)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-teal-500"
                          style={{ width: `${Math.round(ratio * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
            {visibleItems.length === 0 ? (
              <li className="px-4 py-12 text-center text-sm text-slate-500">
                Δεν βρέθηκαν τιμολόγια για αυτή την προβολή.
              </li>
            ) : null}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">
              {visibleItems.length} εμφανίζονται · cursor pagination
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={!nextCursor || isPending}
              onClick={() => void loadList(tab, true, nextCursor)}
            >
              Επόμενα
            </Button>
          </div>
        </section>

        <aside className="soft-panel hidden p-5 xl:block">
          {preview && preview.id === previewId ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    Προεπισκόπηση
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-950">
                    {preview.number}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {preview.customer.name}
                  </p>
                </div>
                <Badge
                  tone={
                    invoiceStatusTone[preview.status as InvoiceStatusKey] ??
                    "slate"
                  }
                >
                  {invoiceStatusLabel[preview.status as InvoiceStatusKey] ??
                    preview.status}
                </Badge>
              </div>

              <p className="text-3xl font-semibold tracking-tight text-ink-950">
                {formatEUR(preview.total)}
              </p>
              <p className="text-sm text-slate-500">
                Υπόλοιπο{" "}
                <span className="font-medium text-ink-900">
                  {formatEUR(preview.total - preview.paidAmount)}
                </span>
              </p>

              <div className="space-y-1.5 text-sm">
                <Row
                  label="Υποκατάστημα"
                  value={preview.branch?.name ?? "—"}
                />
                <Row label="Χώρος" value={preview.space?.name ?? "—"} />
                <Row
                  label="Έκδοση"
                  value={
                    preview.issuedAt
                      ? new Date(preview.issuedAt).toLocaleDateString("el-GR")
                      : "—"
                  }
                />
                <Row
                  label="Λήξη"
                  value={
                    preview.dueAt
                      ? new Date(preview.dueAt).toLocaleDateString("el-GR")
                      : "—"
                  }
                />
                <Row label="ΑΦΜ" value={preview.customer.vatNumber ?? "—"} />
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Γραμμές
                </p>
                <ul className="space-y-2">
                  {preview.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium text-ink-900">
                          {line.description}
                        </p>
                        <p className="text-xs text-slate-500">
                          {line.quantity} × {formatEUR(line.unitPrice)} · ΦΠΑ{" "}
                          {line.vatRate}%
                        </p>
                      </div>
                      <p className="font-medium">{formatEUR(line.lineTotal)}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2 pt-1">
                <InvoiceActions
                  invoiceId={preview.id}
                  status={preview.status}
                  total={preview.total}
                  paidAmount={preview.paidAmount}
                  onDone={() => {
                    void loadList(tab, false);
                    void (async () => {
                      const res = await fetch(`/api/invoices/${preview.id}`, {
                        cache: "no-store",
                      });
                      const data = (await res.json()) as DetailResponse;
                      if (res.ok && data.item) setPreview(data.item);
                    })();
                  }}
                />
                <Link
                  href={`/invoices/${preview.id}`}
                  className="inline-flex h-8 items-center rounded-xl px-3 text-xs font-medium text-teal-700 hover:bg-teal-50"
                >
                  Πλήρης καρτέλα
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Επιλέξτε τιμολόγιο</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-slate-500">
      <span>{label}</span>
      <span className="text-right text-ink-900">{value}</span>
    </div>
  );
}
