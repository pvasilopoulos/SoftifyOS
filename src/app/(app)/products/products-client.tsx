"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import {
  DynamicListCells,
  DynamicListHeader,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import {
  matchesFilters,
  type ListViewConfig,
} from "@/modules/entity-views/types";

export type ProductListItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  vatRate: number;
  price: number;
  status: string;
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

type ListResponse = {
  items: ProductListItem[];
  nextCursor: string | null;
  meta: { ms: number };
  error?: string;
};

export function ProductsClient({
  initialItems,
  initialNextCursor,
  initialMs,
  listViews,
  customFields,
}: {
  initialItems: ProductListItem[];
  initialNextCursor: string | null;
  initialMs: number;
  listViews: ListViewOpt[];
  customFields: CustomFieldDef[];
}) {
  const defaultView =
    listViews.find((v) => v.isDefault) ?? listViews[0] ?? null;
  const [viewId, setViewId] = useState(defaultView?.id ?? "");
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [ms, setMs] = useState(initialMs);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeView = listViews.find((v) => v.id === viewId) ?? defaultView;
  const config = activeView?.config;
  const builtins = ENTITY_REGISTRY.PRODUCTS.builtins;

  const visibleItems = useMemo(() => {
    if (!config?.filters?.length) return items;
    return items.filter((row) =>
      matchesFilters(row as unknown as Record<string, unknown>, config.filters),
    );
  }, [items, config]);

  async function search(nextViewId = viewId) {
    setError(null);
    const view = listViews.find((v) => v.id === nextViewId);
    const statusFilter = view?.config.filters.find(
      (f) => f.source === "system" && f.key === "status" && f.op === "eq",
    );
    const params = new URLSearchParams({ limit: "50" });
    if (q.trim()) params.set("q", q.trim());
    if (statusFilter?.value) params.set("status", String(statusFilter.value));
    const res = await fetch(`/api/products?${params}`, { cache: "no-store" });
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
    const view = listViews.find((v) => v.id === viewId);
    const statusFilter = view?.config.filters.find(
      (f) => f.source === "system" && f.key === "status" && f.op === "eq",
    );
    const params = new URLSearchParams({ limit: "50", cursor: nextCursor });
    if (q.trim()) params.set("q", q.trim());
    if (statusFilter?.value) params.set("status", String(statusFilter.value));
    const res = await fetch(`/api/products?${params}`, { cache: "no-store" });
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

  const columns = config?.columns?.length
    ? config.columns
    : [
        { key: "sku", source: "system" as const },
        { key: "name", source: "system" as const },
        { key: "price", source: "system" as const },
        { key: "status", source: "system" as const },
      ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="soft-surface flex flex-1 items-center gap-2 px-3 py-2.5">
          <Search size={16} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            placeholder="Αναζήτηση ονόματος ή SKU..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <ViewSwitcher
          views={listViews}
          value={viewId}
          onChange={(id) => {
            setViewId(id);
            void search(id);
          }}
        />
        <Button
          variant="secondary"
          onClick={() => void search()}
          disabled={isPending}
        >
          Αναζήτηση
        </Button>
        <Badge tone={ms < 200 ? "emerald" : "amber"}>{ms} ms</Badge>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <section className="soft-panel overflow-hidden">
        <DynamicListHeader
          columns={columns}
          builtins={builtins}
          customDefs={customFields}
        />
        <ul className="divide-y divide-slate-100">
          {visibleItems.map((p) => (
            <li key={p.id} className="soft-row">
              <Link
                href={`/products/${p.id}`}
                className="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-50/80"
              >
                <DynamicListCells
                  columns={columns}
                  builtins={builtins}
                  customDefs={customFields}
                  row={p as unknown as Record<string, unknown>}
                />
              </Link>
            </li>
          ))}
          {visibleItems.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              Δεν βρέθηκαν προϊόντα
            </li>
          ) : null}
        </ul>
      </section>

      {nextCursor ? (
        <Button
          variant="secondary"
          className={cn("w-full sm:w-auto")}
          disabled={isPending}
          onClick={() => void loadMore()}
        >
          Περισσότερα
        </Button>
      ) : null}
    </div>
  );
}
