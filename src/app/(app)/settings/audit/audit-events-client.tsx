"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Filter,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Copy,
  Check,
  UserRound,
  Clock3,
  Activity,
  KeyRound,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Drawer } from "@/shared/ui/drawer";
import { cn } from "@/shared/lib/cn";
import {
  parseAuditMeta,
  type AuditChange,
} from "@/platform/tenancy/audit-diff";

type AuditUser = {
  id: string;
  name: string;
  email: string;
};

type AuditItem = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  createdAt: string;
  userId: string | null;
  meta?: unknown;
  user?: AuditUser | null;
};

type Summary = {
  lastHour: number;
  last24h: number;
  auth24h: number;
  risk24h: number;
};

type ListResponse = {
  items: AuditItem[];
  nextCursor: string | null;
  meta: {
    ms: number;
    total: number;
    hasMore?: boolean;
    count?: number;
  };
  summary?: Summary | null;
  error?: string;
};

type Filters = {
  q: string;
  action: string;
  entity: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  action: "",
  entity: "",
  from: "",
  to: "",
};

const PAGE_SIZES = [25, 50, 100] as const;

const ACTION_PRESETS = [
  { value: "", label: "Όλες οι ενέργειες" },
  { value: "auth.", label: "Auth" },
  { value: "settings.", label: "Ρυθμίσεις" },
  { value: "customer.", label: "Πελάτες" },
  { value: "product.", label: "Προϊόντα" },
  { value: "invoice.", label: "Τιμολόγια" },
  { value: "order.", label: "Παραγγελίες" },
  { value: "quote.", label: "Προσφορές" },
  { value: "banking.", label: "Τράπεζες" },
  { value: "script.", label: "Scripts" },
] as const;

const ENTITY_PRESETS = [
  { value: "", label: "Όλες οι οντότητες" },
  { value: "user", label: "user" },
  { value: "customer", label: "customer" },
  { value: "product", label: "product" },
  { value: "invoice", label: "invoice" },
  { value: "order", label: "order" },
  { value: "tenant_settings", label: "tenant_settings" },
  { value: "script_definition", label: "script_definition" },
  { value: "membership", label: "membership" },
  { value: "bank_statement_line", label: "bank_statement_line" },
] as const;

function actionTone(
  action: string,
): "teal" | "amber" | "slate" | "rose" | "emerald" {
  if (action.includes("delete") || action.includes("fail") || action.includes("cancel"))
    return "rose";
  if (action.startsWith("auth.login")) return "emerald";
  if (action.startsWith("auth.")) return "slate";
  if (action.startsWith("settings.")) return "amber";
  if (action.includes("create") || action.includes("issue")) return "emerald";
  if (action.includes("update") || action.includes("patch")) return "teal";
  return "slate";
}

function actionFamily(action: string) {
  const i = action.indexOf(".");
  return i > 0 ? action.slice(0, i) : action;
}

