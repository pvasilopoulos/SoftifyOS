"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Layers3,
  Package,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";

type SiteOpt = { id: string; code: string; name: string };

type BalanceRow = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  qtyOnHand: number;
  updatedAt: string;
};

type MovementRow = {
  id: string;
  type: "IN" | "OUT" | "ADJUST";
  source: string;
  qty: number;
  qtyBefore: number;
  qtyAfter: number;
  sku: string;
  name: string;
  unit: string;
  siteCode: string;
  note: string | null;
  createdAt: string;
};

type ProductOpt = { id: string; sku: string; name: string };

type LotRow = {
  id: string;
  lotCode: string;
  qtyOnHand: number;
  expiresAt: string | null;
  sku: string;
  name: string;
  siteCode: string;
};

type ReorderHint = {
  productId: string;
  sku: string;
  name: string;
  siteCode: string;
  qtyOnHand: number;
  reorderPoint: number;
};

export function InventoryClient({
  initialBalances,
  initialSites,
  initialMeta,
}: {
  initialBalances: BalanceRow[];
  initialSites: SiteOpt[];
  initialMeta: {
    balanceRows: number;
    trackedProducts: number;
    movements: number;
  };
}) {
  const [tab, setTab] = useState<
    "balances" | "movements" | "adjust" | "transfer" | "lots"
  >("balances");
  const [balances, setBalances] = useState(initialBalances);
  const [sites, setSites] = useState(initialSites);
  const [meta, setMeta] = useState(initialMeta);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [reorderHints, setReorderHints] = useState<ReorderHint[]>([]);
  const [q, setQ] = useState("");
  const [siteId, setSiteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [adjProductId, setAdjProductId] = useState("");
  const [adjSiteId, setAdjSiteId] = useState("");
  const [adjMode, setAdjMode] = useState<"IN" | "OUT" | "ADJUST">("IN");
  const [adjQty, setAdjQty] = useState("1");
  const [adjNote, setAdjNote] = useState("");
  const [trProductId, setTrProductId] = useState("");
  const [trFrom, setTrFrom] = useState("");
  const [trTo, setTrTo] = useState("");
  const [trQty, setTrQty] = useState("1");
  const [trNote, setTrNote] = useState("");
  const [lotProductId, setLotProductId] = useState("");
  const [lotSiteId, setLotSiteId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [lotQty, setLotQty] = useState("1");
  const [lotExpires, setLotExpires] = useState("");
  const [lotNote, setLotNote] = useState("");

  const siteOptions = useMemo(() => sites, [sites]);

  async function loadBalances() {
    setError(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (siteId) params.set("siteId", siteId);
    const res = await fetch(`/api/inventory/balances?${params}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => {
      setBalances(data.items);
      setSites(data.sites ?? []);
      setMeta(data.meta);
    });
  }

  async function loadMovements() {
    setError(null);
    const params = new URLSearchParams({ limit: "50" });
    if (siteId) params.set("siteId", siteId);
    const res = await fetch(`/api/inventory/movements?${params}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => setMovements(data.items));
  }

  async function loadLots() {
    setError(null);
    const res = await fetch("/api/inventory/lots", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης lots");
      return;
    }
    startTransition(() => {
      setLots(data.lots || []);
      setReorderHints(data.reorderHints || []);
    });
  }

  useEffect(() => {
    if (tab === "movements") void loadMovements();
    if (tab === "lots") void loadLots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, siteId]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/products?limit=100&status=ACTIVE", {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        setProducts(
          (data.items as Array<{ id: string; sku: string; name: string }>).map(
            (p) => ({ id: p.id, sku: p.sku, name: p.name }),
          ),
        );
      }
    })();
  }, []);

  async function submitAdjust() {
    setError(null);
    setMessage(null);
    if (!adjProductId) {
      setError("Επίλεξε προϊόν");
      return;
    }
    const qty = Number(adjQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Μη έγκυρη ποσότητα");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: adjProductId,
          siteId: adjSiteId || null,
          mode: adjMode,
          qty,
          adjustTo: adjMode === "ADJUST" ? qty : undefined,
          note: adjNote || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setMessage("Η κίνηση καταχωρήθηκε.");
      setAdjQty("1");
      setAdjNote("");
      await loadBalances();
      if (tab === "movements") await loadMovements();
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Αποθήκη"
        description="Υπόλοιπα ανά υποκατάστημα, κινήσεις και χειροκίνητες ρυθμίσεις"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void loadBalances()}
            disabled={pending}
          >
            <RefreshCw size={14} className={cn(pending && "animate-spin")} />
            Ανανέωση
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Γραμμές υπολοίπων"
          value={meta.balanceRows.toLocaleString("el-GR")}
        />
        <StatCard
          label="Προϊόντα με stock"
          value={meta.trackedProducts.toLocaleString("el-GR")}
        />
        <StatCard
          label="Κινήσεις"
          value={meta.movements.toLocaleString("el-GR")}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["balances", "Υπόλοιπα"],
            ["movements", "Κινήσεις"],
            ["lots", "Lots / Reorder"],
            ["adjust", "Ρύθμιση"],
            ["transfer", "Ενδοδιακίνηση"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-xl border px-3 py-1.5 text-sm font-medium",
              tab === id
                ? "border-teal-300 bg-teal-50 text-teal-900"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === "balances" || tab === "movements") && (
        <div className="soft-panel flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tab === "balances") void loadBalances();
              }}
              placeholder="Αναζήτηση SKU / όνομα…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-teal-300"
            />
          </div>
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">Όλα τα υποκαταστήματα</option>
            {siteOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
          {tab === "balances" ? (
            <Button size="sm" onClick={() => void loadBalances()} disabled={pending}>
              Εφαρμογή
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      {tab === "balances" ? (
        <section className="soft-panel overflow-hidden">
          <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[1fr_1.2fr_0.8fr_0.6fr_0.7fr] md:gap-3">
            <span>SKU</span>
            <span>Προϊόν</span>
            <span>Υποκατάστημα</span>
            <span>Μονάδα</span>
            <span className="text-right">Υπόλοιπο</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {balances.map((row) => (
              <li
                key={row.id}
                className="grid gap-1 px-4 py-3 md:grid-cols-[1fr_1.2fr_0.8fr_0.6fr_0.7fr] md:items-center md:gap-3"
              >
                <Link
                  href={`/products/${row.productId}`}
                  className="font-mono text-sm font-medium text-teal-800 hover:underline"
                >
                  {row.sku}
                </Link>
                <p className="truncate text-sm text-ink-900">{row.name}</p>
                <p className="text-sm text-slate-600">
                  {row.siteCode}
                  <span className="text-slate-400"> · {row.siteName}</span>
                </p>
                <p className="text-sm text-slate-500">{row.unit}</p>
                <p
                  className={cn(
                    "text-right text-sm font-semibold tabular-nums",
                    row.qtyOnHand <= 0 ? "text-rose-700" : "text-ink-950",
                  )}
                >
                  {row.qtyOnHand.toLocaleString("el-GR")}
                </p>
              </li>
            ))}
            {balances.length === 0 ? (
              <li className="px-4 py-14 text-center text-sm text-slate-500">
                <Package size={28} className="mx-auto text-slate-300" />
                <p className="mt-3 font-medium text-ink-900">
                  Δεν υπάρχουν υπόλοιπα ακόμα
                </p>
                <p className="mt-1 text-xs">
                  Κάνε ρύθμιση εισόδου ή έκδωσε παραστατικό με stock effect.
                </p>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {tab === "movements" ? (
        <section className="soft-panel overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {movements.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        m.type === "IN"
                          ? "emerald"
                          : m.type === "OUT"
                            ? "rose"
                            : "amber"
                      }
                    >
                      {m.type}
                    </Badge>
                    <span className="font-mono text-sm font-medium">
                      {m.sku}
                    </span>
                    <span className="truncate text-sm text-slate-600">
                      {m.name}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {m.siteCode} · {m.source}
                    {m.note ? ` · ${m.note}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-ink-950">
                    {m.type === "OUT" ? "−" : "+"}
                    {m.qty.toLocaleString("el-GR")} {m.unit}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {m.qtyBefore} → {m.qtyAfter} ·{" "}
                    {new Date(m.createdAt).toLocaleString("el-GR")}
                  </p>
                </div>
              </li>
            ))}
            {movements.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-slate-500">
                Δεν υπάρχουν κινήσεις.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {tab === "adjust" ? (
        <section className="soft-panel max-w-xl space-y-4 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <SlidersHorizontal size={16} className="text-slate-400" />
            Χειροκίνητη κίνηση
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Προϊόν</span>
            <select
              value={adjProductId}
              onChange={(e) => setAdjProductId(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            >
              <option value="">— Επίλεξε —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Υποκατάστημα</span>
            <select
              value={adjSiteId}
              onChange={(e) => setAdjSiteId(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            >
              <option value="">Αυτόματο (κύριο)</option>
              {siteOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["IN", "Είσοδος", ArrowDownToLine],
                ["OUT", "Έξοδος", ArrowUpFromLine],
                ["ADJUST", "Ορισμός", SlidersHorizontal],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAdjMode(mode)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium",
                  adjMode === mode
                    ? "border-teal-300 bg-teal-50 text-teal-900"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              {adjMode === "ADJUST" ? "Νέο υπόλοιπο" : "Ποσότητα"}
            </span>
            <input
              type="number"
              min={0}
              step="0.001"
              value={adjQty}
              onChange={(e) => setAdjQty(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Σημείωση</span>
            <input
              value={adjNote}
              onChange={(e) => setAdjNote(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              placeholder="π.χ. Αρχικό απόθεμα"
            />
          </label>
          <Button onClick={() => void submitAdjust()} disabled={pending}>
            Καταχώρηση
          </Button>
        </section>
      ) : null}

      {tab === "lots" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <section className="soft-panel max-w-xl space-y-4 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-950">
              <Layers3 size={16} className="text-slate-400" />
              Παραλαβή σε lot
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Προϊόν</span>
              <select
                value={lotProductId}
                onChange={(e) => setLotProductId(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3"
              >
                <option value="">— Επίλεξε —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Υποκατάστημα</span>
              <select
                value={lotSiteId}
                onChange={(e) => setLotSiteId(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3"
              >
                <option value="">Αυτόματο (κύριο)</option>
                {siteOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Κωδικός lot</span>
              <input
                value={lotCode}
                onChange={(e) => setLotCode(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3"
                placeholder="LOT-2026-001"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Ποσότητα</span>
                <input
                  type="number"
                  min={0.001}
                  step="0.001"
                  value={lotQty}
                  onChange={(e) => setLotQty(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Λήξη</span>
                <input
                  type="date"
                  value={lotExpires}
                  onChange={(e) => setLotExpires(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Σημείωση</span>
              <input
                value={lotNote}
                onChange={(e) => setLotNote(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3"
              />
            </label>
            <Button
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  setError(null);
                  setMessage(null);
                  const res = await fetch("/api/inventory/lots", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      productId: lotProductId,
                      siteId: lotSiteId || null,
                      lotCode,
                      qty: Number(lotQty),
                      expiresAt: lotExpires || null,
                      note: lotNote || null,
                    }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setError(data.error || "Αποτυχία παραλαβής lot");
                    return;
                  }
                  setMessage("Το lot ενημερώθηκε");
                  setLotCode("");
                  setLotQty("1");
                  setLotNote("");
                  await loadLots();
                  await loadBalances();
                });
              }}
            >
              Παραλαβή
            </Button>
          </section>

          <div className="space-y-4">
            <section className="soft-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-ink-950">
                  Ενεργά lots
                </h3>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void loadLots()}
                  disabled={pending}
                >
                  <RefreshCw size={14} />
                  Ανανέωση
                </Button>
              </div>
              <ul className="divide-y divide-slate-100">
                {lots.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-mono font-medium text-teal-800">
                        {l.lotCode}
                      </p>
                      <p className="truncate text-slate-600">
                        {l.sku} · {l.name} · {l.siteCode}
                      </p>
                      {l.expiresAt ? (
                        <p className="text-xs text-slate-400">
                          Λήξη{" "}
                          {new Date(l.expiresAt).toLocaleDateString("el-GR")}
                        </p>
                      ) : null}
                    </div>
                    <p className="font-semibold tabular-nums text-ink-950">
                      {l.qtyOnHand.toLocaleString("el-GR")}
                    </p>
                  </li>
                ))}
                {lots.length === 0 ? (
                  <li className="px-4 py-8 text-center text-sm text-slate-500">
                    Δεν υπάρχουν ενεργά lots.
                  </li>
                ) : null}
              </ul>
            </section>

            <section className="soft-panel overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-ink-950">
                  Reorder hints
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Υπόλοιπο ≤ σημείο αναπαραγγελίας προϊόντος
                </p>
              </div>
              <ul className="divide-y divide-slate-100">
                {reorderHints.map((h) => (
                  <li
                    key={`${h.productId}-${h.siteCode}`}
                    className="flex items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/products/${h.productId}`}
                        className="font-mono font-medium text-teal-800 hover:underline"
                      >
                        {h.sku}
                      </Link>
                      <p className="truncate text-slate-600">
                        {h.name} · {h.siteCode}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge tone="amber">
                        {h.qtyOnHand.toLocaleString("el-GR")} /{" "}
                        {h.reorderPoint.toLocaleString("el-GR")}
                      </Badge>
                    </div>
                  </li>
                ))}
                {reorderHints.length === 0 ? (
                  <li className="px-4 py-8 text-center text-sm text-slate-500">
                    Κανένα προϊόν κάτω από reorder point.
                  </li>
                ) : null}
              </ul>
            </section>
          </div>
        </div>
      ) : null}

      {tab === "transfer" ? (
        <section className="soft-panel max-w-xl space-y-4 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <RefreshCw size={16} className="text-slate-400" />
            Ενδοδιακίνηση μεταξύ αποθηκών
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Προϊόν</span>
            <select
              value={trProductId}
              onChange={(e) => setTrProductId(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            >
              <option value="">— Επίλεξε —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Από</span>
              <select
                value={trFrom}
                onChange={(e) => setTrFrom(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3"
              >
                <option value="">—</option>
                {siteOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Προς</span>
              <select
                value={trTo}
                onChange={(e) => setTrTo(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3"
              >
                <option value="">—</option>
                {siteOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Ποσότητα</span>
            <input
              type="number"
              min={0.001}
              step="0.001"
              value={trQty}
              onChange={(e) => setTrQty(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Σημείωση</span>
            <input
              value={trNote}
              onChange={(e) => setTrNote(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            />
          </label>
          <Button
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                setError(null);
                setMessage(null);
                const res = await fetch("/api/inventory/transfer", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    productId: trProductId,
                    fromSiteId: trFrom,
                    toSiteId: trTo,
                    qty: Number(trQty),
                    note: trNote || null,
                  }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  setError(data.error || "Αποτυχία ενδοδιακίνησης");
                  return;
                }
                setMessage("Η ενδοδιακίνηση καταχωρήθηκε");
                void loadBalances();
              });
            }}
          >
            Μεταφορά
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="soft-panel p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink-950">
        {value}
      </p>
    </div>
  );
}
