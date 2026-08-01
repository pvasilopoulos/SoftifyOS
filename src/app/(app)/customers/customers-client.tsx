"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { List, Map as MapIcon, Plus, Settings2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import type { CustomFieldDef } from "@/modules/entity-views/dynamic-ui";
import {
  normalizeListConfig,
  type FormViewConfig,
  type ListViewConfig,
} from "@/modules/entity-views/types";
import type {
  ListDensity,
  ListFilter,
  ListSort,
} from "@/modules/entity-views/list-experience-types";
import { ListExperienceRenderer } from "@/modules/entity-views/list-experience-renderer";
import {
  ListExperienceToolbar,
  type StatusFilter,
} from "@/modules/entity-views/list-experience-toolbar";
import { applyListConfig } from "@/modules/entity-views/types";
import { CustomerQuickDrawer } from "./customer-quick-drawer";
import {
  CustomerPeekDrawer,
  type CustomerPeekData,
} from "./customer-peek-drawer";
import { CustomerMapView } from "./customer-map-view";

export type CustomerListItem = {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  branchCount: number;
  createdAt: string;
  customFields?: Record<string, unknown>;
};

type ListViewOpt = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  config: ListViewConfig;
};

type FormViewOpt = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  config: FormViewConfig;
};

type ListResponse = {
  items: CustomerListItem[];
  nextCursor: string | null;
  meta: { ms: number };
  error?: string;
};

