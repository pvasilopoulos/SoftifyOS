"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import type { CustomFieldDef } from "@/modules/entity-views/dynamic-ui";
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import {
  normalizeListConfig,
  type FormViewConfig,
  type ListViewConfig,
} from "@/modules/entity-views/types";
import { ListExperienceRenderer } from "@/modules/entity-views/list-experience-renderer";
import { CustomerQuickDrawer } from "./customer-quick-drawer";

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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [quickOpen, setQuickOpen] = useState(false);

  const activeView = listViews.find((v) => v.id === viewId) ?? defaultView;
  const config = useMemo(
    () => normalizeListConfig(activeView?.config),
    [activeView],
  );
  const builtins = ENTITY_REGISTRY.CUSTOMERS.builtins;

  async function search(nextViewId = viewId) {
    setError(null);
    const view = listViews.find((v) => v.id === nextViewId);
    const cfg = normalizeListConfig(view?.config);
    const statusFilter = cfg.filters.find(
      (f) => f.source === "system" && f.key === "status" && f.op === "eq",
    );
    const params = new URLSearchParams({
      limit: String(cfg.pageSize ?? 50),
    });
    if (q.trim()) params.set("q", q.trim());
    if (statusFilter?.value) params.set("status", String(statusFilter.value));
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
      limit: String(config.pageSize ?? 50),
      cursor: nextCursor,
    });
    if (q.trim()) params.set("q", q.trim());
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

  const rows = items as unknown as Array<
    Record<string, unknown> & { id: string }
  >;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {config.page?.showSearch !== false ? (
          <label className="soft-surface flex flex-1 items-center gap-2 px-3 py-2.5">
            <Search size={16} className="text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
              placeholder="Αναζήτηση ονόματος, κωδικού ή ΑΦΜ..."
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
        ) : (
          <div className="flex-1" />
        )}
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
        {formViews.length > 0 ? (
          <Button variant="secondary" onClick={() => setQuickOpen(true)}>
            <Plus size={14} /> Γρήγορα
          </Button>
        ) : null}
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
        rows={rows}
        hrefForRow={(row) => `/customers/${row.id}`}
        onPeek={() => setQuickOpen(true)}
        onQuickCreate={() => setQuickOpen(true)}
        onNavigateNew={() => router.push("/customers/new")}
        emptyActionLabel="Νέος πελάτης"
      />

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() => void loadMore()}
          >
            Περισσότερα
          </Button>
        </div>
      ) : null}

      <CustomerQuickDrawer
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        formViews={formViews}
        customFields={customFields}
      />
    </div>
  );
}
