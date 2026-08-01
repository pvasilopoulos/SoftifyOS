"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Boxes,
  Gauge,
  Layers3,
  MapPinned,
  Package,
  Radio,
  ScanLine,
  Sparkles,
  Tag,
  Warehouse,
  Waves,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { BarcodeScanField } from "@/shared/ui/barcode-scan-field";
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
  openWaves?: number;
  availableSerials?: number;
  inTransitValue?: number;
  inTransitQty?: number;
};

type Tab =
  | "overview"
  | "scan"
  | "waves"
  | "serials"
  | "putaway"
  | "balances"
  | "transfers"
  | "valuation"
  | "bins"
  | "ops";

const TABS: Array<{ id: Tab; label: string; icon: typeof Package }> = [
  { id: "overview", label: "Hub", icon: Gauge },
  { id: "scan", label: "Scanner", icon: ScanLine },
  { id: "waves", label: "Waves", icon: Waves },
  { id: "serials", label: "Serials", icon: Tag },
  { id: "putaway", label: "Putaway", icon: MapPinned },
  { id: "balances", label: "Υπόλοιπα", icon: Boxes },
  { id: "transfers", label: "Μεταφορές", icon: ArrowLeftRight },
  { id: "valuation", label: "Αξία", icon: Sparkles },
  { id: "bins", label: "Bins", icon: Warehouse },
  { id: "ops", label: "Dual UoM", icon: Layers3 },
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
  const [waves, setWaves] = useState<Array<Record<string, unknown>>>([]);
  const [serials, setSerials] = useState<Array<Record<string, unknown>>>([]);
  const [putawayRules, setPutawayRules] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [transfers, setTransfers] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [valuation, setValuation] = useState<{
    items: Array<Record<string, unknown>>;
    totalValue: number;
    onHandValue?: number;
    inTransitValue?: number;
    inTransitItems?: Array<Record<string, unknown>>;
    combinedValue?: number;
  } | null>(null);
  const [bins, setBins] = useState<Array<Record<string, unknown>>>([]);
  const [scanHit, setScanHit] = useState<Record<string, unknown> | null>(null);
  const [scanLog, setScanLog] = useState<
    Array<{ code: string; label: string; at: string }>
  >([]);
  const [q, setQ] = useState("");
  const [siteId, setSiteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [products, setProducts] = useState<
    Array<{ id: string; sku: string; name: string; barcode?: string | null }>
  >([]);
  const [units, setUnits] = useState<
    Array<{ id: string; code: string; symbol: string }>
  >([]);
  const [dualProductId, setDualProductId] = useState("");
  const [dualSiteId, setDualSiteId] = useState("");
  const [dualQty, setDualQty] = useState("1");
  const [useAlt, setUseAlt] = useState(true);
  const [dualMode, setDualMode] = useState<"IN" | "OUT">("IN");

  const filteredBalances = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return balances.filter((b) => {
      if (siteId && b.siteId !== siteId) return false;
      if (!qq) return true;
      return (
        b.sku.toLowerCase().includes(qq) ||
        b.name.toLowerCase().includes(qq) ||
        (b.barcode ?? "").toLowerCase().includes(qq) ||
        (b.binCode ?? "").toLowerCase().includes(qq)
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

  const loadKind = (kind: string) => {
    startTransition(async () => {
      const params = new URLSearchParams({ kind });
      if (siteId) params.set("siteId", siteId);
      const res = await fetch(`/api/inventory/warehouse?${params}`);
      const data = await res.json();
      if (!res.ok) return;
      if (kind === "valuation") {
        setValuation({
          items: data.items ?? [],
          totalValue: data.totalValue ?? 0,
          onHandValue: data.onHandValue,
          inTransitValue: data.inTransitValue,
          inTransitItems: data.inTransitItems,
          combinedValue: data.combinedValue,
        });
      } else if (kind === "waves") setWaves(data.items ?? []);
      else if (kind === "serials") setSerials(data.items ?? []);
      else if (kind === "putaway-rules") setPutawayRules(data.items ?? []);
      else if (kind === "transfers") setTransfers(data.items ?? []);
      else if (kind === "bins") setBins(data.items ?? []);
    });
  };

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "balances") loadBalances();
    if (tab === "waves") loadKind("waves");
    if (tab === "serials") loadKind("serials");
    if (tab === "putaway") loadKind("putaway-rules");
    if (tab === "transfers") loadKind("transfers");
    if (tab === "valuation") loadKind("valuation");
    if (tab === "bins") loadKind("bins");
    if (tab === "ops" || tab === "scan" || tab === "waves" || tab === "serials") {
      fetch("/api/products?limit=200")
        .then((r) => r.json())
        .then((d) => {
          const items = (d.items ?? d.products ?? []).map(
            (p: {
              id: string;
              sku: string;
              name: string;
              barcode?: string | null;
            }) => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
              barcode: p.barcode,
            }),
          );
          setProducts(items);
          if (!dualProductId && items[0]) setDualProductId(items[0].id);
          if (!dualSiteId && sites[0]) setDualSiteId(sites[0].id);
        })
        .catch(() => undefined);
      fetch("/api/settings/units")
        .then((r) => r.json())
        .then((d) => {
          setUnits(
            (d.items ?? []).map(
              (u: { id: string; code: string; symbol: string }) => ({
                id: u.id,
                code: u.code,
                symbol: u.symbol,
              }),
            ),
          );
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
      if (tab === "waves") loadKind("waves");
      if (tab === "serials") loadKind("serials");
      if (tab === "putaway") loadKind("putaway-rules");
      if (tab === "transfers") loadKind("transfers");
      if (tab === "bins") loadKind("bins");
      if (tab === "valuation") loadKind("valuation");
      loadDashboard();
      loadBalances();
    });
  };

  const handleScan = useCallback(
    async (code: string) => {
      const res = await fetch(
        `/api/inventory/warehouse?kind=scan&code=${encodeURIComponent(code)}`,
      );
      const data = await res.json();
      if (!res.ok) return { ok: false as const, error: data.error || "Not found" };
      setScanHit(data);
      const label =
        data.kind === "serial"
          ? `Serial ${code} · ${data.product?.sku}`
          : `${data.product?.sku} · ${data.product?.name}`;
      setScanLog((prev) => [
        { code, label, at: new Date().toISOString() },
        ...prev.slice(0, 11),
      ]);
      setTab("scan");
      return { ok: true as const, message: label };
    },
    [],
  );

  const createWaveQuick = () => {
    const site = siteId || sites[0]?.id;
    if (!site) return;
    const productId =
      products[0]?.id ||
      balances[0]?.productId ||
      window.prompt("Product ID");
    if (!productId) return;
    const qty = Number(window.prompt("Ποσότητα pick", "1") || 0);
    if (!(qty > 0)) return;
    postAction(
      {
        action: "create-wave",
        siteId: site,
        autoReserve: true,
        useFefo: true,
        lines: [{ productId, qty }],
      },
      "Wave δημιουργήθηκε (FEFO + reserve)",
    );
  };

  const createSerialQuick = () => {
    const site = siteId || sites[0]?.id;
    const productId = products[0]?.id || balances[0]?.productId;
    if (!site || !productId) {
      setError("Χρειάζεται site + προϊόν");
      return;
    }
    const serial = window.prompt("Serial number");
    if (!serial) return;
    postAction(
      {
        action: "register-serial",
        siteId: site,
        productId,
        serial,
        receiveStock: true,
      },
      `Serial ${serial} καταχωρήθηκε`,
    );
  };

  const createPutawayRule = () => {
    const site = siteId || sites[0]?.id;
    if (!site) return;
    if (!bins.length) loadKind("bins");
    const binId =
      (bins[0] as { id?: string } | undefined)?.id ||
      window.prompt("Bin ID");
    if (!binId) {
      setError("Δημιούργησε πρώτα bin");
      return;
    }
    const code = window.prompt("Κωδικός κανόνα", "PUT-01");
    const name = window.prompt("Όνομα", "Default putaway");
    if (!code || !name) return;
    postAction(
      {
        action: "upsert-putaway-rule",
        siteId: site,
        code,
        name,
        targetBinId: binId,
        strategy: "FIXED",
        priority: 10,
      },
      "Putaway rule αποθηκεύτηκε",
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

  const createTransferQuick = () => {
    if (sites.length < 2) {
      setError("Χρειάζονται τουλάχιστον 2 αποθήκες");
      return;
    }
    const pick = products[0]?.id || balances[0]?.productId;
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
      "Μεταφορά σε διαδρομή (in-transit)",
    );
  };

  const runDualUom = () => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/inventory/warehouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust-dual-uom",
          siteId: dualSiteId,
          productId: dualProductId,
          qty: Number(dualQty),
          useAltUnit: useAlt,
          mode: dualMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setMessage(
        `${dualMode} ${dualQty} → base ${data.conversion?.baseQty} (×${data.conversion?.factor})`,
      );
      loadBalances();
      loadDashboard();
    });
  };

  const setDualOnProduct = () => {
    if (!units.length) {
      setError("Δεν υπάρχουν μονάδες — ρύθμισε Units");
      return;
    }
    const alt =
      units.find((u) => u.code === "BOX" || u.code === "PKG") ?? units[0];
    const factor = Number(window.prompt("1 alt = πόσα base;", "12") || 0);
    if (!alt || !(factor > 0) || !dualProductId) return;
    postAction(
      {
        action: "set-dual-uom",
        productId: dualProductId,
        altUnitId: alt.id,
        altToBaseFactor: factor,
      },
      `Dual UoM: 1 ${alt.symbol} = ${factor} base`,
    );
  };

  return (
    <div className="wms-shell relative space-y-6">
      <style jsx global>{`
        .wms-shell {
          --wms-ink: #0b1f2a;
          --wms-teal: #0f766e;
          --wms-glow: rgba(15, 118, 110, 0.18);
        }
        .wms-hero {
          background:
            radial-gradient(1200px 400px at 10% -20%, var(--wms-glow), transparent 60%),
            radial-gradient(800px 300px at 90% 0%, rgba(8, 145, 178, 0.12), transparent 55%),
            linear-gradient(180deg, #f0f7f6 0%, #f8fafc 55%, transparent 100%);
          border: 1px solid rgba(15, 118, 110, 0.12);
          animation: wmsFade 0.55s ease-out;
        }
        .wms-panel {
          animation: wmsRise 0.45s ease-out;
        }
        .wms-grid-bg {
          background-image:
            linear-gradient(rgba(15, 118, 110, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(15, 118, 110, 0.04) 1px, transparent 1px);
          background-size: 28px 28px;
        }
        @keyframes wmsFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes wmsRise {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes wmsPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(15, 118, 110, 0.25); }
          50% { box-shadow: 0 0 0 10px rgba(15, 118, 110, 0); }
        }
        .wms-live {
          animation: wmsPulse 2.4s ease-out infinite;
        }
      `}</style>

      <div className="wms-hero wms-grid-bg overflow-hidden rounded-[1.75rem] px-5 py-6 sm:px-7">
        <PageHeader
          title="Αποθήκη"
          description="Wave picking · serials · putaway · in-transit valuation · dual UoM · live scanner"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/products"
                className="inline-flex h-9 items-center rounded-xl border border-teal-800/10 bg-white/80 px-3 text-sm font-medium text-[var(--wms-ink)] hover:bg-white"
              >
                Προϊόντα ({initialMeta.trackedProducts})
              </Link>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTab("scan")}
              >
                <Radio className="mr-1.5 h-3.5 w-3.5" />
                Scanner
              </Button>
            </div>
          }
        />

        <div className="mt-5 max-w-2xl">
          <BarcodeScanField onScan={handleScan} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {(
            [
              ["On-hand", formatEUR(kpis?.stockValue ?? 0)],
              ["In-transit", formatEUR(kpis?.inTransitValue ?? 0)],
              ["Waves", String(kpis?.openWaves ?? 0)],
              ["Serials", String(kpis?.availableSerials ?? 0)],
              ["Available", String(kpis?.qtyAvailable ?? "—")],
            ] as const
          ).map(([label, value], i) => (
            <div
              key={label}
              className={cn(
                "rounded-2xl border border-white/60 bg-white/70 px-3.5 py-2 backdrop-blur",
                i === 0 && "wms-live",
              )}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {label}
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--wms-ink)]">
                {value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-[var(--wms-ink)] text-white shadow-lg shadow-teal-900/20"
                  : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/80",
              )}
            >
              <Icon className="h-3.5 w-3.5 opacity-80" />
              {t.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-2xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      <div className="wms-panel">
        {tab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Χαμηλό απόθεμα" className="lg:col-span-1">
              {lowStock.length === 0 ? (
                <Empty text="Όλα εντάξει" />
              ) : (
                <ul className="space-y-2">
                  {lowStock.slice(0, 6).map((r) => (
                    <li
                      key={`${r.sku}-${r.siteCode}`}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="font-mono text-xs text-teal-800">
                          {r.sku}
                        </span>{" "}
                        {r.name}
                      </span>
                      <Badge tone="rose">
                        {r.qtyOnHand}/{r.reorderPoint}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Λήξεις FEFO (30ημ.)" className="lg:col-span-1">
              {expiring.length === 0 ? (
                <Empty text="Καμία λήξη κοντά" />
              ) : (
                <ul className="space-y-2">
                  {expiring.slice(0, 6).map((l) => (
                    <li
                      key={`${l.lotCode}-${l.sku}`}
                      className="rounded-xl bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs">{l.lotCode}</span> ·{" "}
                      {l.sku}
                      <span className="ml-2 text-xs text-slate-500">
                        {l.expiresAt
                          ? new Date(l.expiresAt).toLocaleDateString("el-GR")
                          : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Γρήγορες ενέργειες" className="lg:col-span-1">
              <div className="flex flex-col gap-2">
                <Button size="sm" disabled={pending} onClick={createWaveQuick}>
                  + Wave pick
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={createSerialQuick}
                >
                  + Serial receive
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={createTransferQuick}
                >
                  Μεταφορά → in-transit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={createBin}
                >
                  + Bin
                </Button>
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === "scan" ? (
          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title="Live scan dock" className="lg:col-span-3">
              <BarcodeScanField onScan={handleScan} />
              {scanHit ? (
                <div className="mt-4 rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50/80 to-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
                    {String(scanHit.kind)}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-[var(--wms-ink)]">
                    {(scanHit.product as { sku?: string })?.sku} ·{" "}
                    {(scanHit.product as { name?: string })?.name}
                  </p>
                  {scanHit.kind === "serial" ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Serial{" "}
                      <span className="font-mono">
                        {(scanHit.serial as { serial?: string })?.serial}
                      </span>{" "}
                      ·{" "}
                      {(scanHit.serial as { status?: string })?.status}
                      {(scanHit.serial as { bin?: { code?: string } })?.bin
                        ?.code
                        ? ` · bin ${(scanHit.serial as { bin?: { code?: string } }).bin?.code}`
                        : ""}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">
                      Barcode{" "}
                      {(scanHit.product as { barcode?: string })?.barcode || "—"}
                      {(scanHit.product as { trackSerials?: boolean })
                        ?.trackSerials
                        ? " · tracks serials"
                        : ""}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const pid = (scanHit.product as { id?: string })?.id;
                        if (pid) {
                          setQ(
                            (scanHit.product as { sku?: string })?.sku || "",
                          );
                          setTab("balances");
                        }
                      }}
                    >
                      Δες υπόλοιπο
                    </Button>
                    {scanHit.kind === "serial" &&
                    (scanHit.serial as { status?: string })?.status ===
                      "AVAILABLE" ? (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          postAction(
                            {
                              action: "ship-serial",
                              serialId: (scanHit.serial as { id?: string })?.id,
                            },
                            "Serial shipped",
                          )
                        }
                      >
                        Ship serial
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <Empty text="Σάρωσε barcode, SKU ή serial για άμεση αναγνώριση" />
              )}
            </Panel>
            <Panel title="Ιστορικό σαρώσεων" className="lg:col-span-2">
              {scanLog.length === 0 ? (
                <Empty text="Καμία σάρωση ακόμη" />
              ) : (
                <ul className="space-y-2">
                  {scanLog.map((s) => (
                    <li
                      key={`${s.code}-${s.at}`}
                      className="rounded-xl border border-slate-100 px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs text-teal-800">
                        {s.code}
                      </span>
                      <p className="text-slate-600">{s.label}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        ) : null}

        {tab === "waves" ? (
          <Panel
            title="Wave picking"
            action={
              <Button size="sm" disabled={pending} onClick={createWaveQuick}>
                + Wave
              </Button>
            }
          >
            <p className="mb-3 text-xs text-slate-500">
              FEFO lot allocation · αυτόματη κράτηση · confirm pick ανά γραμμή
              (scanner-ready)
            </p>
            {waves.length === 0 ? (
              <Empty text="Κανένα wave — δημιούργησε το πρώτο" />
            ) : (
              <ul className="space-y-3">
                {waves.map((w) => {
                  const lines = (w.lines as Array<Record<string, unknown>>) || [];
                  return (
                    <li
                      key={String(w.id)}
                      className="rounded-2xl border border-slate-100 bg-white p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">
                            <span className="font-mono text-teal-800">
                              {String(w.number)}
                            </span>{" "}
                            · {(w.site as { code?: string })?.code}
                          </p>
                          <p className="text-xs text-slate-500">
                            {lines.length} γραμμές
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              w.status === "DONE"
                                ? "emerald"
                                : w.status === "PICKING"
                                  ? "teal"
                                  : "slate"
                            }
                          >
                            {String(w.status)}
                          </Badge>
                          {w.status === "DRAFT" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending}
                              onClick={() =>
                                postAction(
                                  { action: "release-wave", waveId: w.id },
                                  "Wave released",
                                )
                              }
                            >
                              Release
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {lines.map((l) => (
                          <li
                            key={String(l.id)}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                          >
                            <span>
                              <span className="font-mono text-xs">
                                {(l.product as { sku?: string })?.sku}
                              </span>{" "}
                              {Number(l.qtyPicked)}/{Number(l.qty)}{" "}
                              {(l.product as { unit?: string })?.unit}
                              {l.lotCode ? (
                                <span className="ml-1 text-xs text-slate-400">
                                  lot {String(l.lotCode)}
                                </span>
                              ) : null}
                              {(l.fromBin as { code?: string } | null)?.code ? (
                                <span className="ml-1 text-xs text-teal-700">
                                  @{(l.fromBin as { code?: string }).code}
                                </span>
                              ) : null}
                            </span>
                            {l.status === "OPEN" &&
                            (w.status === "RELEASED" ||
                              w.status === "PICKING" ||
                              w.status === "DRAFT") ? (
                              <Button
                                size="sm"
                                disabled={pending}
                                onClick={() =>
                                  postAction(
                                    {
                                      action: "pick-wave-line",
                                      waveId: w.id,
                                      lineId: l.id,
                                    },
                                    "Pick confirmed",
                                  )
                                }
                              >
                                Pick
                              </Button>
                            ) : (
                              <Badge tone="emerald">{String(l.status)}</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        ) : null}

        {tab === "serials" ? (
          <Panel
            title="Serial tracking"
            action={
              <Button size="sm" disabled={pending} onClick={createSerialQuick}>
                + Serial
              </Button>
            }
          >
            {serials.length === 0 ? (
              <Empty text="Κανένα serial ακόμη" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-2 py-2 text-left">Serial</th>
                      <th className="px-2 py-2 text-left">SKU</th>
                      <th className="px-2 py-2 text-left">Site</th>
                      <th className="px-2 py-2 text-left">Bin</th>
                      <th className="px-2 py-2 text-left">Status</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {serials.map((s) => (
                      <tr key={String(s.id)} className="border-t border-slate-50">
                        <td className="px-2 py-2 font-mono text-xs text-teal-800">
                          {String(s.serial)}
                        </td>
                        <td className="px-2 py-2">
                          {(s.product as { sku?: string })?.sku}
                        </td>
                        <td className="px-2 py-2">
                          {(s.site as { code?: string })?.code}
                        </td>
                        <td className="px-2 py-2">
                          {(s.bin as { code?: string } | null)?.code || "—"}
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            tone={
                              s.status === "AVAILABLE" ? "emerald" : "slate"
                            }
                          >
                            {String(s.status)}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-right">
                          {s.status === "AVAILABLE" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending}
                              onClick={() =>
                                postAction(
                                  { action: "ship-serial", serialId: s.id },
                                  "Serial shipped",
                                )
                              }
                            >
                              Ship
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}

        {tab === "putaway" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Putaway rules"
              action={
                <Button size="sm" disabled={pending} onClick={createPutawayRule}>
                  + Rule
                </Button>
              }
            >
              {putawayRules.length === 0 ? (
                <Empty text="Κανένας κανόνας — δημιούργησε bins πρώτα" />
              ) : (
                <ul className="space-y-2">
                  {putawayRules.map((r) => (
                    <li
                      key={String(r.id)}
                      className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="font-mono text-xs text-slate-400">
                          {String(r.code)}
                        </span>{" "}
                        {String(r.name)}
                        <span className="ml-2 text-xs text-teal-700">
                          → {(r.targetBin as { code?: string })?.code}
                        </span>
                      </span>
                      <Badge tone="slate">{String(r.strategy)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Apply putaway">
              <p className="mb-3 text-xs text-slate-500">
                Τοποθετεί το SKU στο suggested bin σύμφωνα με τους κανόνες.
              </p>
              <Button
                size="sm"
                disabled={pending || !balances[0]}
                onClick={() => {
                  const b = balances[0];
                  if (!b) return;
                  postAction(
                    {
                      action: "apply-putaway",
                      siteId: b.siteId,
                      productId: b.productId,
                    },
                    "Putaway εφαρμόστηκε",
                  );
                }}
              >
                Putaway πρώτου υπολοίπου
              </Button>
              <div className="mt-4">
                <Button size="sm" variant="secondary" onClick={createBin}>
                  + Bin
                </Button>
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === "balances" ? (
          <Panel title="Υπόλοιπα">
            <div className="mb-3 flex flex-wrap gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="SKU / barcode / bin…"
                className="h-10 min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 text-sm"
              />
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
              >
                <option value="">Όλα τα sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={loadBalances}
              >
                Ανανέωση
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-2 py-2 text-left">SKU</th>
                    <th className="px-2 py-2 text-left">Site / Bin</th>
                    <th className="px-2 py-2 text-right">On hand</th>
                    <th className="px-2 py-2 text-right">Available</th>
                    <th className="px-2 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBalances.map((b) => (
                    <tr
                      key={b.id}
                      className={cn(
                        "border-t border-slate-50",
                        b.isLow && "bg-rose-50/40",
                      )}
                    >
                      <td className="px-2 py-2">
                        <span className="font-mono text-xs text-teal-800">
                          {b.sku}
                        </span>
                        <span className="ml-1">{b.name}</span>
                      </td>
                      <td className="px-2 py-2 text-slate-600">
                        {b.siteCode}
                        {b.binCode ? (
                          <span className="ml-1 text-teal-700">@{b.binCode}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {b.qtyOnHand} {b.unit}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {b.qtyAvailable ?? b.qtyOnHand}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatEUR(Number(b.averageCost || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}

        {tab === "transfers" ? (
          <Panel
            title="Μεταφορές"
            action={
              <Button size="sm" disabled={pending} onClick={createTransferQuick}>
                + Ship
              </Button>
            }
          >
            {transfers.length === 0 ? (
              <Empty text="Καμία μεταφορά" />
            ) : (
              <ul className="space-y-2">
                {transfers.map((t) => (
                  <li
                    key={String(t.id)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-mono text-teal-800">
                        {String(t.number)}
                      </span>{" "}
                      {(t.fromSite as { code?: string })?.code} →{" "}
                      {(t.toSite as { code?: string })?.code}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge
                        tone={
                          t.status === "IN_TRANSIT"
                            ? "teal"
                            : t.status === "COMPLETED"
                              ? "emerald"
                              : "slate"
                        }
                      >
                        {String(t.status)}
                      </Badge>
                      {t.status === "IN_TRANSIT" ? (
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
                          Receive
                        </Button>
                      ) : null}
                      {t.status === "DRAFT" ? (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            postAction(
                              { action: "ship-transfer", transferId: t.id },
                              "Αποστολή",
                            )
                          }
                        >
                          Ship
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {tab === "valuation" ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Kpi
                label="On-hand value"
                value={formatEUR(valuation?.onHandValue ?? valuation?.totalValue ?? 0)}
              />
              <Kpi
                label="In-transit value"
                value={formatEUR(valuation?.inTransitValue ?? 0)}
              />
              <Kpi
                label="Combined"
                value={formatEUR(valuation?.combinedValue ?? 0)}
                emphasize
              />
            </div>
            <Panel title="In-transit γραμμές">
              {(valuation?.inTransitItems?.length ?? 0) === 0 ? (
                <Empty text="Καμία ποσότητα σε διαδρομή" />
              ) : (
                <ul className="space-y-1 text-sm">
                  {valuation!.inTransitItems!.map((i, idx) => (
                    <li
                      key={`${i.transferId}-${idx}`}
                      className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <span>
                        {String(i.transferNumber)} · {String(i.sku)} ·{" "}
                        {String(i.fromSite)}→{String(i.toSite)}
                      </span>
                      <span className="tabular-nums">
                        {Number(i.qty)} · {formatEUR(Number(i.inTransitValue))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="On-hand (με dual UoM όπου υπάρχει)">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-2 py-2 text-left">SKU</th>
                      <th className="px-2 py-2 text-right">Base qty</th>
                      <th className="px-2 py-2 text-right">Alt qty</th>
                      <th className="px-2 py-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(valuation?.items ?? []).slice(0, 40).map((i) => (
                      <tr
                        key={`${i.productId}-${i.siteCode}`}
                        className="border-t border-slate-50"
                      >
                        <td className="px-2 py-1.5">
                          <span className="font-mono text-xs text-teal-800">
                            {String(i.sku)}
                          </span>{" "}
                          {String(i.name)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {Number(i.qtyOnHand)} {String(i.unit)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                          {i.qtyAlt != null
                            ? `${Number(i.qtyAlt)} ${i.altUnit || "alt"}`
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatEUR(Number(i.stockValue))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === "bins" ? (
          <Panel
            title="Bins / zones"
            action={
              <Button size="sm" disabled={pending} onClick={createBin}>
                + Bin
              </Button>
            }
          >
            {bins.length === 0 ? (
              <Empty text="Κανένα bin" />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {bins.map((b) => (
                  <li
                    key={String(b.id)}
                    className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 px-3 py-3 text-sm"
                  >
                    <p className="font-mono text-teal-800">{String(b.code)}</p>
                    <p className="font-medium">{String(b.name)}</p>
                    <p className="text-xs text-slate-500">
                      {(b.site as { code?: string })?.code}
                      {b.zone ? ` · zone ${String(b.zone)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {tab === "ops" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Dual UoM κίνηση">
              <p className="mb-3 text-xs text-slate-500">
                Καταχώρηση σε pack/alt μονάδα · αποθήκευση πάντα σε base UoM.
              </p>
              <div className="grid gap-2">
                <select
                  value={dualProductId}
                  onChange={(e) => setDualProductId(e.target.value)}
                  className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={dualSiteId}
                  onChange={(e) => setDualSiteId(e.target.value)}
                  className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={dualQty}
                    onChange={(e) => setDualQty(e.target.value)}
                    className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm"
                  />
                  <select
                    value={dualMode}
                    onChange={(e) =>
                      setDualMode(e.target.value as "IN" | "OUT")
                    }
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
                  >
                    <option value="IN">IN</option>
                    <option value="OUT">OUT</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={useAlt}
                    onChange={(e) => setUseAlt(e.target.checked)}
                  />
                  Χρήση alt μονάδας (pack)
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={pending} onClick={runDualUom}>
                    Καταχώρηση
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={setDualOnProduct}
                  >
                    Όρισε dual UoM στο προϊόν
                  </Button>
                </div>
              </div>
            </Panel>
            <Panel title="Οδηγίες">
              <ol className="list-decimal space-y-2 pl-4 text-sm text-slate-600">
                <li>Όρισε alt μονάδα (π.χ. BOX) και συντελεστή → base.</li>
                <li>Οι κινήσεις Dual UoM γράφουν qtyInUom + base qty.</li>
                <li>Η αποτίμηση δείχνει και alt qty όπου υπάρχει.</li>
                <li>
                  Units:{" "}
                  <Link href="/settings/units" className="text-teal-700 underline">
                    Ρυθμίσεις μονάδων
                  </Link>
                </li>
              </ol>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-900/5",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--wms-ink)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-slate-400">{text}</p>;
}

function Kpi({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          emphasize ? "text-teal-800" : "text-[var(--wms-ink)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}
