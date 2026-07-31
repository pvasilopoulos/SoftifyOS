"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Download,
  Eye,
  Filter,
  RefreshCw,
  Search,
  Shield,
  X,
  Copy,
  Check,
  UserRound,
  Clock3,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

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

type ListResponse = {
  items: AuditItem[];
  nextCursor: string | null;
  meta: {
    ms: number;
    total: number;
    hasMore?: boolean;
  };
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

const ACTION_PRESETS = [
  { value: "", label: "Όλες οι ενέργειες" },
  { value: "auth.", label: "Auth" },
  { value: "settings.", label: "Ρυθμίσεις" },
  { value: "customer.", label: "Πελάτες" },
  { value: "product.", label: "Προϊόντα" },
  { value: "invoice.", label: "Τιμολόγια" },
  { value: "order.", label: "Παραγγελίες" },
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
] as const;

function actionTone(
  action: string,
): "teal" | "amber" | "slate" | "rose" | "emerald" {
  if (action.includes("delete") || action.includes("fail")) return "rose";
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

function toLocalInputValue(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildQuery(filters: Filters, cursor?: string | null) {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
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
      onClick={async () => {
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
}: {
  initialItems: AuditItem[];
  initialNextCursor: string | null;
  initialMs: number;
  initialTotal: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [ms, setMs] = useState(initialMs);
  const [total, setTotal] = useState(initialTotal);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [detail, setDetail] = useState<AuditItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.q) n += 1;
    if (filters.action) n += 1;
    if (filters.entity) n += 1;
    if (filters.from) n += 1;
    if (filters.to) n += 1;
    return n;
  }, [filters]);

  async function fetchPage(opts: {
    filters: Filters;
    cursor?: string | null;
    append?: boolean;
  }) {
    setError(null);
    const params = buildQuery(opts.filters, opts.cursor);
    const res = await fetch(`/api/audit-events?${params}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as ListResponse;
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => {
      setItems((prev) =>
        opts.append ? [...prev, ...data.items] : data.items,
      );
      setNextCursor(data.nextCursor);
      setMs(data.meta.ms);
      setTotal(data.meta.total);
    });
  }

  function applyFilters() {
    setFilters(draft);
    void fetchPage({ filters: draft });
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    void fetchPage({ filters: EMPTY_FILTERS });
  }

  function refresh() {
    void fetchPage({ filters });
  }

  function loadMore() {
    if (!nextCursor) return;
    void fetchPage({ filters, cursor: nextCursor, append: true });
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Καταγραφή ενεργειών"
        description="Πλήρες audit trail · φίλτρα, λεπτομέρειες και εξαγωγή"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ms < 200 ? "emerald" : "amber"}>{ms} ms</Badge>
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

      {filtersOpen ? (
        <section className="soft-panel space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <Filter size={15} className="text-slate-400" />
            Φίλτρα αναζήτησης
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
            {activeFilterCount > 0 ? (
              <p className="text-xs text-slate-500">
                Ενεργά φίλτρα: {activeFilterCount}
                {filters.from
                  ? ` · από ${toLocalInputValue(fromLocalInputValue(filters.from)) || filters.from}`
                  : ""}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <section className="soft-panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield size={15} className="text-slate-400" />
            <p className="text-sm font-semibold text-ink-900">Γεγονότα</p>
          </div>
          <p className="text-xs text-slate-400">
            {items.length.toLocaleString("el-GR")} από{" "}
            {total.toLocaleString("el-GR")}
            <span className="mx-2 hidden text-slate-300 sm:inline">·</span>
            <span className="hidden sm:inline">
              κλικ για λεπτομέρειες
            </span>
          </p>
        </div>

        <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400 lg:grid lg:grid-cols-[minmax(0,1.4fr)_0.7fr_0.9fr_1fr_0.9fr_40px] lg:gap-3">
          <span>Ενέργεια</span>
          <span>Οντότητα</span>
          <span>Αναφορά</span>
          <span>Χρήστης</span>
          <span>Χρόνος</span>
          <span />
        </div>

        <ul className="divide-y divide-slate-100">
          {items.map((item) => {
            const when = formatWhen(item.createdAt);
            const family = actionFamily(item.action);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setDetail(item)}
                  className="soft-row grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50/80 lg:grid-cols-[minmax(0,1.4fr)_0.7fr_0.9fr_1fr_0.9fr_40px] lg:items-center lg:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={actionTone(item.action)} className="font-mono">
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
                    <span className="truncate" title={item.entityId ?? item.id}>
                      {shortId(item.entityId ?? item.id)}
                    </span>
                    <span
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    >
                      <CopyButton value={item.entityId ?? item.id} />
                    </span>
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
                Δοκίμασε διαφορετικά φίλτρα ή σύνδεση / αλλαγή ρυθμίσεων για
                νέα καταγραφή.
              </p>
            </li>
          ) : null}
        </ul>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={!nextCursor || isPending}
            className={cn(!nextCursor && "opacity-50")}
            onClick={loadMore}
          >
            Επόμενα 50
          </Button>
        </div>
      </section>

      {detail ? (
        <DetailDrawer item={detail} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}

function DetailDrawer({
  item,
  onClose,
}: {
  item: AuditItem;
  onClose: () => void;
}) {
  const when = formatWhen(item.createdAt);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/30 backdrop-blur-[2px]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl animate-fade-in">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Λεπτομέρεια γεγονότος
            </p>
            <div className="mt-2">
              <Badge tone={actionTone(item.action)} className="font-mono">
                {item.action}
              </Badge>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <Field label="Χρόνος">
            <p className="font-medium text-ink-950">{when.absolute}</p>
            <p className="text-xs text-slate-500">{when.relative}</p>
          </Field>

          <Field label="Οντότητα">
            <p className="font-medium text-ink-950">{item.entity ?? "—"}</p>
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

          <Field label="Meta">
            {item.meta == null ? (
              <p className="text-slate-400">Χωρίς επιπλέον δεδομένα</p>
            ) : (
              <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                {JSON.stringify(item.meta, null, 2)}
              </pre>
            )}
          </Field>
        </div>
      </aside>
    </div>
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
