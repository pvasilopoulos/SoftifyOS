"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { productStatusLabel } from "@/modules/master-data/schemas";

export type ProductListItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  vatRate: number;
  price: number;
  status: string;
  createdAt: string;
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
}: {
  initialItems: ProductListItem[];
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
    const params = new URLSearchParams({ limit: "50", cursor: nextCursor });
    if (q.trim()) params.set("q", q.trim());
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
            placeholder="Αναζήτηση ονόματος ή SKU..."
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
        <div className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[0.8fr_1.4fr_0.5fr_0.7fr_0.5fr_0.6fr] md:gap-3">
          <span>SKU</span>
          <span>Όνομα</span>
          <span>Μονάδα</span>
          <span>Τιμή</span>
          <span>ΦΠΑ</span>
          <span>Κατάσταση</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {items.map((p) => (
            <li key={p.id} className="soft-row">
              <Link
                href={`/products/${p.id}`}
                className="grid gap-1 px-4 py-3 md:grid-cols-[0.8fr_1.4fr_0.5fr_0.7fr_0.5fr_0.6fr] md:items-center md:gap-3"
              >
                <span className="font-mono text-sm text-slate-600">{p.sku}</span>
                <span className="font-medium text-ink-900">{p.name}</span>
                <span className="text-sm text-slate-500">{p.unit}</span>
                <span className="text-sm tabular-nums">{formatEUR(p.price)}</span>
                <span className="text-sm tabular-nums text-slate-500">
                  {p.vatRate}%
                </span>
                <span>
                  <Badge tone={p.status === "ACTIVE" ? "emerald" : "slate"}>
                    {productStatusLabel[
                      p.status as keyof typeof productStatusLabel
                    ] ?? p.status}
                  </Badge>
                </span>
              </Link>
            </li>
          ))}
          {items.length === 0 ? (
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