export function CustomersClient({
  initialItems,
  initialNextCursor,
  initialMs,
  listViews,
  customFields,
  formViews = [],
}: {
  initialItems: CustomerListItem[];
  initialNextCursor: string | null;
  initialMs: number;
  listViews: ListViewOpt[];
  customFields: CustomFieldDef[];
  formViews?: FormViewOpt[];
}) {
  const router = useRouter();
  const defaultView =
    listViews.find((v) => v.isDefault) ?? listViews[0] ?? null;
  const [viewId, setViewId] = useState(defaultView?.id ?? "");
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [ms, setMs] = useState(initialMs);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>(() => {
    const cfg = normalizeListConfig(defaultView?.config);
    const locked = cfg.filters.find(
      (f) => f.source === "system" && f.key === "status" && f.op === "eq",
    );
    if (locked?.value === "ACTIVE" || locked?.value === "INACTIVE") {
      return locked.value;
    }
    return "ALL";
  });
  const [density, setDensity] = useState<ListDensity>(
    () => normalizeListConfig(defaultView?.config).page?.density ?? "comfortable",
  );
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [interactiveFilters, setInteractiveFilters] = useState<
    Record<string, string | null>
  >({});
  const [sortOverride, setSortOverride] = useState<ListSort | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [quickOpen, setQuickOpen] = useState(false);
  const [peekCustomer, setPeekCustomer] = useState<CustomerPeekData | null>(
    null,
  );
  const [surface, setSurface] = useState<"list" | "map">(() =>
    normalizeListConfig(defaultView?.config).mode === "map" ? "map" : "list",
  );

  const activeView = listViews.find((v) => v.id === viewId) ?? defaultView;
  const builtins = ENTITY_REGISTRY.CUSTOMERS.builtins;
  const showMap = surface === "map";

  const baseConfig = useMemo(
    () => normalizeListConfig(activeView?.config),
    [activeView],
  );

  const effectiveConfig = useMemo(() => {
    const filters: ListFilter[] = [];

    // Status: runtime chip wins over view lock when user picks ALL/ACTIVE/INACTIVE
    if (status === "ACTIVE" || status === "INACTIVE") {
      filters.push({
        key: "status",
        source: "system",
        op: "eq",
        value: status,
        interactive: true,
      });
    }

    // Keep non-status view filters
    for (const f of baseConfig.filters ?? []) {
      if (f.key === "status" && f.source === "system") continue;
      filters.push(f);
    }

    // Interactive emptiness filters
    for (const [compound, val] of Object.entries(interactiveFilters)) {
      if (!val) continue;
      const [source, key] = compound.split(":");
      if (!key || (source !== "system" && source !== "custom")) continue;
      filters.push({
        key,
        source,
        op: val === "empty" ? "empty" : "not_empty",
        value: null,
        interactive: true,
      });
    }

    const columns = (baseConfig.columns ?? []).map((col) => {
      const id = `${col.source}:${col.key}`;
      if (hiddenKeys.has(id)) return { ...col, hidden: true };
      return col;
    });

    return {
      ...baseConfig,
      filters,
      columns,
      page: {
        ...baseConfig.page,
        density,
      },
      sort: sortOverride ?? baseConfig.sort,
    } satisfies ListViewConfig;
  }, [
    baseConfig,
    status,
    interactiveFilters,
    hiddenKeys,
    density,
    sortOverride,
  ]);

  function apiStatusParam(nextStatus = status, nextViewId = viewId) {
    if (nextStatus === "ACTIVE" || nextStatus === "INACTIVE") return nextStatus;
    const view = listViews.find((v) => v.id === nextViewId);
    const cfg = normalizeListConfig(view?.config);
    const locked = cfg.filters.find(
      (f) => f.source === "system" && f.key === "status" && f.op === "eq",
    );
    if (locked?.value === "ACTIVE" || locked?.value === "INACTIVE") {
      return String(locked.value);
    }
    return null;
  }

  async function search(opts?: {
    nextViewId?: string;
    nextStatus?: StatusFilter;
    nextQ?: string;
  }) {
    setError(null);
    const nextViewId = opts?.nextViewId ?? viewId;
    const nextStatus = opts?.nextStatus ?? status;
    const nextQ = opts?.nextQ ?? q;
    const view = listViews.find((v) => v.id === nextViewId);
    const cfg = normalizeListConfig(view?.config);
    const params = new URLSearchParams({
      limit: String(cfg.pageSize ?? 50),
    });
    if (nextQ.trim()) params.set("q", nextQ.trim());
    const st = apiStatusParam(nextStatus, nextViewId);
    if (st) params.set("status", st);

    const res = await fetch(`/api/customers?${params}`, { cache: "no-store" });
    const data = (await res.json()) as ListResponse;
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => {
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setMs(data.meta.ms);
    });
  }

  async function loadMore() {
    if (!nextCursor) return;
    const params = new URLSearchParams({
      limit: String(effectiveConfig.pageSize ?? 50),
      cursor: nextCursor,
    });
    if (q.trim()) params.set("q", q.trim());
    const st = apiStatusParam();
    if (st) params.set("status", st);
    const res = await fetch(`/api/customers?${params}`, { cache: "no-store" });
    const data = (await res.json()) as ListResponse;
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => {
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
      setMs(data.meta.ms);
    });
  }

  function openPeek(row: Record<string, unknown> & { id: string }) {
    const found = items.find((c) => c.id === row.id);
    if (!found) return;
    setPeekCustomer({
      id: found.id,
      code: found.code,
      name: found.name,
      vatNumber: found.vatNumber,
      email: found.email,
      phone: found.phone,
      status: found.status,
      customFields: found.customFields,
    });
  }

  async function moveKanban(
    row: Record<string, unknown> & { id: string },
    nextValue: string,
  ) {
    const res = await fetch(`/api/customers/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextValue }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Αποτυχία μετακίνησης");
      return;
    }
    setItems((prev) =>
      prev.map((c) => (c.id === row.id ? { ...c, status: nextValue } : c)),
    );
  }

  async function bulkStatus(ids: string[], nextStatus: string) {
    setError(null);
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/customers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        }),
      ),
    );
    const failed = results.find((r) => !r.ok);
    if (failed) {
      const data = await failed.json().catch(() => ({}));
      setError(
        (data as { error?: string }).error || "Αποτυχία μαζικής ενημέρωσης",
      );
      return;
    }
    setItems((prev) =>
      prev.map((c) =>
        ids.includes(c.id) ? { ...c, status: nextStatus } : c,
      ),
    );
  }

  function clearFilters() {
    setQ("");
    setStatus("ALL");
    setInteractiveFilters({});
    void search({ nextStatus: "ALL", nextQ: "" });
  }

  const rows = items as unknown as Array<
    Record<string, unknown> & { id: string }
  >;
  const visibleCount = applyListConfig(rows, effectiveConfig).length;

  return (
    <div className="space-y-3">
      <ListExperienceToolbar
        q={q}
        onQChange={setQ}
        onSearch={() => void search()}
        showSearch={effectiveConfig.page?.showSearch !== false}
        searchPlaceholder="Αναζήτηση ονόματος, κωδικού ή ΑΦΜ…"
        views={listViews}
        viewId={viewId}
        onViewChange={(id) => {
          setViewId(id);
          setSortOverride(null);
          const cfg = normalizeListConfig(
            listViews.find((v) => v.id === id)?.config,
          );
          setDensity(cfg.page?.density ?? "comfortable");
          setSurface(cfg.mode === "map" ? "map" : "list");
          const locked = cfg.filters.find(
            (f) => f.source === "system" && f.key === "status" && f.op === "eq",
          );
          const nextStatus: StatusFilter =
            locked?.value === "ACTIVE" || locked?.value === "INACTIVE"
              ? locked.value
              : status;
          if (locked?.value === "ACTIVE" || locked?.value === "INACTIVE") {
            setStatus(locked.value);
          }
          if (cfg.mode !== "map") {
            void search({ nextViewId: id, nextStatus });
          }
        }}
        status={status}
        onStatusChange={(s) => {
          setStatus(s);
          void search({ nextStatus: s });
        }}
        density={density}
        onDensityChange={setDensity}
        config={effectiveConfig}
        builtins={builtins}
        customDefs={customFields}
        hiddenKeys={hiddenKeys}
        onHiddenKeysChange={setHiddenKeys}
        interactiveFilters={interactiveFilters}
        onInteractiveFilterChange={(key, value) => {
          setInteractiveFilters((prev) => {
            const next = { ...prev };
            if (value == null) delete next[key];
            else next[key] = value;
            return next;
          });
        }}
        onClearFilters={clearFilters}
        resultCount={visibleCount}
        totalLoaded={items.length}
        ms={ms}
        pending={isPending}
        extraActions={
          <>
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setSurface("list")}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-medium",
                  !showMap
                    ? "bg-teal-800 text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <List size={13} /> Πίνακας
              </button>
              <button
                type="button"
                onClick={() => setSurface("map")}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-medium",
                  showMap
                    ? "bg-teal-800 text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <MapIcon size={13} /> Χάρτης
              </button>
            </div>
            {formViews.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setQuickOpen(true)}
              >
                <Plus size={14} /> Γρήγορα
              </Button>
            ) : null}
            <Link
              href="/settings/entity-views"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
              title="Σχεδίαση προβολών"
            >
              <Settings2 size={14} />
            </Link>
          </>
        }
      />

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {showMap ? (
        <CustomerMapView q={q} status={status} />
      ) : (
        <>
          <ListExperienceRenderer
            config={effectiveConfig}
            builtins={builtins}
            customDefs={customFields}
            rows={rows}
            hrefForRow={(row) => `/customers/${row.id}`}
            onPeek={openPeek}
            onEdit={openPeek}
            onQuickCreate={() => setQuickOpen(true)}
            onNavigateNew={() => router.push("/customers/new")}
            onKanbanMove={(row, next) => void moveKanban(row, next)}
            onBulkStatus={(ids, st) => bulkStatus(ids, st)}
            onSortChange={(sort) => setSortOverride(sort)}
            emptyActionLabel="Νέος πελάτης"
          />

          {nextCursor ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={isPending}
                onClick={() => void loadMore()}
              >
                Περισσότερα · {items.length} φορτωμένα
              </Button>
            </div>
          ) : items.length > 0 ? (
            <p className="text-center text-xs text-slate-400">
              Τέλος αποτελεσμάτων · {items.length} εγγραφές
            </p>
          ) : null}
        </>
      )}

      <CustomerQuickDrawer
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        formViews={formViews}
        customFields={customFields}
      />
      <CustomerPeekDrawer
        open={Boolean(peekCustomer)}
        customer={peekCustomer}
        formViews={formViews}
        customFields={customFields}
        preferredFormCode={
          effectiveConfig.page?.editFormCode ??
          effectiveConfig.page?.peekFormCode
        }
        onClose={() => setPeekCustomer(null)}
        onSaved={(patch) => {
          setItems((prev) =>
            prev.map((c) =>
              c.id === patch.id
                ? {
                    ...c,
                    code: patch.code,
                    name: patch.name,
                    vatNumber: patch.vatNumber,
                    email: patch.email,
                    phone: patch.phone,
                    status: patch.status,
                    customFields: parseCustomFieldsSafe(patch.customFields),
                  }
                : c,
            ),
          );
        }}
      />
    </div>
  );
}

function parseCustomFieldsSafe(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}
