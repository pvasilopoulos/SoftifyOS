"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Gift,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  calcInvoiceTotals,
  calcLineTotals,
  formatEUR,
  roundMoney,
} from "@/modules/sales/invoice-utils";
import {
  calcPayable,
  eurToRedeemPoints,
  remainingCoverDue,
  validateTenders,
} from "@/modules/pos/payable";
import { SeriesPicker } from "@/modules/documents/series-picker";
import { PosBarcodeScan } from "@/modules/pos/barcode-scan";
import type { PaymentMethodKind } from "@/modules/payments/labels";

const paymentMethodIcon = {
  CASH: Banknote,
  CARD: CreditCard,
  TRANSFER: ArrowLeftRight,
  GIFT_CARD: Gift,
  LOYALTY: Star,
  OTHER: MoreHorizontal,
} as const;

type PaymentMethodOption = {
  id: string;
  code: string;
  name: string;
  kind: PaymentMethodKind;
  allowsChange: boolean;
  requiresExternalRef: boolean;
};

type Site = { id: string; code: string; name: string; kind: string };
type Customer = { id: string; code: string; name: string };
type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  price: number;
  vatRate: number;
};
type Terminal = { id: string; code: string; name: string; provider: string };
type Line = {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};
type Tender = {
  key: string;
  method: string;
  amount: string;
  giftCardCode?: string;
  loyaltyPoints?: string;
};

function newLine(): Line {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    productId: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    vatRate: "24",
  };
}

