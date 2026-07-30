"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
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
}: {
  initialItems: OrderListItem[];
  initialNextCursor: string | null;
  initialMs: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [ms, setMs] = useState(initialMs);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function search() {
    setError(null);
    const params = new URLSearchParams({ limit: "50" });
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
    const params = new URLSearchParams({ limit: "50", cursor: nextCursor });
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
      <div className="flex flex-col gap-2 sm:flex-row">
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
        <div className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[0.9fr_1.3fr_0.7fr_0.6fr_0.7fr_auto] md:gap-3">
          <span>Αριθμός</span>
          <span>Πελάτης</span>
          <span className="text-right">Ποσό</span>
          <span>Γραμμές</span>
          <span>Κατάσταση</span>
          <span />
        </div>
        <ul className="divide-y divide-slate-100">
          {items.map((o) => {
            const status = o.status as OrderStatusKey;
            return (
              <li key={o.id} className="soft-row">
                <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 md:grid-cols-[0.9fr_1.3fr_0.7fr_0.6fr_0.7fr_auto] md:items-center">
                  <Link href={`/orders/${o.id}`} className="min-w-0">
                    <p className="text-sm font-semibold text-ink-950">
                      {o.number}
                    </p>
                    <p className="text-xs text-slate-500 md:hidden">
                      {o.customerName}
                    </p>
                  </Link>
                  <Link
                    href={`/orders/${o.id}`}
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
                    href={`/orders/${o.id}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 md:hidden"
                    aria-label={`Άνοιγμα ${o.number}`}
                  >
                    <Pencil size={15} />
                  </Link>
                </div>
              </li>
            );
          })}
          {items.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              Δεν βρέθηκαν παραγγελίες
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
