"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Filter, Search } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { productStatusLabel } from "@/modules/master-data/schemas";

export type ProductListItem = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  barcode: string | null;
  unit: string;
  vatRate: number;
  price: number;
  cost: number;
  stockOnHand: number;
  minStock: number;
  reorderQty: number;
  location: string | null;
  tags: string[];
  isTracked: boolean;
  status: string;
  createdAt: string;
};

type ListResponse = {
  items: ProductListItem[];
  nextCursor: string | null;
  meta: { ms: number };
  error?: string;
};

type ProductDetail = ProductListItem & {
  notes: string | null;
  updatedAt: string;
};

type DetailResponse = { item?: ProductDetail; error?: string };

const tabs = [
  { id: "ALL", label: "Όλα" },
  { id: "ACTIVE", label: "Ενεργά" },
  { id: "INACTIVE", label: "Ανενεργά" },
  { id: "LOW_STOCK", label: "Χαμηλό stock" },
] as const;

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
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("ALL");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [preview, setPreview] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categories = useMemo(
    () =>
      Array.from(
        new Set(items.map((x) => x.category).filter((x): x is string => Boolean(x))),
      ),
    [items],
  );
  const brands = useMemo(
    () =>
      Array.from(
        new Set(items.map((x) => x.brand).filter((x): x is string => Boolean(x))),
      ),
    [items],
  );

  useEffect(() => {
    if (!previewId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/products/${previewId}`, { cache: "no-store" });
      const data = (await res.json()) as DetailResponse;
      if (cancelled) return;
      if (!res.ok || !data.item) {
        setError(data.error || "Αποτυχία προεπισκόπησης");
        return;
      }
      setPreview(data.item);
    })();
    return () => {
      cancelled = true;
    };
  }, [previewId]);

  function buildParams(cursor?: string | null) {
    const params = new URLSearchParams({ limit: "50" });
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    if (tab === "ACTIVE" || tab === "INACTIVE") params.set("status", tab);
    if (tab === "LOW_STOCK") params.set("lowStock", "true");
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function search(append = false, cursor?: string | null) {
    setError(null);
    const params = buildParams(cursor);
    const res = await fetch(`/api/products?${params}`, { cache: "no-store" });
    const data = (await res.json()) as ListResponse;
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => {
      const nextItems = append ? [...items, ...data.items] : data.items;
      setItems(nextItems);
      setNextCursor(data.nextCursor);
      setMs(data.meta.ms);
      if (!append) setPreviewId(nextItems[0]?.id ?? null);
    });
  }

  async function loadMore() {
    if (!nextCursor) return;
    await search(true, nextCursor);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              void search();
            }}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition",
              tab === t.id
                ? "bg-ink-950 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <label className="soft-surface flex items-center gap-2 px-3 py-2.5">
          <Search size={16} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            placeholder="SKU, barcode ή όνομα..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">Όλες οι κατηγορίες</option>
          {categories.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">Όλα τα brands</option>
          {brands.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => void search()} disabled={isPending}>
          <Filter size={16} />
          Εφαρμογή
        </Button>
        <Badge tone={ms < 200 ? "emerald" : "amber"}>{ms} ms</Badge>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className="soft-panel overflow-hidden">
          <div className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[0.9fr_1.4fr_0.8fr_0.6fr_0.7fr_0.6fr] md:gap-3">
            <span>SKU</span>
            <span>Περιγραφή</span>
            <span>Κατηγορία</span>
            <span>Τιμή</span>
            <span>Stock</span>
            <span>Κατάσταση</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {items.map((p) => {
              const lowStock = p.isTracked && p.stockOnHand <= p.minStock;
              return (
                <li key={p.id} className="soft-row">
                  <button
                    type="button"
                    onClick={() => setPreviewId(p.id)}
                    className={cn(
                      "grid w-full gap-1 px-4 py-3 text-left md:grid-cols-[0.9fr_1.4fr_0.8fr_0.6fr_0.7fr_0.6fr] md:items-center md:gap-3",
                      previewId === p.id ? "bg-teal-50/70" : "",
                    )}
                  >
                    <span className="font-mono text-sm text-slate-600">{p.sku}</span>
                    <span>
                      <span className="block font-medium text-ink-900">{p.name}</span>
                      <span className="text-xs text-slate-500">{p.brand ?? "—"}</span>
                    </span>
                    <span className="text-sm text-slate-500">{p.category ?? "—"}</span>
                    <span className="text-sm tabular-nums">{formatEUR(p.price)}</span>
                    <span className="text-sm tabular-nums text-slate-500">
                      {p.isTracked ? p.stockOnHand.toFixed(3) : "N/A"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Badge tone={p.status === "ACTIVE" ? "emerald" : "slate"}>
                        {productStatusLabel[p.status as keyof typeof productStatusLabel] ?? p.status}
                      </Badge>
                      {lowStock ? <AlertTriangle className="text-amber-500" size={14} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-500">Δεν βρέθηκαν προϊόντα</li>
            ) : null}
          </ul>
        </section>

        <aside className="soft-panel sticky top-4 h-fit p-4">
          {preview ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{preview.sku}</p>
                  <h3 className="text-lg font-semibold text-ink-950">{preview.name}</h3>
                </div>
                <Badge tone={preview.status === "ACTIVE" ? "emerald" : "slate"}>
                  {productStatusLabel[preview.status as keyof typeof productStatusLabel] ?? preview.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Tile label="Τιμή" value={formatEUR(preview.price)} />
                <Tile label="Κόστος" value={formatEUR(preview.cost)} />
                <Tile label="Περιθώριο" value={`${marginPct(preview).toFixed(1)}%`} />
                <Tile label="ΦΠΑ" value={`${preview.vatRate}%`} />
                <Tile label="Stock" value={preview.isTracked ? preview.stockOnHand.toFixed(3) : "N/A"} />
                <Tile label="Ελάχιστο" value={preview.minStock.toFixed(3)} />
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <p>Κατηγορία: {preview.category ?? "—"}</p>
                <p>Brand: {preview.brand ?? "—"}</p>
                <p>Barcode: {preview.barcode ?? "—"}</p>
                <p>Τοποθεσία: {preview.location ?? "—"}</p>
              </div>
              {preview.tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {preview.tags.map((tag) => (
                    <Badge key={tag} tone="teal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <Link
                  href={`/products/${preview.id}`}
                  className="inline-flex h-10 items-center rounded-xl bg-teal-600 px-3 text-sm font-medium text-white hover:bg-teal-700"
                >
                  Άνοιγμα καρτέλας
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Επίλεξε προϊόν για προεπισκόπηση.</p>
          )}
        </aside>
      </div>

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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-950">{value}</p>
    </div>
  );
}

function marginPct(p: { price: number; cost: number }) {
  if (p.price <= 0) return 0;
  return ((p.price - p.cost) / p.price) * 100;
}