export function PosClient({
  sites,
  customers,
  products,
  terminals,
  paymentMethods,
}: {
  sites: Site[];
  customers: Customer[];
  products: Product[];
  terminals: Terminal[];
  paymentMethods: PaymentMethodOption[];
}) {
  const defaultTill =
    sites.find((s) => s.kind === "TILL")?.id ?? sites[0]?.id ?? "";
  const [siteId, setSiteId] = useState(defaultTill);
  const [seriesId, setSeriesId] = useState("");
  const [terminalId, setTerminalId] = useState(terminals[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [tenders, setTenders] = useState<Tender[]>(() => [
    {
      key: "cash",
      method:
        paymentMethods.find((m) => m.kind === "CASH")?.code ??
        paymentMethods[0]?.code ??
        "CASH",
      amount: "",
    },
  ]);
  const [discount, setDiscount] = useState("0");
  const [giftCode, setGiftCode] = useState("");
  const [giftBalance, setGiftBalance] = useState<number | null>(null);
  const [showGiftEntry, setShowGiftEntry] = useState(false);
  const [loyalty, setLoyalty] = useState<{
    pointsBalance: number;
    maxRedeemEur: number;
  } | null>(null);
  const [loyaltyRedeemEur, setLoyaltyRedeemEur] = useState("0");
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<{
    number: string;
    change: number;
    invoiceId: string;
  } | null>(null);

  const totals = useMemo(
    () =>
      calcInvoiceTotals(
        lines.map((l) => ({
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          vatRate: Number(l.vatRate) || 0,
        })),
      ),
    [lines],
  );

  const methodByCode = useMemo(() => {
    const map = new Map(paymentMethods.map((m) => [m.code, m]));
    return map;
  }, [paymentMethods]);

  const posGridMethods = useMemo(
    () => paymentMethods.filter((m) => m.kind !== "LOYALTY"),
    [paymentMethods],
  );

  const defaultCashCode =
    paymentMethods.find((m) => m.kind === "CASH")?.code ??
    paymentMethods[0]?.code ??
    "CASH";

  const giftApplied = useMemo(() => {
    return tenders
      .filter((x) => methodByCode.get(x.method)?.kind === "GIFT_CARD")
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }, [tenders, methodByCode]);

  const loyaltyApplied = Number(loyaltyRedeemEur) || 0;

  const payable = useMemo(
    () =>
      calcPayable({
        saleTotal: totals.total,
        discount: Number(discount) || 0,
        giftCardApplied: giftApplied,
        loyaltyAppliedEur: loyaltyApplied,
      }),
    [totals.total, discount, giftApplied, loyaltyApplied],
  );

  const isSpecialKind = (method: string) => {
    const kind = methodByCode.get(method)?.kind;
    return kind === "GIFT_CARD" || kind === "LOYALTY";
  };

  const coverMethodOptions = useMemo(
    () =>
      paymentMethods.filter(
        (m) => m.kind !== "LOYALTY" && m.kind !== "GIFT_CARD",
      ),
    [paymentMethods],
  );

  const coverLines = useMemo(
    () =>
      tenders
        .filter((t) => !isSpecialKind(t.method))
        .map((t) => {
          const pm = methodByCode.get(t.method);
          return {
            method: t.method,
            kind: pm?.kind,
            amount: Number(t.amount) || 0,
            allowsChange: pm?.allowsChange,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isSpecialKind uses methodByCode
    [tenders, methodByCode],
  );

  const remainingDue = useMemo(
    () => remainingCoverDue(payable.payableDue, coverLines),
    [payable.payableDue, coverLines],
  );

  const tenderCheck = useMemo(
    () => validateTenders(payable.payableDue, coverLines),
    [payable.payableDue, coverLines],
  );

  const changePreview =
    tenderCheck.ok && tenderCheck.change > 0 ? tenderCheck.change : 0;

  // Keep a single cash-like cover tender aligned when gift/loyalty changes
  useEffect(() => {
    setTenders((prev) => {
      const covers = prev.filter((t) => !isSpecialKind(t.method));
      if (covers.length !== 1) return prev;
      const only = covers[0]!;
      const pm = methodByCode.get(only.method);
      if (!(pm?.kind === "CASH" || pm?.allowsChange)) return prev;
      const nextAmount =
        payable.payableDue > 0 ? String(payable.payableDue) : "";
      if (only.amount === nextAmount) return prev;
      return prev.map((t) =>
        t.key === only.key ? { ...t, amount: nextAmount } : t,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftApplied, loyaltyApplied, payable.payableDue]);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/pos/lookup?customerId=${encodeURIComponent(customerId)}`,
      );
      const data = (await res.json()) as {
        loyalty?: { pointsBalance: number; maxRedeemEur: number };
      };
      if (!cancelled) setLoyalty(data.loyalty ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/pos/sessions?siteId=${encodeURIComponent(siteId)}`,
      );
      const data = (await res.json()) as { items?: Array<{ id: string }> };
      if (!cancelled) setSessionId(data.items?.[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  async function openSession() {
    setError(null);
    const res = await fetch("/api/pos/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, openingFloat: 50 }),
    });
    const data = (await res.json()) as {
      item?: { id: string };
      error?: string;
    };
    if (!res.ok && res.status !== 409) {
      setError(data.error || "Αποτυχία ανοίγματος βάρδιας");
      return;
    }
    setSessionId(data.item?.id ?? sessionId);
    setMessage("Η βάρδια ταμείου είναι ανοιχτή");
  }

  async function lookupGift() {
    setError(null);
    const res = await fetch(
      `/api/pos/lookup?giftCard=${encodeURIComponent(giftCode.trim())}`,
    );
    const data = (await res.json()) as {
      giftCard?: { balance: number; code: string; status: string };
      error?: string;
    };
    if (!res.ok) {
      setGiftBalance(null);
      setError(data.error || "Δωροκάρτα δεν βρέθηκε");
      return;
    }
    setGiftBalance(data.giftCard!.balance);
    const afterDiscount = Math.max(
      0,
      payable.saleTotal - (Number(discount) || 0),
    );
    const apply = Math.min(data.giftCard!.balance, afterDiscount);
    setTenders((prev) => {
      const without = prev.filter(
        (t) => methodByCode.get(t.method)?.kind !== "GIFT_CARD",
      );
      const giftCodeMethod =
        paymentMethods.find((m) => m.kind === "GIFT_CARD")?.code ?? "GIFT_CARD";
      return [
        ...without,
        {
          key: `gift-${Date.now()}`,
          method: giftCodeMethod,
          amount: String(apply),
          giftCardCode: data.giftCard!.code,
        },
      ];
    });
    setShowGiftEntry(true);
  }

  function addCoverTender(
    pm: PaymentMethodOption,
    mode: "replace" | "append",
  ) {
    setError(null);
    setShowGiftEntry(false);
    setShowAddMethod(false);
    setTenders((prev) => {
      const special = prev.filter((t) => isSpecialKind(t.method));
      const covers = prev.filter((t) => !isSpecialKind(t.method));

      if (mode === "replace") {
        const amount =
          payable.payableDue > 0 ? String(payable.payableDue) : "";
        return [
          ...special,
          {
            key: covers[0]?.key ?? `t-${Date.now()}`,
            method: pm.code,
            amount,
          },
        ];
      }

      // Additional method: only the still-uncovered remainder
      const paid = covers.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const remaining = roundMoney(Math.max(0, payable.payableDue - paid));
      const amount = remaining > 0 ? String(remaining) : "";
      return [
        ...prev,
        { key: `t-${Date.now()}`, method: pm.code, amount },
      ];
    });
  }

  function pickPaymentMethod(pm: PaymentMethodOption) {
    setError(null);
    if (pm.kind === "GIFT_CARD") {
      setShowGiftEntry(true);
      setShowAddMethod(false);
      return;
    }
    addCoverTender(pm, "replace");
  }

  function applyLoyalty() {
    if (!loyalty) return;
    const eur = Math.min(
      Number(loyaltyRedeemEur) || loyalty.maxRedeemEur,
      loyalty.maxRedeemEur,
      payable.saleTotal,
    );
    setLoyaltyRedeemEur(String(eur));
    setTenders((prev) => {
      const without = prev.filter(
        (t) => methodByCode.get(t.method)?.kind !== "LOYALTY",
      );
      if (eur <= 0) return without;
      const loyaltyCode =
        paymentMethods.find((m) => m.kind === "LOYALTY")?.code ?? "LOYALTY";
      return [
        ...without,
        {
          key: `loy-${Date.now()}`,
          method: loyaltyCode,
          amount: String(eur),
          loyaltyPoints: String(eurToRedeemPoints(eur)),
        },
      ];
    });
  }

  function addProduct(productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) =>
          l.key === existing.key
            ? {
                ...l,
                quantity: String((Number(l.quantity) || 0) + 1),
              }
            : l,
        );
      }
      const blankOnly =
        prev.length === 1 &&
        !prev[0]?.description &&
        !prev[0]?.unitPrice &&
        !prev[0]?.productId;
      const nextLine: Line = {
        key: `${Date.now()}`,
        productId: p.id,
        description: p.name,
        quantity: "1",
        unitPrice: String(p.price),
        vatRate: String(p.vatRate),
      };
      if (blankOnly) return [nextLine];
      return [...prev, nextLine];
    });
    setMessage(null);
    setError(null);
  }

  function addProductByCode(code: string) {
    const needle = code.trim().toLowerCase();
    const p = products.find(
      (x) =>
        x.barcode?.toLowerCase() === needle ||
        x.sku.toLowerCase() === needle,
    );
    if (!p) {
      return { ok: false as const, error: `Δεν βρέθηκε: ${code}` };
    }
    addProduct(p.id);
    return { ok: true as const };
  }

  async function checkout(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    setLastSale(null);

    const payloadTenders = tenders
      .filter((t) => {
        const kind = methodByCode.get(t.method)?.kind;
        return (
          kind === "GIFT_CARD" ||
          kind === "LOYALTY" ||
          kind === "CASH" ||
          Number(t.amount) > 0
        );
      })
      .map((t) => {
        let amount = Number(t.amount) || 0;
        const pm = methodByCode.get(t.method);
        if (
          (pm?.allowsChange || pm?.kind === "CASH") &&
          amount <= 0 &&
          payable.payableDue > 0
        ) {
          amount = payable.payableDue;
        }
        return {
          method: t.method,
          amount,
          giftCardCode: t.giftCardCode || null,
          loyaltyPoints: t.loyaltyPoints ? Number(t.loyaltyPoints) : null,
          externalRef: null as string | null,
        };
      })
      .filter((t) => t.amount > 0);

    // Sync loyalty tender from loyaltyRedeemEur field
    const hasLoyalty = payloadTenders.some(
      (t) => methodByCode.get(t.method)?.kind === "LOYALTY",
    );
    if (!hasLoyalty && loyaltyApplied > 0) {
      const loyaltyCode =
        paymentMethods.find((m) => m.kind === "LOYALTY")?.code ?? "LOYALTY";
      payloadTenders.push({
        method: loyaltyCode,
        amount: loyaltyApplied,
        giftCardCode: null,
        loyaltyPoints: eurToRedeemPoints(loyaltyApplied),
        externalRef: null,
      });
    }

    const res = await fetch("/api/pos/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        seriesId: seriesId || null,
        sessionId,
        terminalId: terminalId || null,
        customerId,
        discount: Number(discount) || 0,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            productId: l.productId || null,
            description: l.description.trim(),
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            vatRate: Number(l.vatRate),
          })),
        tenders: payloadTenders,
      }),
    });
    const data = (await res.json()) as {
      item?: {
        invoiceId: string;
        number: string;
        change: number;
      };
      error?: string;
    };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία ολοκλήρωσης");
      return;
    }
    setLastSale({
      invoiceId: data.item!.invoiceId,
      number: data.item!.number,
      change: data.item!.change,
    });
    setMessage(`Πώληση ${data.item!.number} ολοκληρώθηκε`);
    setLines([newLine()]);
    setTenders([
      {
        key: "cash",
        method: defaultCashCode,
        amount: "",
      },
    ]);
    setDiscount("0");
    setGiftCode("");
    setGiftBalance(null);
    setShowGiftEntry(false);
    setLoyaltyRedeemEur("0");
    // refresh loyalty
    if (customerId) {
      const lr = await fetch(
        `/api/pos/lookup?customerId=${encodeURIComponent(customerId)}`,
      );
      const ld = (await lr.json()) as {
        loyalty?: { pointsBalance: number; maxRedeemEur: number };
      };
      setLoyalty(ld.loyalty ?? null);
    }
  }

  const siteTerminals = terminals;

  return (
    <div className="space-y-5">
      <PageHeader
        title="POS Λιανικής"
        description="Καλάθι · πολλαπλοί τρόποι πληρωμής · αυτόματο πληρωτέο"
        actions={
          <div className="flex flex-wrap gap-2">
            {sessionId ? (
              <Badge tone="emerald">Βάρδια ανοιχτή</Badge>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void openSession()}>
                Άνοιγμα βάρδιας
              </Button>
            )}
            <Link
              href="/settings/series"
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm text-ink-900 hover:bg-slate-50"
            >
              Σειρές ΑΠΥ
            </Link>
          </div>
        }
      />

      <form onSubmit={checkout} className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <section className="soft-panel space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Ταμείο *</span>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 px-3"
                  required
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <SeriesPicker
                kind="RETAIL_RECEIPT"
                value={seriesId}
                onChange={setSeriesId}
                label="Σειρά ΑΠΥ *"
                className="block"
              />
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1.5 block font-medium">Πελάτης *</span>
                <select
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    setLoyalty(null);
                    setLoyaltyRedeemEur("0");
                  }}
                  className="h-11 w-full rounded-xl border border-slate-200 px-3"
                  required
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1.5 block font-medium">Τερματικό κάρτας</span>
                <select
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 px-3"
                >
                  <option value="">— Χωρίς / MOCK —</option>
                  {siteTerminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.name} ({t.provider})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="soft-panel space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Καλάθι</h2>
              <div className="flex flex-wrap gap-2">
                <select
                  className="h-9 rounded-xl border border-slate-200 px-2 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addProduct(e.target.value);
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="">+ Προϊόν καταλόγου</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setLines((prev) => [...prev, newLine()])}
                >
                  <Plus size={14} />
                  Γραμμή
                </Button>
              </div>
            </div>
            <PosBarcodeScan onScan={addProductByCode} />
            <div className="hidden gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-[1fr_4.5rem_6rem_4rem_auto]">
              <span>Περιγραφή</span>
              <span>Ποσ.</span>
              <span>Τιμή</span>
              <span>ΦΠΑ %</span>
              <span className="text-right">Σύνολο</span>
            </div>
            <ul className="space-y-2">
              {lines.map((line) => {
                const { lineTotal } = calcLineTotals({
                  quantity: Number(line.quantity) || 0,
                  unitPrice: Number(line.unitPrice) || 0,
                  vatRate: Number(line.vatRate) || 0,
                });
                return (
                  <li
                    key={line.key}
                    className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/50 p-2 sm:grid-cols-[1fr_4.5rem_6rem_4rem_auto] sm:items-end"
                  >
                    <label className="block min-w-0">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">
                        Περιγραφή
                      </span>
                      <input
                        required
                        value={line.description}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, description: e.target.value }
                                : l,
                            ),
                          )
                        }
                        placeholder="Περιγραφή"
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">
                        Ποσότητα
                      </span>
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, quantity: e.target.value }
                                : l,
                            ),
                          )
                        }
                        aria-label="Ποσότητα"
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">
                        Τιμή €
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, unitPrice: e.target.value }
                                : l,
                            ),
                          )
                        }
                        aria-label="Τιμή"
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">
                        ΦΠΑ %
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={line.vatRate}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, vatRate: e.target.value }
                                : l,
                            ),
                          )
                        }
                        aria-label="ΦΠΑ %"
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
                      />
                    </label>
                    <div className="flex items-end justify-between gap-2 sm:pb-0">
                      <div>
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">
                          Σύνολο
                        </span>
                        <span className="block text-sm font-medium tabular-nums">
                          {formatEUR(lineTotal)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setLines((prev) =>
                            prev.length <= 1
                              ? prev
                              : prev.filter((l) => l.key !== line.key),
                          )
                        }
                        className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-rose-600"
                        aria-label="Διαγραφή γραμμής"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <section className="soft-panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">Πληρωμή</h2>
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Σύνολο πώλησης</span>
                <span className="tabular-nums">{formatEUR(payable.saleTotal)}</span>
              </div>
              <label className="mt-2 flex items-center justify-between gap-2">
                <span className="text-slate-600">Έκπτωση €</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-right text-sm"
                />
              </label>
              <div className="mt-2 flex justify-between border-t border-slate-200/80 pt-2 font-medium text-ink-900">
                <span>Προς πληρωμή</span>
                <span className="tabular-nums">
                  {formatEUR(payable.afterDiscount)}
                </span>
              </div>
              {payable.giftCardApplied > 0 ? (
                <div className="mt-1.5 flex justify-between text-slate-600">
                  <span>Κάλυψη δωροκάρτας</span>
                  <span className="tabular-nums">
                    −{formatEUR(payable.giftCardApplied)}
                  </span>
                </div>
              ) : null}
              {payable.loyaltyAppliedEur > 0 ? (
                <div className="mt-1 flex justify-between text-slate-600">
                  <span>Κάλυψη loyalty</span>
                  <span className="tabular-nums">
                    −{formatEUR(payable.loyaltyAppliedEur)}
                  </span>
                </div>
              ) : null}
              <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-ink-950">
                <span>Υπόλοιπο (μετρητά/κάρτα)</span>
                <span className="tabular-nums text-teal-800">
                  {formatEUR(payable.payableDue)}
                </span>
              </div>
              {coverLines.some((t) => t.amount > 0) ? (
                <div className="mt-2 space-y-1 border-t border-dashed border-slate-200 pt-2 text-xs text-slate-500">
                  <div className="flex justify-between">
                    <span>Δηλωμένα ποσά</span>
                    <span className="tabular-nums">
                      {formatEUR(
                        coverLines.reduce((s, t) => s + t.amount, 0),
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Απομένει</span>
                    <span
                      className={cn(
                        "tabular-nums font-medium",
                        remainingDue > 0 ? "text-amber-700" : "text-emerald-700",
                      )}
                    >
                      {formatEUR(remainingDue)}
                    </span>
                  </div>
                  {changePreview > 0 ? (
                    <div className="flex justify-between text-teal-800">
                      <span>Ρέστα</span>
                      <span className="tabular-nums font-medium">
                        {formatEUR(changePreview)}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 rounded-xl border border-slate-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Star size={13} /> Loyalty
              </p>
              {loyalty ? (
                <>
                  <p className="text-xs text-slate-600">
                    {loyalty.pointsBalance} πόντοι · έως{" "}
                    {formatEUR(loyalty.maxRedeemEur)}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      max={loyalty.maxRedeemEur}
                      value={loyaltyRedeemEur}
                      onChange={(e) => setLoyaltyRedeemEur(e.target.value)}
                      className="h-10 w-28 rounded-lg border border-slate-200 px-2 text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={applyLoyalty}
                    >
                      Εξαργύρωση €
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Δεν υπάρχει λογαριασμός για τον πελάτη
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Wallet size={13} /> Τρόποι πληρωμής
                </p>
                <Link
                  href="/settings/payment-methods"
                  className="text-[11px] text-teal-700 hover:underline"
                >
                  Ρυθμίσεις
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {posGridMethods.map((pm) => {
                  const Icon = paymentMethodIcon[pm.kind] ?? MoreHorizontal;
                  const active =
                    pm.kind === "GIFT_CARD"
                      ? showGiftEntry ||
                        tenders.some(
                          (t) =>
                            methodByCode.get(t.method)?.kind === "GIFT_CARD",
                        )
                      : tenders.some((t) => t.method === pm.code);
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => pickPaymentMethod(pm)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center text-xs font-medium transition",
                        active
                          ? "border-teal-300 bg-teal-50 text-teal-900"
                          : "border-slate-200 bg-white text-slate-700 hover:border-teal-200 hover:bg-teal-50/40",
                      )}
                    >
                      <Icon
                        size={18}
                        className={active ? "text-teal-700" : "text-slate-400"}
                      />
                      {pm.name}
                    </button>
                  );
                })}
              </div>

              {showGiftEntry ||
              tenders.some(
                (t) => methodByCode.get(t.method)?.kind === "GIFT_CARD",
              ) ? (
                <div className="space-y-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-teal-800">
                    <Gift size={13} /> Κωδικός δωροκάρτας
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={giftCode}
                      onChange={(e) => setGiftCode(e.target.value)}
                      placeholder="π.χ. GIFT-100"
                      autoFocus={showGiftEntry}
                      className="h-10 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void lookupGift()}
                    >
                      Εφαρμογή
                    </Button>
                  </div>
                  {giftBalance != null ? (
                    <p className="text-xs text-emerald-700">
                      Υπόλοιπο {formatEUR(giftBalance)}
                      {giftApplied > 0
                        ? ` · εφαρμόστηκε ${formatEUR(giftApplied)}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Ανάλυση είσπραξης
                </p>
                {tenders
                  .filter(
                    (t) => methodByCode.get(t.method)?.kind !== "LOYALTY",
                  )
                  .map((t) => {
                    const pm = methodByCode.get(t.method);
                    const kind = pm?.kind;
                    const isGift = kind === "GIFT_CARD";
                    return (
                      <div
                        key={t.key}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-2.5 py-2",
                          isGift
                            ? "border-teal-100 bg-teal-50/30"
                            : "border-slate-100 bg-white",
                        )}
                      >
                        <span className="w-28 shrink-0 text-xs font-medium text-slate-700">
                          {pm?.name ?? t.method}
                          {isGift && t.giftCardCode
                            ? ` · ${t.giftCardCode}`
                            : ""}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required={!isGift && payable.payableDue > 0}
                          value={t.amount}
                          onChange={(e) =>
                            setTenders((prev) =>
                              prev.map((x) =>
                                x.key === t.key
                                  ? { ...x, amount: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                        />
                        <button
                          type="button"
                          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                          aria-label="Αφαίρεση"
                          onClick={() => {
                            const removingGift = isGift;
                            setTenders((prev) => {
                              const next = prev.filter((x) => x.key !== t.key);
                              return next.length
                                ? next
                                : [
                                    {
                                      key: "cash",
                                      method: defaultCashCode,
                                      amount:
                                        payable.payableDue > 0
                                          ? String(payable.payableDue)
                                          : "",
                                    },
                                  ];
                            });
                            if (removingGift) {
                              setGiftBalance(null);
                              setShowGiftEntry(false);
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    );
                  })}
              </div>

              {showAddMethod ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-ink-900">
                      Επιλέξτε επιπλέον τρόπο
                    </p>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-ink-900"
                      onClick={() => setShowAddMethod(false)}
                    >
                      Ακύρωση
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Θα προστεθεί με ποσό{" "}
                    <span className="font-medium text-ink-800">
                      {formatEUR(remainingDue)}
                    </span>{" "}
                    (υπόλοιπο προς κάλυψη).
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {coverMethodOptions.map((pm) => {
                      const Icon = paymentMethodIcon[pm.kind] ?? MoreHorizontal;
                      return (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => addCoverTender(pm, "append")}
                          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs font-medium text-slate-700 transition hover:border-teal-200 hover:bg-teal-50/50"
                        >
                          <Icon size={16} className="shrink-0 text-slate-400" />
                          {pm.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={remainingDue <= 0 && coverLines.length > 0}
                  onClick={() => setShowAddMethod(true)}
                >
                  <Plus size={15} />
                  Επιπλέον τρόπος
                  {remainingDue > 0 ? ` · ${formatEUR(remainingDue)}` : ""}
                </Button>
              )}
            </div>

            {error ? (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {message}
                {lastSale ? (
                  <>
                    {" · "}
                    <Link
                      href={`/invoices/${lastSale.invoiceId}`}
                      className="font-medium underline"
                    >
                      {lastSale.number}
                    </Link>
                    {lastSale.change > 0
                      ? ` · ρέστα ${formatEUR(lastSale.change)}`
                      : ""}
                  </>
                ) : null}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={pending || !seriesId || !customerId}
            >
              {pending
                ? "Ολοκλήρωση..."
                : remainingDue > 0
                  ? `Είσπραξη υπόλοιπου ${formatEUR(remainingDue)}`
                  : changePreview > 0
                    ? `Ολοκλήρωση · ρέστα ${formatEUR(changePreview)}`
                    : "Ολοκλήρωση πώλησης"}
            </Button>
          </section>
        </div>
      </form>
    </div>
  );
}
