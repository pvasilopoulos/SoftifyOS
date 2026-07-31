"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import type { CustomFieldDef } from "@/modules/entity-views/dynamic-ui";
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import {
  normalizeListConfig,
  type ListViewConfig,
} from "@/modules/entity-views/types";
import { ListExperienceRenderer } from "@/modules/entity-views/list-experience-renderer";

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
  const router = useRouter();
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
  const config = useMemo(() => {
    const normalized = normalizeListConfig(activeView?.config);
    if (!normalized.page?.emptyTitle) {
      return {
        ...normalized,
        page: { ...normalized.page, emptyTitle: emptyLabel },
      };
    }
    return normalized;
  }, [activeView, emptyLabel]);
  const builtins = ENTITY_REGISTRY[entity].builtins;

  async function search() {
    setError(null);
    const params = new URLSearchParams({
      limit: String(config.pageSize ?? 50),
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
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setMs(data.meta.ms);
    });
  }

  async function loadMore() {
    if (!nextCursor) return;
    const params = new URLSearchParams({
      limit: String(config.pageSize ?? 50),
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
        {listViews.length > 0 ? (
          <ViewSwitcher
            views={listViews}
            value={viewId}
            onChange={(id) => {
              setViewId(id);
              void search();
            }}
          />
        ) : null}
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

      <ListExperienceRenderer
        config={config}
        builtins={builtins}
        customDefs={customFields}
        rows={items as unknown as Array<Record<string, unknown> & { id: string }>}
        hrefForRow={(row) => `${detailBasePath}/${row.id}`}
        onNavigateNew={() => router.push(`${detailBasePath}/new`)}
        emptyActionLabel="Νέα εγγραφή"
      />

      {nextCursor ? (
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          disabled={isPending}
          onClick={() => void loadMore()}
        >
          Περισσότερα
        </Button>
      ) : null}
    </div>
  );
}
