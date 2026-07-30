"use client";

import { useState, useTransition } from "react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type AuditItem = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  createdAt: string;
  userId: string | null;
};

type ListResponse = {
  items: AuditItem[];
  nextCursor: string | null;
  meta: { ms: number };
  error?: string;
};

export function AuditEventsClient({
  initialItems,
  initialNextCursor,
  initialMs,
}: {
  initialItems: AuditItem[];
  initialNextCursor: string | null;
  initialMs: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [ms, setMs] = useState(initialMs);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    setError(null);
    const res = await fetch("/api/audit-events?limit=50", { cache: "no-store" });
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
    setError(null);
    const params = new URLSearchParams({ limit: "50", cursor: nextCursor });
    const res = await fetch(`/api/audit-events?${params}`, { cache: "no-store" });
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
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Scale-proof cursor list · 1M+ ready pattern"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={ms < 200 ? "emerald" : "amber"}>{ms} ms</Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
              disabled={isPending}
            >
              Ανανέωση
            </Button>
          </div>
        }
      />

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <section className="soft-panel overflow-hidden">
        <div className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[1.2fr_0.9fr_1fr_0.9fr] md:gap-3">
          <span>Ενέργεια</span>
          <span>Οντότητα</span>
          <span>ID</span>
          <span>Χρόνος</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li
              key={item.id}
              className="soft-row px-4 py-3 md:grid md:grid-cols-[1.2fr_0.9fr_1fr_0.9fr] md:gap-3"
            >
              <p className="text-sm font-medium text-ink-900">{item.action}</p>
              <p className="text-sm text-slate-600">{item.entity ?? "—"}</p>
              <p className="truncate font-mono text-xs text-slate-500">
                {item.entityId ?? item.id}
              </p>
              <p className="text-xs text-slate-500 md:text-sm">
                {new Date(item.createdAt).toLocaleString("el-GR")}
              </p>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-slate-500">
              Δεν υπάρχουν events. Τρέξε `npm run db:seed:scale`.
            </li>
          ) : null}
        </ul>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">{items.length} φορτωμένα</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={!nextCursor || isPending}
            className={cn(!nextCursor && "opacity-50")}
            onClick={() => void loadMore()}
          >
            Επόμενα 50
          </Button>
        </div>
      </section>
    </div>
  );
}
