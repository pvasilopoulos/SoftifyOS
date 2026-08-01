"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  ClipboardList,
  Gauge,
  Package,
  Search,
  Shield,
  Sparkles,
  Warehouse,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";

type SiteOpt = { id: string; code: string; name: string };

type BalanceRow = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  barcode?: string | null;
  siteId: string;
  siteCode: string;
  siteName: string;
  binCode?: string | null;
  qtyOnHand: number;
  qtyReserved?: number;
  qtyAvailable?: number;
  reorderPoint?: number | null;
  averageCost?: number | null;
  isLow?: boolean;
  updatedAt: string;
};

type Kpis = {
  sites: number;
  skuPositions: number;
  qtyTotal: number;
  qtyAvailable: number;
  qtyReserved: number;
  stockValue: number;
  lowStockCount: number;
  expiringLots: number;
  openTransfers: number;
  openCounts: number;
  activeReservations: number;
  movementsToday: number;
};

type Tab =
  | "overview"
  | "balances"
  | "transfers"
  | "counts"
  | "reservations"
  | "valuation"
  | "bins"
  | "ops";

const TABS: Array<{ id: Tab; label: string; icon: typeof Package }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "balances", label: "Υπόλοιπα", icon: Boxes },
  { id: "transfers", label: "Μεταφορές", icon: ArrowLeftRight },
  { id: "counts", label: "Απογραφή", icon: ClipboardList },
  { id: "reservations", label: "Κρατήσεις", icon: Shield },
  { id: "valuation", label: "Αξία", icon: Sparkles },
  { id: "bins", label: "Bins", icon: Warehouse },
  { id: "ops", label: "Κινήσεις", icon: Package },
];

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
  const [tab, setTab] = useState<Tab>("overview");
  const [balances, setBalances] = useState(initialBalances);
  const [sites] = useState(initialSites);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [lowStock, setLowStock] = useState<
    Array<{
      sku: string;
      name: string;
      siteCode: string;
      qtyOnHand: number;
      reorderPoint: number;
    }>
  >([]);
  const [expiring, setExpiring] = useState<
    Array<{
      lotCode: string;
      sku: string;
      name: string;
      siteCode: string;
      qtyOnHand: number;
      expiresAt: string | null;
    }>
  >([]);
  const [transfers, setTransfers] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [counts, setCounts] = useState<Array<Record<string, unknown>>>([]);
  const [reservations, setReservations] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [valuation, setValuation] = useState<{
    items: Array<Record<string, unknown>>;
    totalValue: number;
  } | null>(null);
  const [bins, setBins] = useState<Array<Record<string, unknown>>>([]);
  const [q, setQ] = useState("");
  const [siteId, setSiteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ops form state
  const [products, setProducts] = useState<
    Array<{ id: string; sku: string; name: string }>
  >([]);
  const [adjProductId, setAdjProductId] = useState("");
  const [adjSiteId, setAdjSiteId] = useState("");
  const [adjMode, setAdjMode] = useState<"IN" | "OUT" | "ADJUST">("IN");
  const [adjQty, setAdjQty] = useState("1");
  const [adjNote, setAdjNote] = useState("");

  const filteredBalances = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return balances.filter((b) => {
      if (siteId && b.siteId !== siteId) return false;
      if (!qq) return true;
      return (
        b.sku.toLowerCase().includes(qq) ||
        b.name.toLowerCase().includes(qq) ||
        (b.barcode ?? "").toLowerCase().includes(qq)
      );
    });
  }, [balances, q, siteId]);

  const loadDashboard = () => {
    startTransition(async () => {
      const res = await fetch("/api/inventory/warehouse?kind=dashboard");
      const data = await res.json();
      if (res.ok) {
        setKpis(data.kpis);
        setLowStock(data.lowStock ?? []);
        setExpiring(data.expiringLots ?? []);
      }
    });
  };

  const loadBalances = () => {
    startTransition(async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (q) params.set("q", q);
      if (siteId) params.set("siteId", siteId);
      const res = await fetch(`/api/inventory/balances?${params}`);
      const data = await res.json();
      if (res.ok) setBalances(data.items ?? []);
    });
  };

  const loadKind = (kind: string, setter: (v: never[]) => void) => {
    startTransition(async () => {
      const res = await fetch(`/api/inventory/warehouse?kind=${kind}`);
      const data = await res.json();
      if (res.ok) {
        if (kind === "valuation") {
          setValuation({
            items: data.items ?? [],
            totalValue: data.totalValue ?? 0,
          });
        } else {
          setter(data.items ?? []);
        }
      }
    });
  };

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "balances") loadBalances();
    if (tab === "transfers") loadKind("transfers", setTransfers as never);
    if (tab === "counts") loadKind("counts", setCounts as never);
    if (tab === "reservations")
      loadKind("reservations", setReservations as never);
    if (tab === "valuation") loadKind("valuation", () => undefined);
    if (tab === "bins") loadKind("bins", setBins as never);
    if (tab === "ops") {
      fetch("/api/products?limit=200")
        .then((r) => r.json())
        .then((d) => {
          const items = (d.items ?? d.products ?? []).map(
            (p: { id: string; sku: string; name: string }) => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
            }),
          );
          setProducts(items);
          if (!adjProductId && items[0]) setAdjProductId(items[0].id);
          if (!adjSiteId && sites[0]) setAdjSiteId(sites[0].id);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const postAction = (body: Record<string, unknown>, okMsg: string) => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/inventory/warehouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setMessage(okMsg);
      if (tab === "transfers") loadKind("transfers", setTransfers as never);
      if (tab === "counts") loadKind("counts", setCounts as never);
      if (tab === "reservations")
        loadKind("reservations", setReservations as never);
      if (tab === "bins") loadKind("bins", setBins as never);
      loadDashboard();
      loadBalances();
    });
  };

  const createTransferQuick = () => {
    if (sites.length < 2) {
      setError("Χρειάζονται τουλάχιστον 2 αποθήκες (sites)");
      return;
    }
    const productId = window.prompt("Product ID (ή άσε κενό για επιλογή από λίστα)");
    const fromList = products.length
      ? products
      : balances.map((b) => ({ id: b.productId, sku: b.sku, name: b.name }));
    const pick =
      productId ||
      fromList[0]?.id ||
      "";
    if (!pick) {
      setError("Δεν υπάρχει προϊόν");
      return;
    }
    const qty = Number(window.prompt("Ποσότητα", "1") || 0);
    if (!(qty > 0)) return;
    postAction(
      {
        action: "create-transfer",
        fromSiteId: sites[0]!.id,
        toSiteId: sites[1]!.id,
        ship: true,
        lines: [{ productId: pick, qty }],
      },
      "Μεταφορά δημιουργήθηκε & αποστάλθηκε",
    );
  };

  const createCount = () => {
    const site = siteId || sites[0]?.id;
    if (!site) return;
    postAction(
      { action: "create-count", siteId: site },
      "Ξεκίνησε συνεδρία απογραφής",
    );
  };

  const createBin = () => {
    const site = siteId || sites[0]?.id;
    if (!site) return;
    const code = window.prompt("Κωδικός bin (π.χ. A-01)");
    const name = window.prompt("Όνομα bin");
    if (!code || !name) return;
    postAction(
      { action: "upsert-bin", siteId: site, code, name, zone: "A" },
      "Bin αποθηκεύτηκε",
    );
  };

  const adjustStock = () => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: adjProductId,
          siteId: adjSiteId,
          mode: adjMode,
          qty: Number(adjQty),
          note: adjNote || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία ρύθμισης");
        return;
      }
      setMessage("Κίνηση καταχωρήθηκε");
      loadBalances();
      loadDashboard();
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Αποθήκη"
        description="Modern WMS · υπόλοιπα · μεταφορές · απογραφή · κρατήσεις · FEFO · αξία."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/products"
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50"
            >
              Προϊόντα
            </Link>
            <Link
              href="/purchasing"
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50"
            >
              Αγορές
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition",
              tab === id
                ? "bg-teal-600 text-white shadow-sm"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      {tab === "overview" && kpis ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Αξία αποθέματος"
              value={formatEUR(kpis.stockValue)}
              hint={`${kpis.skuPositions} θέσεις · ${kpis.sites} αποθήκες`}
            />
            <Kpi
              label="Διαθέσιμο / On hand"
              value={`${kpis.qtyAvailable.toLocaleString("el-GR")} / ${kpis.qtyTotal.toLocaleString("el-GR")}`}
              hint={`Κρατήσεις ${kpis.qtyReserved.toLocaleString("el-GR")}`}
            />
            <Kpi
              label="Low stock"
              value={String(kpis.lowStockCount)}
              hint={`${kpis.expiringLots} lots λήγουν σε 30ημ.`}
              warn={kpis.lowStockCount > 0}
            />
            <Kpi
              label="Ανοιχτές εργασίες"
              value={String(
                kpis.openTransfers + kpis.openCounts + kpis.activeReservations,
              )}
              hint={`${kpis.movementsToday} κινήσεις σήμερα · meta ${initialMeta.movements}`}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Χαμηλά αποθέματα" icon={AlertTriangle}>
              {lowStock.length === 0 ? (
                <Empty>Όλα πάνω από reorder point</Empty>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {lowStock.map((r) => (
                    <li
                      key={`${r.sku}-${r.siteCode}`}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span>
                        <span className="font-mono text-xs text-slate-400">
                          {r.sku}
                        </span>{" "}
                        {r.name}
                        <span className="ml-1 text-xs text-slate-400">
                          · {r.siteCode}
                        </span>
                      </span>
                      <Badge tone="rose">
                        {r.qtyOnHand} / {r.reorderPoint}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Lots · λήξη 30ημ. (FEFO)" icon={Sparkles}>
              {expiring.length === 0 ? (
                <Empty>Καμία επικείμενη λήξη</Empty>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {expiring.map((l) => (
                    <li
                      key={l.lotCode + l.sku}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span>
                        <span className="font-mono text-xs text-slate-400">
                          {l.lotCode}
                        </span>{" "}
                        {l.sku}
                      </span>
                      <span className="text-xs text-amber-700">
                        {l.expiresAt
                          ? new Date(l.expiresAt).toLocaleDateString("el-GR")
                          : "—"}{" "}
                        · {l.qtyOnHand}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "balances" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Αναζήτηση SKU / barcode / όνομα"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-teal-400"
              />
            </div>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">Όλες οι αποθήκες</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={loadBalances} disabled={pending}>
              Ανανέωση
            </Button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">SKU</th>
                  <th className="px-3 py-2.5">Προϊόν</th>
                  <th className="px-3 py-2.5">Αποθήκη</th>
                  <th className="px-3 py-2.5">Bin</th>
                  <th className="px-3 py-2.5 text-right">On hand</th>
                  <th className="px-3 py-2.5 text-right">Διαθέσιμο</th>
                  <th className="px-3 py-2.5 text-right">Κράτηση</th>
                </tr>
              </thead>
              <tbody>
                {filteredBalances.map((b) => (
                  <tr
                    key={b.id}
                    className={cn(
                      "border-t border-slate-100",
                      b.isLow && "bg-rose-50/40",
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{b.sku}</td>
                    <td className="px-3 py-2">
                      {b.name}
                      {b.isLow ? (
                        <Badge tone="rose" className="ml-2">
                          Low
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{b.siteCode}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {b.binCode || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.qtyOnHand} {b.unit}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-teal-800">
                      {b.qtyAvailable ?? b.qtyOnHand}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {b.qtyReserved ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "transfers" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={createTransferQuick} disabled={pending}>
              + Μεταφορά (ship)
            </Button>
            <p className="text-xs text-slate-500 self-center">
              DRAFT → IN_TRANSIT → COMPLETED με lot support
            </p>
          </div>
          <DocList
            empty="Δεν υπάρχουν μεταφορές"
            items={transfers.map((t) => ({
              id: String(t.id),
              title: String(t.number),
              subtitle: `${(t.fromSite as { code: string })?.code} → ${(t.toSite as { code: string })?.code}`,
              status: String(t.status),
              action:
                t.status === "IN_TRANSIT" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      postAction(
                        {
                          action: "receive-transfer",
                          transferId: t.id,
                        },
                        "Παραλήφθηκε",
                      )
                    }
                  >
                    Παραλαβή
                  </Button>
                ) : t.status === "DRAFT" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      postAction(
                        { action: "ship-transfer", transferId: t.id },
                        "Απεστάλη",
                      )
                    }
                  >
                    Αποστολή
                  </Button>
                ) : null,
            }))}
          />
        </div>
      ) : null}

      {tab === "counts" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={createCount} disabled={pending}>
              + Νέα απογραφή
            </Button>
          </div>
          <DocList
            empty="Δεν υπάρχουν απογραφές"
            items={counts.map((c) => ({
              id: String(c.id),
              title: String(c.number),
              subtitle: `${(c.site as { code: string })?.code} · ${(c.lines as unknown[])?.length ?? 0} γραμμές`,
              status: String(c.status),
              action:
                c.status === "COUNTED" ? (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      postAction(
                        { action: "post-count", countId: c.id },
                        "Απογραφή οριστικοποιήθηκε",
                      )
                    }
                  >
                    Post variances
                  </Button>
                ) : c.status === "IN_PROGRESS" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      const lines = (c.lines as Array<{
                        id: string;
                        systemQty: number;
                      }>).map((l) => ({
                        lineId: l.id,
                        countedQty: l.systemQty,
                      }));
                      postAction(
                        {
                          action: "submit-count",
                          countId: c.id,
                          lines,
                        },
                        "Μετρήσεις καταχωρήθηκαν (= σύστημα)",
                      );
                    }}
                  >
                    Καταμέτρηση (=)
                  </Button>
                ) : null,
            }))}
          />
        </div>
      ) : null}

      {tab === "reservations" ? (
        <div className="space-y-3">
          <Button
            size="sm"
            disabled={pending || !balances[0]}
            onClick={() => {
              const b = balances[0];
              if (!b) return;
              const qty = Number(window.prompt("Ποσότητα κράτησης", "1") || 0);
              if (!(qty > 0)) return;
              postAction(
                {
                  action: "reserve",
                  siteId: b.siteId,
                  productId: b.productId,
                  qty,
                  note: "Manual reserve",
                },
                "Κράτηση ενεργή",
              );
            }}
          >
            + Κράτηση (1ο υπόλοιπο)
          </Button>
          <DocList
            empty="Καμία ενεργή κράτηση"
            items={reservations.map((r) => ({
              id: String(r.id),
              title: `${(r.product as { sku: string })?.sku} · ${r.qty}`,
              subtitle: (r.site as { code: string })?.code ?? "",
              status: String(r.status),
              action: (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    postAction(
                      {
                        action: "release-reservation",
                        reservationId: r.id,
                      },
                      "Κράτηση απελευθερώθηκε",
                    )
                  }
                >
                  Release
                </Button>
              ),
            }))}
          />
        </div>
      ) : null}

      {tab === "valuation" && valuation ? (
        <div className="space-y-3">
          <div className="soft-panel px-4 py-3">
            <p className="text-xs text-slate-500">Συνολική αξία (average cost)</p>
            <p className="text-2xl font-semibold tabular-nums text-teal-900">
              {formatEUR(valuation.totalValue)}
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Αποθήκη</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Κόστος</th>
                  <th className="px-3 py-2 text-right">Αξία</th>
                </tr>
              </thead>
              <tbody>
                {valuation.items.map((i) => (
                  <tr key={String(i.productId) + String(i.siteCode)} className="border-t border-slate-100">
                    <td className="px-3 py-2">{String(i.sku)}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {String(i.siteCode)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(i.qtyOnHand)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatEUR(Number(i.averageCost || 0))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatEUR(Number(i.stockValue || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "bins" ? (
        <div className="space-y-3">
          <Button size="sm" onClick={createBin} disabled={pending}>
            + Bin
          </Button>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {bins.length === 0 ? (
              <Empty>Δεν υπάρχουν bins — δημιούργησε τοποθεσίες ανά αποθήκη</Empty>
            ) : (
              bins.map((b) => (
                <li
                  key={String(b.id)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <p className="font-mono text-xs text-teal-700">
                    {String(b.code)}
                  </p>
                  <p className="font-medium">{String(b.name)}</p>
                  <p className="text-xs text-slate-500">
                    {(b.site as { code: string })?.code}
                    {b.zone ? ` · zone ${String(b.zone)}` : ""}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

      {tab === "ops" ? (
        <div className="soft-panel max-w-xl space-y-3 p-4">
          <h3 className="text-sm font-semibold">Γρήγορη κίνηση / ρύθμιση</h3>
          <label className="block text-xs font-medium text-slate-600">
            Προϊόν
            <select
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
              value={adjProductId}
              onChange={(e) => setAdjProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Αποθήκη
            <select
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
              value={adjSiteId}
              onChange={(e) => setAdjSiteId(e.target.value)}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-slate-600">
              Τύπος
              <select
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                value={adjMode}
                onChange={(e) =>
                  setAdjMode(e.target.value as "IN" | "OUT" | "ADJUST")
                }
              >
                <option value="IN">Είσοδος</option>
                <option value="OUT">Έξοδος</option>
                <option value="ADJUST">Απόλυτη ρύθμιση</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Ποσότητα
              <input
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
              />
            </label>
          </div>
          <input
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            placeholder="Σημείωση"
            value={adjNote}
            onChange={(e) => setAdjNote(e.target.value)}
          />
          <Button onClick={adjustStock} disabled={pending || !adjProductId}>
            Καταχώριση
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white px-4 py-3 shadow-sm",
        warn ? "border-rose-200" : "border-slate-200",
      )}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          warn ? "text-rose-700" : "text-ink-950",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Package;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className="text-teal-700" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-400">{children}</p>;
}

function DocList({
  items,
  empty,
}: {
  empty: string;
  items: Array<{
    id: string;
    title: string;
    subtitle: string;
    status: string;
    action?: React.ReactNode;
  }>;
}) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {items.map((i) => (
        <li
          key={i.id}
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
        >
          <div>
            <p className="font-medium">{i.title}</p>
            <p className="text-xs text-slate-500">{i.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="teal">{i.status}</Badge>
            {i.action}
          </div>
        </li>
      ))}
    </ul>
  );
}