function shortId(id: string | null | undefined) {
  if (!id) return "—";
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function entityHref(entity: string | null, entityId: string | null) {
  if (!entity || !entityId) return null;
  switch (entity) {
    case "customer":
      return `/customers/${entityId}`;
    case "product":
      return `/products/${entityId}`;
    case "invoice":
      return `/invoices/${entityId}`;
    case "order":
      return `/orders/${entityId}`;
    default:
      return null;
  }
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return {
    absolute: d.toLocaleString("el-GR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    relative: relativeTime(d),
  };
}

function relativeTime(d: Date) {
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "μόλις τώρα";
  const min = Math.round(sec / 60);
  if (min < 60) return `πριν ${min} λεπ.`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `πριν ${hr} ώρ.`;
  const day = Math.round(hr / 24);
  if (day < 30) return `πριν ${day} ημ.`;
  return d.toLocaleDateString("el-GR");
}

function fromLocalInputValue(local: string) {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function toDatetimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildQuery(
  filters: Filters,
  opts: { cursor?: string | null; limit: number; summary?: boolean },
) {
  const params = new URLSearchParams({ limit: String(opts.limit) });
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.summary) params.set("summary", "1");
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.action) params.set("action", filters.action);
  if (filters.entity) params.set("entity", filters.entity);
  const from = fromLocalInputValue(filters.from);
  const to = fromLocalInputValue(filters.to);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params;
}

function CopyButton({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title="Αντιγραφή"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      {ok ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
    </button>
  );
}

export function AuditEventsClient({
  initialItems,
  initialNextCursor,
  initialMs,
  initialTotal,
  initialSummary = null,
}: {
  initialItems: AuditItem[];
  initialNextCursor: string | null;
  initialMs: number;
  initialTotal: number;
  initialSummary?: Summary | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [ms, setMs] = useState(initialMs);
  const [total, setTotal] = useState(initialTotal);
  const [summary, setSummary] = useState<Summary | null>(initialSummary);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50);
  /** Cursors used to fetch each page (index 0 = null = first page). */
  const [pageCursors, setPageCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [detail, setDetail] = useState<AuditItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [live, setLive] = useState(false);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.q) n += 1;
    if (filters.action) n += 1;
    if (filters.entity) n += 1;
    if (filters.from) n += 1;
    if (filters.to) n += 1;
    return n;
  }, [filters]);

  const rangeStart = total === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min(total, pageIndex * pageSize + items.length);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  async function fetchPage(opts: {
    filters: Filters;
    cursor?: string | null;
    limit?: number;
    withSummary?: boolean;
  }) {
    setError(null);
    const limit = opts.limit ?? pageSize;
    const params = buildQuery(opts.filters, {
      cursor: opts.cursor,
      limit,
      summary: opts.withSummary ?? true,
    });
    const res = await fetch(`/api/audit-events?${params}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as ListResponse;
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return null;
    }
    startTransition(() => {
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setMs(data.meta.ms);
      setTotal(data.meta.total);
      if (data.summary) setSummary(data.summary);
    });
    return data;
  }

  function resetToFirst(nextFilters: Filters, nextLimit = pageSize) {
    setPageCursors([null]);
    setPageIndex(0);
    void fetchPage({
      filters: nextFilters,
      cursor: null,
      limit: nextLimit,
      withSummary: true,
    });
  }

  function applyFilters() {
    setFilters(draft);
    resetToFirst(draft);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    resetToFirst(EMPTY_FILTERS);
  }

  function refresh() {
    void fetchPage({
      filters,
      cursor: pageCursors[pageIndex] ?? null,
      withSummary: true,
    });
  }

  async function goNext() {
    if (!nextCursor || isPending) return;
    const data = await fetchPage({ filters, cursor: nextCursor });
    if (!data) return;
    setPageCursors((prev) => {
      const trimmed = prev.slice(0, pageIndex + 1);
      return [...trimmed, nextCursor];
    });
    setPageIndex((i) => i + 1);
  }

  async function goPrev() {
    if (pageIndex <= 0 || isPending) return;
    const prevIdx = pageIndex - 1;
    const cursor = pageCursors[prevIdx] ?? null;
    const data = await fetchPage({ filters, cursor });
    if (!data) return;
    setPageIndex(prevIdx);
  }

  function exportCsv() {
    const header = [
      "createdAt",
      "action",
      "entity",
      "entityId",
      "userName",
      "userEmail",
      "eventId",
    ];
    const lines = [
      header.join(","),
      ...items.map((item) =>
        [
          item.createdAt,
          item.action,
          item.entity ?? "",
          item.entityId ?? "",
          item.user?.name ?? "",
          item.user?.email ?? "",
          item.id,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function applyQuick(patch: Partial<Filters>) {
    const next = { ...EMPTY_FILTERS, ...patch };
    setDraft(next);
    setFilters(next);
    resetToFirst(next);
  }

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (pageIndex === 0) {
        void fetchPage({
          filters,
          cursor: null,
          withSummary: true,
        });
      }
    }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, filters, pageIndex, pageSize]);

  const quickChips = [
    {
      id: "hour",
      label: "Τελευταία ώρα",
      active: Boolean(filters.from) && !filters.action && !filters.q,
      onClick: () => {
        const from = toDatetimeLocal(new Date(Date.now() - 60 * 60_000));
        applyQuick({ from });
      },
    },
    {
      id: "auth",
      label: "Auth",
      active: filters.action === "auth.",
      onClick: () => applyQuick({ action: "auth." }),
    },
    {
      id: "orders",
      label: "Παραγγελίες",
      active: filters.action === "order.",
      onClick: () => applyQuick({ action: "order." }),
    },
    {
      id: "invoices",
      label: "Τιμολόγια",
      active: filters.action === "invoice.",
      onClick: () => applyQuick({ action: "invoice." }),
    },
    {
      id: "risk",
      label: "Διαγραφές / αποτυχίες",
      active: filters.q === "delete",
      onClick: () => applyQuick({ q: "delete" }),
    },
  ] as const;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Καταγραφή ενεργειών"
        description="Audit trail με φίλτρα, σελιδοποίηση και λεπτομέρειες αλλαγών."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ms < 200 ? "emerald" : "amber"}>{ms} ms</Badge>
            <Button
              variant={live ? "primary" : "secondary"}
              size="sm"
              onClick={() => setLive((v) => !v)}
              title="Αυτόματη ανανέωση κάθε 15″ (μόνο 1η σελίδα)"
            >
              <Radio size={14} className={cn(live && "text-rose-200")} />
              {live ? "Live" : "Live off"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <Filter size={14} />
              Φίλτρα
              {activeFilterCount > 0 ? (
                <span className="ml-1 rounded-md bg-teal-100 px-1.5 text-[10px] font-semibold text-teal-800">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={exportCsv}
              disabled={items.length === 0}
            >
              <Download size={14} /> CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={refresh}
              disabled={isPending}
            >
              <RefreshCw
                size={14}
                className={cn(isPending && "animate-spin")}
              />
              Ανανέωση
            </Button>
          </div>
        }
      />

      {summary ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            icon={<Activity size={15} />}
            label="Τελευταία ώρα"
            value={summary.lastHour}
          />
          <Kpi
            icon={<Clock3 size={15} />}
            label="Τελευταίες 24ώρες"
            value={summary.last24h}
          />
          <Kpi
            icon={<KeyRound size={15} />}
            label="Auth · 24ώρες"
            value={summary.auth24h}
            onClick={() => applyQuick({ action: "auth." })}
          />
          <Kpi
            icon={<AlertTriangle size={15} />}
            label="Ρίσκο · 24ώρες"
            value={summary.risk24h}
            tone={summary.risk24h > 0 ? "rose" : "slate"}
            onClick={() => applyQuick({ q: "delete" })}
          />
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {quickChips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={chip.onClick}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              chip.active
                ? "border-ink-900 bg-ink-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            {chip.label}
          </button>
        ))}
        {activeFilterCount > 0 ? (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-1 text-xs font-medium text-teal-700 hover:underline"
          >
            Καθαρισμός
          </button>
        ) : null}
      </div>

      {filtersOpen ? (
        <section className="soft-panel space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <Filter size={15} className="text-slate-400" />
            Προχωρημένα φίλτρα
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <div className="relative xl:col-span-2">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={draft.q}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, q: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="Αναζήτηση ενέργειας, οντότητας, χρήστη…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
            <select
              value={draft.action}
              onChange={(e) =>
                setDraft((d) => ({ ...d, action: e.target.value }))
              }
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300"
            >
              {ACTION_PRESETS.map((p) => (
                <option key={p.value || "all"} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              value={draft.entity}
              onChange={(e) =>
                setDraft((d) => ({ ...d, entity: e.target.value }))
              }
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300"
            >
              {ENTITY_PRESETS.map((p) => (
                <option key={p.value || "all"} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="datetime-local"
                value={draft.from}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, from: e.target.value }))
                }
                className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-teal-300"
                title="Από"
              />
              <input
                type="datetime-local"
                value={draft.to}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, to: e.target.value }))
                }
                className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-teal-300"
                title="Έως"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={applyFilters} disabled={isPending}>
              Εφαρμογή
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearFilters}
              disabled={isPending}
            >
              Καθαρισμός
            </Button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <section className="soft-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield size={15} className="text-slate-400" />
            <p className="text-sm font-semibold text-ink-900">Γεγονότα</p>
            {live ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
                Live
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {rangeStart.toLocaleString("el-GR")}–
            {rangeEnd.toLocaleString("el-GR")} από{" "}
            {total.toLocaleString("el-GR")}
          </p>
        </div>

        <div className="sticky top-0 z-10 hidden border-b border-slate-100 bg-slate-50/95 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400 backdrop-blur lg:grid lg:grid-cols-[minmax(0,1.4fr)_0.7fr_0.9fr_1fr_0.9fr_40px] lg:gap-3">
          <span>Ενέργεια</span>
          <span>Οντότητα</span>
          <span>Αναφορά</span>
          <span>Χρήστης</span>
          <span>Χρόνος</span>
          <span />
        </div>

        <ul
          className={cn(
            "divide-y divide-slate-100",
            isPending && "opacity-60 transition-opacity",
          )}
        >
          {items.map((item) => {
            const when = formatWhen(item.createdAt);
            const family = actionFamily(item.action);
            const href = entityHref(item.entity, item.entityId);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setDetail(item)}
                  className="soft-row grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50/80 lg:grid-cols-[minmax(0,1.4fr)_0.7fr_0.9fr_1fr_0.9fr_40px] lg:items-center lg:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={actionTone(item.action)}
                        className="font-mono"
                      >
                        {item.action}
                      </Badge>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        {family}
                      </span>
                    </div>
                  </div>
                  <p className="truncate text-sm text-slate-700">
                    {item.entity ?? (
                      <span className="text-slate-400">—</span>
                    )}
                  </p>
                  <div className="flex min-w-0 items-center gap-1 font-mono text-xs text-slate-500">
                    {href ? (
                      <Link
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                        className="truncate text-teal-700 hover:underline"
                        title={item.entityId ?? undefined}
                      >
                        {shortId(item.entityId ?? item.id)}
                      </Link>
                    ) : (
                      <span
                        className="truncate"
                        title={item.entityId ?? item.id}
                      >
                        {shortId(item.entityId ?? item.id)}
                      </span>
                    )}
                    <CopyButton value={item.entityId ?? item.id} />
                  </div>
                  <div className="min-w-0">
                    {item.user ? (
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                          {item.user.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-900">
                            {item.user.name}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">
                            {item.user.email}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-400">
                        <UserRound size={14} /> Σύστημα
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm text-ink-900">
                      <Clock3 size={13} className="shrink-0 text-slate-400" />
                      {when.relative}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {when.absolute}
                    </p>
                  </div>
                  <span className="hidden justify-end text-slate-300 lg:flex">
                    <Eye size={15} />
                  </span>
                </button>
              </li>
            );
          })}

          {items.length === 0 ? (
            <li className="px-4 py-16 text-center">
              <Shield size={28} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-medium text-ink-900">
                Δεν βρέθηκαν γεγονότα
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Δοκίμασε διαφορετικά φίλτρα ή καθάρισε τα ενεργά.
              </p>
            </li>
          ) : null}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Ανά σελίδα</span>
            <select
              value={pageSize}
              disabled={isPending}
              onChange={(e) => {
                const next = Number(e.target.value) as (typeof PAGE_SIZES)[number];
                setPageSize(next);
                resetToFirst(filters, next);
              }}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-ink-900"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="hidden sm:inline">
              · Σελίδα {(pageIndex + 1).toLocaleString("el-GR")}
              {total > 0
                ? ` / ~${pageCount.toLocaleString("el-GR")}`
                : ""}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={pageIndex <= 0 || isPending}
              onClick={() => void goPrev()}
            >
              <ChevronLeft size={14} />
              Προηγούμενα
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!nextCursor || isPending}
              onClick={() => void goNext()}
            >
              Επόμενα
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      </section>

      {detail ? (
        <DetailDrawer item={detail} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone = "slate",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "slate" | "rose";
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "soft-panel flex items-start gap-3 px-4 py-3 text-left",
        onClick && "transition hover:border-teal-300 hover:bg-teal-50/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl",
          tone === "rose"
            ? "bg-rose-50 text-rose-700"
            : "bg-slate-100 text-slate-600",
        )}
      >
        {icon}
      </span>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink-950">
          {value.toLocaleString("el-GR")}
        </p>
      </div>
    </Comp>
  );
}

const FIELD_LABELS: Record<string, string> = {
  code: "Κωδικός",
  name: "Όνομα",
  sku: "SKU",
  barcode: "Barcode",
  vatNumber: "ΑΦΜ",
  email: "Email",
  phone: "Τηλέφωνο",
  notes: "Σημειώσεις",
  status: "Κατάσταση",
  unit: "Μονάδα",
  unitId: "Μονάδα (id)",
  vatRate: "ΦΠΑ %",
  price: "Τιμή",
  trackInventory: "Παρακολούθηση αποθέματος",
  customFields: "Προσαρμοσμένα πεδία",
  legalName: "Επωνυμία",
  tradeName: "Διακριτικός τίτλος",
  taxOffice: "ΔΟΥ",
  address: "Διεύθυνση",
  city: "Πόλη",
  postalCode: "Τ.Κ.",
  country: "Χώρα",
  website: "Ιστότοπος",
  logoUrl: "Logo URL",
  currency: "Νόμισμα",
  locale: "Γλώσσα",
  timezone: "Ζώνη ώρας",
  maintenanceMode: "Λειτουργία συντήρησης",
  number: "Αριθμός",
  dueAt: "Λήξη",
  branchId: "Υποκατάστημα",
  spaceId: "Χώρος",
  total: "Σύνολο",
  subtotal: "Καθαρή",
  vatAmount: "ΦΠΑ",
  lineCount: "Γραμμές",
  kind: "Τύπος",
  customerId: "Πελάτης",
  seriesId: "Σειρά",
  orderedAt: "Ημ. παραγγελίας",
  quantityInvoiced: "Τιμολογημένη ποσ.",
  invoiceId: "Τιμολόγιο",
  invoiceNumber: "Αρ. τιμολογίου",
  invoiceTotal: "Σύνολο τιμολογίου",
  convertedOrderId: "Παραγγελία",
  quote: "Προσφορά",
  order: "Παραγγελία",
};

function fieldLabel(path: string) {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  const root = path.split(".")[0] ?? path;
  if (FIELD_LABELS[root] && path.includes(".")) {
    return `${FIELD_LABELS[root]} · ${path.slice(root.length + 1)}`;
  }
  return path;
}

function formatMetaValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Ναι" : "Όχι";
  if (typeof value === "number") return value.toLocaleString("el-GR");
  if (typeof value === "string") {
    if (!value) return "(κενό)";
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString("el-GR");
    }
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function DetailDrawer({
  item,
  onClose,
}: {
  item: AuditItem;
  onClose: () => void;
}) {
  const when = formatWhen(item.createdAt);
  const parsed = parseAuditMeta(item.meta);
  const hasChangeView =
    parsed.changes.length > 0 || parsed.before != null || parsed.after != null;
  const [jsonTab, setJsonTab] = useState<"diff" | "before" | "after" | "raw">(
    hasChangeView ? "diff" : "raw",
  );
  const href = entityHref(item.entity, item.entityId);

  return (
    <Drawer
      open
      onClose={onClose}
      title={item.action}
      subtitle={when.absolute}
      widthClass="max-w-xl"
      headerExtra={<Badge tone={actionTone(item.action)}>λεπτομέρεια</Badge>}
    >
      <div className="space-y-5 text-sm">
        <Field label="Χρόνος">
          <p className="font-medium text-ink-950">{when.absolute}</p>
          <p className="text-xs text-slate-500">{when.relative}</p>
        </Field>

        <Field label="Οντότητα">
          {href ? (
            <Link
              href={href}
              className="font-medium text-teal-700 hover:underline"
              onClick={onClose}
            >
              {item.entity}
            </Link>
          ) : (
            <p className="font-medium text-ink-950">{item.entity ?? "—"}</p>
          )}
        </Field>

        <Field label="Entity ID">
          <div className="flex items-center gap-1">
            <code className="break-all rounded-lg bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700">
              {item.entityId ?? "—"}
            </code>
            {item.entityId ? <CopyButton value={item.entityId} /> : null}
          </div>
        </Field>

        <Field label="Event ID">
          <div className="flex items-center gap-1">
            <code className="break-all rounded-lg bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700">
              {item.id}
            </code>
            <CopyButton value={item.id} />
          </div>
        </Field>

        <Field label="Χρήστης">
          {item.user ? (
            <div>
              <p className="font-medium text-ink-950">{item.user.name}</p>
              <p className="text-xs text-slate-500">{item.user.email}</p>
            </div>
          ) : (
            <p className="text-slate-500">Σύστημα / άγνωστος</p>
          )}
        </Field>

        {hasChangeView ? (
          <Field
            label={`Αλλαγή${
              parsed.changes.length
                ? ` · ${parsed.changes.length} πεδί${parsed.changes.length === 1 ? "ο" : "α"}`
                : ""
            }`}
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(
                [
                  ["diff", "Διαφορές"],
                  ["before", "Πριν"],
                  ["after", "Μετά"],
                  ["raw", "Raw"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setJsonTab(key)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                    jsonTab === key
                      ? "bg-ink-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {jsonTab === "diff" ? (
              <ChangeDiffTable changes={parsed.changes} />
            ) : null}
            {jsonTab === "before" ? (
              <JsonBlock
                value={parsed.before}
                empty="Δεν υπάρχει αποθηκευμένη κατάσταση πριν"
                tone="rose"
              />
            ) : null}
            {jsonTab === "after" ? (
              <JsonBlock
                value={parsed.after}
                empty="Δεν υπάρχει αποθηκευμένη κατάσταση μετά"
                tone="emerald"
              />
            ) : null}
            {jsonTab === "raw" ? (
              <JsonBlock value={item.meta} empty="Χωρίς meta" />
            ) : null}
          </Field>
        ) : (
          <Field label="Meta">
            {item.meta == null ? (
              <p className="text-slate-400">
                Χωρίς πριν/μετά — παλαιότερη καταγραφή χωρίς snapshot.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-amber-700">
                  Η καταγραφή δεν περιλαμβάνει πλήρες πριν/μετά.
                </p>
                <JsonBlock value={item.meta} empty="Χωρίς meta" />
              </>
            )}
          </Field>
        )}

        {parsed.rest ? (
          <Field label="Επιπλέον">
            <JsonBlock value={parsed.rest} empty="—" />
          </Field>
        ) : null}
      </div>
    </Drawer>
  );
}

function ChangeDiffTable({ changes }: { changes: AuditChange[] }) {
  if (changes.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
        Δεν εντοπίστηκαν αλλαγές πεδίων (ίδια τιμή πριν και μετά).
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px bg-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <div className="bg-slate-50 px-2.5 py-2">Πεδίο</div>
        <div className="bg-rose-50 px-2.5 py-2 text-rose-700">Πριν</div>
        <div className="bg-emerald-50 px-2.5 py-2 text-emerald-800">Μετά</div>
      </div>
      <ul className="divide-y divide-slate-100">
        {changes.map((change) => (
          <li
            key={change.path}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-0 text-xs"
          >
            <div className="bg-white px-2.5 py-2.5">
              <p className="font-medium text-ink-900">
                {fieldLabel(change.path)}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                {change.path}
              </p>
            </div>
            <div className="bg-rose-50/40 px-2.5 py-2.5">
              <p className="break-words font-mono text-[11px] leading-relaxed text-rose-900">
                {formatMetaValue(change.before)}
              </p>
            </div>
            <div className="bg-emerald-50/40 px-2.5 py-2.5">
              <p className="break-words font-mono text-[11px] leading-relaxed text-emerald-950">
                {formatMetaValue(change.after)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function JsonBlock({
  value,
  empty,
  tone,
}: {
  value: unknown;
  empty: string;
  tone?: "rose" | "emerald";
}) {
  if (value == null) {
    return <p className="text-xs text-slate-400">{empty}</p>;
  }
  const ring =
    tone === "rose"
      ? "ring-1 ring-rose-200"
      : tone === "emerald"
        ? "ring-1 ring-emerald-200"
        : "";
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200",
        ring,
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      {children}
    </div>
  );
}
