"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  FileDown,
  Filter,
  Hash,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Receipt,
  Search,
  Send,
  UserRound,
  Wallet,
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

        <aside className="soft-panel hidden min-h-0 self-start overflow-hidden xl:sticky xl:top-20 xl:block xl:h-[calc(100dvh-6rem)] xl:max-h-[calc(100dvh-6rem)]">
          {preview && preview.id === previewId ? (
            <InvoicePreviewPanel
              preview={preview}
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
          ) : (
            <div className="flex h-full min-h-[28rem] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <Receipt size={26} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  Επιλέξτε παραστατικό
                </p>
                <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-slate-500">
                  Η προεπισκόπηση δείχνει σύνολα, πελάτη, γραμμές, εισπράξεις και
                  γρήγορες ενέργειες.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function InvoicePreviewPanel({
  preview,
  onDone,
}: {
  preview: DetailItem;
  onDone: () => void;
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
      {/* Hero header */}
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
          <Badge
            tone={invoiceStatusTone[status] ?? "slate"}
            className="shrink-0 bg-white/95 shadow-sm"
          >
            {invoiceStatusLabel[status] ?? preview.status}
          </Badge>
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
        {/* Amounts + progress */}
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

        {/* Customer */}
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
                    <span className="text-slate-400">Χωρίς στοιχεία επικοινωνίας</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Meta */}
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
            <MetaTile
              icon={Building2}
              label="Υποκατάστημα"
              value={preview.branch?.name ?? "—"}
              hint={preview.branch?.city ?? undefined}
            />
            <MetaTile
              icon={MapPin}
              label="Χώρος"
              value={preview.space?.name ?? "—"}
              hint={preview.space?.code ?? preview.site?.code}
            />
          </div>
        </section>

        {/* Lines */}
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

        {/* Payments */}
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

      {/* Footer actions — shrink-0 so the scroll region above stays bounded */}
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
