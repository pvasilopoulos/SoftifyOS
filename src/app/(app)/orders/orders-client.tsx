"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Pencil, Search } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import {
  orderStatusLabel,
  orderStatusTone,
  type OrderStatusKey,
} from "@/modules/sales/order-utils";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import {
  DynamicListCells,
  DynamicListHeader,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import {
  matchesFilters,
  sortRows,
  type ListViewConfig,
} from "@/modules/entity-views/types";

export type OrderListItem = {
  id: string;
  number: string;
  status: string;
  orderedAt: string;
  total: number;
  createdAt: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  branchName: string | null;
  lineCount: number;
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
  items: OrderListItem[];
  nextCursor: string | null;
  meta: { ms: number };
  error?: string;
};

export function OrdersClient({
  initialItems,
  initialNextCursor,
  initialMs,
  kind = "SALES_ORDER",
  detailBasePath = "/orders",
  emptyLabel = "Δεν βρέθηκαν παραγγελίες",
  entity = "ORDERS",
  listViews = [],
  customFields = [],
}: {
  initialItems: OrderListItem[];
  initialNextCursor: string | null;
  initialMs: number;
  kind?: "SALES_ORDER" | "SALES_QUOTE";
  detailBasePath?: string;
  emptyLabel?: string;
  entity?: "ORDERS" | "QUOTES";
  listViews?: ListViewOpt[];
  customFields?: CustomFieldDef[];
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
  const useDynamic = Boolean(config?.columns?.length);
  const builtins = ENTITY_REGISTRY[entity].builtins;

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
    ) as unknown as OrderListItem[];
  }, [items, config]);

  async function search() {
    setError(null);
    const params = new URLSearchParams({ limit: "50", kind });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/orders?${params}`, { cache: "no-store" });
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
      limit: "50",
      cursor: nextCursor,
      kind,
    });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/orders?${params}`, { cache: "no-store" });
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
            placeholder="Αναζήτηση αριθμού ή πελάτη..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <ViewSwitcher
          views={listViews}
          value={viewId}
          onChange={setViewId}
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
        {useDynamic && config ? (
          <DynamicListHeader
            columns={config.columns}
            builtins={builtins}
            customDefs={customFields}
          />
        ) : (
          <div className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[0.9fr_1.3fr_0.7fr_0.6fr_0.7fr_auto] md:gap-3">
            <span>Αριθμός</span>
            <span>Πελάτης</span>
            <span className="text-right">Ποσό</span>
            <span>Γραμμές</span>
            <span>Κατάσταση</span>
            <span />
          </div>
        )}
        <ul className="divide-y divide-slate-100">
          {visibleItems.map((o) => {
            const status = o.status as OrderStatusKey;
            if (useDynamic && config) {
              return (
                <li key={o.id} className="soft-row">
                  <Link
                    href={`${detailBasePath}/${o.id}`}
                    className="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-50/80"
                  >
                    <DynamicListCells
                      columns={config.columns}
                      builtins={builtins}
                      customDefs={customFields}
                      row={o as unknown as Record<string, unknown>}
                    />
                  </Link>
                </li>
              );
            }
            return (
              <li key={o.id} className="soft-row">
                <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 md:grid-cols-[0.9fr_1.3fr_0.7fr_0.6fr_0.7fr_auto] md:items-center">
                  <Link href={`${detailBasePath}/${o.id}`} className="min-w-0">
                    <p className="text-sm font-semibold text-ink-950">
                      {o.number}
                    </p>
                    <p className="text-xs text-slate-500 md:hidden">
                      {o.customerName}
                    </p>
                  </Link>
                  <Link
                    href={`${detailBasePath}/${o.id}`}
                    className="hidden min-w-0 md:block"
                  >
                    <p className="truncate text-sm font-medium text-ink-900">
                      {o.customerName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {o.branchName || o.customerCode}
                    </p>
                  </Link>
                  <p className="text-sm font-medium md:text-right">
                    {formatEUR(o.total)}
                  </p>
                  <p className="hidden text-sm text-slate-500 md:block">
                    {o.lineCount}
                  </p>
                  <div>
                    <Badge tone={orderStatusTone[status] ?? "slate"}>
                      {orderStatusLabel[status] ?? o.status}
                    </Badge>
                  </div>
                  <Link
                    href={`${detailBasePath}/${o.id}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 md:hidden"
                    aria-label={`Άνοιγμα ${o.number}`}
                  >
                    <Pencil size={15} />
                  </Link>
                </div>
              </li>
            );
          })}
          {visibleItems.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              {emptyLabel}
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
