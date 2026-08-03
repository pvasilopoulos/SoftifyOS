"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Wallet, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  calcInvoiceTotals,
  calcLineTotals,
  formatEUR,
} from "@/modules/sales/invoice-utils";
import { SeriesPicker } from "@/modules/documents/series-picker";
import { invoiceKindLabel } from "@/modules/documents/series";
import { maybeAutoPrintAfterIssue, preparePrintWindow } from "@/modules/print-forms/open-invoice-print";

export type InvoiceDocKind = "SALES_INVOICE" | "SALES_CREDIT" | "RETAIL_RECEIPT";

type CustomerOption = { id: string; code: string; name: string };
type BranchOption = {
  id: string;
  code: string;
  name: string;
  spaces: Array<{ id: string; code: string; name: string }>;
};
type LineDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};
type PayMethod = {
  id: string;
  code: string;
  name: string;
  kind: string;
  isDefault?: boolean;
};
type TenderLine = {
  key: string;
  paymentMethodId: string;
  amount: string;
};

function newLine(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: "",
    quantity: "1",
    unitPrice: "",
    vatRate: "24",
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function NewInvoiceForm({ kind }: { kind: InvoiceDocKind }) {
  const router = useRouter();
  const kindTitle = invoiceKindLabel[kind];

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [statusOptionId, setStatusOptionId] = useState("");
  const [statusOptions, setStatusOptions] = useState<
    Array<{ id: string; code: string; name: string; workflow: string }>
  >([]);
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);
  const [settleNow, setSettleNow] = useState(kind === "RETAIL_RECEIPT");
  const [payMethods, setPayMethods] = useState<PayMethod[]>([]);
  const [loadingPay, setLoadingPay] = useState(false);
  const [tenders, setTenders] = useState<TenderLine[]>([]);

  const selectedStatus = useMemo(
    () => statusOptions.find((s) => s.id === statusOptionId) ?? null,
    [statusOptions, statusOptionId],
  );
  const issuesNow =
    selectedStatus?.workflow === "ISSUED" ||
    (settleNow && kind !== "SALES_CREDIT");
  const canSettle = kind !== "SALES_CREDIT";

  useEffect(() => {
    setSettleNow(kind === "RETAIL_RECEIPT");
    setTenders([]);
  }, [kind]);

  useEffect(() => {
    if (!seriesId || !canSettle) {
      setPayMethods([]);
      setTenders([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPay(true);
      try {
        const res = await fetch(
          `/api/settings/payment-methods?seriesId=${encodeURIComponent(seriesId)}&collect=1`,
        );
        const data = (await res.json()) as {
          items?: PayMethod[];
          error?: string;
        };
        if (cancelled) return;
        const items = data.items ?? [];
        setPayMethods(items);
        const preferred =
          items.find((m) => m.isDefault)?.id ?? items[0]?.id ?? "";
        setTenders((prev) => {
          if (!preferred) return [];
          if (prev.length && items.some((m) => m.id === prev[0]?.paymentMethodId)) {
            return prev;
          }
          return [
            {
              key: "t0",
              paymentMethodId: preferred,
              amount: "",
            },
          ];
        });
      } catch {
        if (!cancelled) setPayMethods([]);
      } finally {
        if (!cancelled) setLoadingPay(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seriesId, canSettle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      try {
        const [custRes, statusRes] = await Promise.all([
          fetch("/api/customers?limit=50&status=ACTIVE"),
          fetch("/api/settings/invoice-statuses?selectableOnCreate=1"),
        ]);
        const custData = (await custRes.json()) as {
          items?: CustomerOption[];
          error?: string;
        };
        const statusData = (await statusRes.json()) as {
          items?: Array<{
            id: string;
            code: string;
            name: string;
            workflow: string;
          }>;
        };
        if (!cancelled) {
          setCustomers(custData.items ?? []);
          const opts = statusData.items ?? [];
          setStatusOptions(opts);
          const draft =
            opts.find((o) => o.code === "DRAFT") ??
            opts.find((o) => o.workflow === "DRAFT") ??
            opts[0];
          if (draft) setStatusOptionId(draft.id);
          if (!custRes.ok) setError(custData.error || "Αποτυχία φόρτωσης πελατών");
        }
      } catch {
        if (!cancelled) setError("Αποτυχία φόρτωσης πελατών");
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      setLoadingHierarchy(true);
      try {
        const res = await fetch(`/api/customers/${customerId}`);
        const data = (await res.json()) as {
          item?: { branches: BranchOption[] };
          error?: string;
        };
        if (!cancelled) {
          setBranches(data.item?.branches ?? []);
          if (!res.ok) setError(data.error || "Αποτυχία φόρτωσης υποκαταστημάτων");
        }
      } catch {
        if (!cancelled) setError("Αποτυχία φόρτωσης υποκαταστημάτων");
      } finally {
        if (!cancelled) setLoadingHierarchy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const spaces = useMemo(() => {
    const branch = branches.find((b) => b.id === branchId);
    return branch?.spaces ?? [];
  }, [branches, branchId]);

  const totals = useMemo(() => {
    const parsed = lines.map((line) => ({
      quantity: Number(line.quantity) || 0,
      unitPrice: Number(line.unitPrice) || 0,
      vatRate: Number(line.vatRate) || 0,
    }));
    return calcInvoiceTotals(parsed);
  }, [lines]);

  const tenderPaid = useMemo(() => {
    return round2(
      tenders.reduce((s, t) => {
        const n = Number(t.amount);
        return s + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    );
  }, [tenders]);
  const tenderRemaining = round2(Math.max(0, totals.total - tenderPaid));

  // Keep first tender filled with remaining when settle is on and amount empty
  useEffect(() => {
    if (!settleNow || !canSettle || totals.total <= 0) return;
    setTenders((prev) => {
      if (prev.length !== 1) return prev;
      const only = prev[0]!;
      if (only.amount.trim() !== "") return prev;
      return [{ ...only, amount: String(totals.total) }];
    });
  }, [settleNow, canSettle, totals.total]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    if (!customerId) {
      setError("Επιλέξτε πελάτη");
      setPending(false);
      return;
    }
    if (!seriesId) {
      setError("Επιλέξτε σειρά παραστατικού");
      setPending(false);
      return;
    }

    const settlePayload =
      settleNow && canSettle
        ? tenders
            .map((t) => ({
              paymentMethodId: t.paymentMethodId,
              amount: Number(t.amount),
            }))
            .filter(
              (t) =>
                t.paymentMethodId &&
                Number.isFinite(t.amount) &&
                t.amount > 0,
            )
        : [];

    if (settleNow && canSettle) {
      if (settlePayload.length === 0) {
        setError("Επιλέξτε τρόπο πληρωμής και ποσό");
        setPending(false);
        return;
      }
      if (round2(settlePayload.reduce((s, m) => s + m.amount, 0)) > totals.total + 0.001) {
        setError("Το ποσό εξόφλησης υπερβαίνει το σύνολο");
        setPending(false);
        return;
      }
    }

    const willIssue =
      issuesNow || settlePayload.length > 0;
    const printWin = willIssue ? preparePrintWindow() : null;
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        branchId: branchId || null,
        spaceId: spaceId || null,
        seriesId,
        kind,
        statusOptionId: statusOptionId || null,
        dueAt: dueAt || null,
        notes: notes.trim() || null,
        lines: lines.map((line) => ({
          description: line.description.trim(),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          vatRate: Number(line.vatRate),
        })),
        ...(settlePayload.length ? { settleMethods: settlePayload } : {}),
      }),
    });
    const data = (await res.json()) as {
      item?: {
        id: string;
        status?: string;
        series?: {
          printPrinter?: string | null;
          printCopies?: number | null;
        } | null;
        autoSettle?: {
          settlementNumber?: string;
          paymentMethodCode?: string;
        } | null;
      };
      error?: string;
      warning?: string;
    };
    setPending(false);
    if (!res.ok) {
      printWin?.close();
      setError(data.error || "Αποτυχία δημιουργίας");
      return;
    }
    if (data.warning) setError(data.warning);
    const created = data.item!;
    if (created.status === "ISSUED" || willIssue || settlePayload.length) {
      maybeAutoPrintAfterIssue(created.id, created.series, printWin);
    } else {
      printWin?.close();
    }
    router.push(`/invoices/${created.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Πίσω στα παραστατικά
      </Link>
      <PageHeader
        title={`Νέο ${kindTitle.toLowerCase()}`}
        description="Σειρά, πελάτης, γραμμές — και προαιρετικά εξόφληση όπως στο POS."
      />

      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["SALES_INVOICE", "Τιμολόγιο"],
            ["SALES_CREDIT", "Πιστωτικό"],
            ["RETAIL_RECEIPT", "ΑΠΥ"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={k === "SALES_INVOICE" ? "/invoices/new" : `/invoices/new?kind=${k}`}
            className={
              kind === k
                ? "rounded-xl bg-teal-600 px-3 py-1.5 font-medium text-white"
                : "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            }
          >
            {label}
          </Link>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <section className="soft-panel space-y-4 p-5">
          <h2 className="text-sm font-semibold text-ink-900">Στοιχεία</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <SeriesPicker
              key={kind}
              kind={kind}
              value={seriesId}
              onChange={setSeriesId}
            />

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Πελάτης *</span>
              <select
                required
                value={customerId}
                disabled={loadingCustomers}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setBranches([]);
                  setBranchId("");
                  setSpaceId("");
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              >
                <option value="">
                  {loadingCustomers ? "Φόρτωση..." : "Επιλέξτε πελάτη"}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Υποκατάστημα</span>
              <select
                value={branchId}
                disabled={!customerId || loadingHierarchy}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setSpaceId("");
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
              >
                <option value="">— Προαιρετικό —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Χώρος</span>
              <select
                value={spaceId}
                disabled={!branchId}
                onChange={(e) => setSpaceId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
              >
                <option value="">— Προαιρετικό —</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium">
                <span>Κατάσταση</span>
                <Link
                  href="/settings/invoice-statuses"
                  className="text-xs font-normal text-teal-700 hover:underline"
                >
                  Διαχείριση
                </Link>
              </span>
              <select
                value={statusOptionId}
                onChange={(e) => setStatusOptionId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              >
                {statusOptions.length === 0 ? (
                  <option value="">— Φόρτωση —</option>
                ) : null}
                {statusOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Ημ. λήξης</span>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Σημειώσεις</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
            </label>
          </div>
        </section>

        <section className="soft-panel space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-900">Γραμμές</h2>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              <Plus size={14} />
              Γραμμή
            </Button>
          </div>

          <div className="space-y-3">
            {lines.map((line, idx) => {
              const { lineTotal } = calcLineTotals({
                quantity: Number(line.quantity) || 0,
                unitPrice: Number(line.unitPrice) || 0,
                vatRate: Number(line.vatRate) || 0,
              });
              return (
                <div
                  key={line.key}
                  className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-12"
                >
                  <label className="block sm:col-span-5">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Περιγραφή {idx + 1} *
                    </span>
                    <input
                      required
                      value={line.description}
                      onChange={(e) =>
                        updateLine(line.key, { description: e.target.value })
                      }
                      placeholder="Υπηρεσία / προϊόν"
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Ποσότητα
                    </span>
                    <input
                      required
                      type="number"
                      min="0.001"
                      step="any"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.key, { quantity: e.target.value })
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Τιμή μονάδας
                    </span>
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) =>
                        updateLine(line.key, { unitPrice: e.target.value })
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    />
                  </label>
                  <label className="block sm:col-span-1">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      ΦΠΑ %
                    </span>
                    <input
                      required
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={line.vatRate}
                      onChange={(e) =>
                        updateLine(line.key, { vatRate: e.target.value })
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    />
                  </label>
                  <div className="flex items-end justify-between gap-2 sm:col-span-2">
                    <div>
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Σύνολο
                      </span>
                      <p className="h-10 content-center text-sm font-medium tabular-nums text-ink-900">
                        {formatEUR(lineTotal)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Διαγραφή γραμμής"
                      disabled={lines.length <= 1}
                      onClick={() => removeLine(line.key)}
                    >
                      <Trash2 size={16} className="text-slate-500" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-end gap-1 border-t border-slate-100 pt-4 text-sm">
            <div className="flex w-full max-w-xs justify-between text-slate-600">
              <span>Καθαρή αξία</span>
              <span className="tabular-nums">{formatEUR(totals.subtotal)}</span>
            </div>
            <div className="flex w-full max-w-xs justify-between text-slate-600">
              <span>ΦΠΑ</span>
              <span className="tabular-nums">{formatEUR(totals.vatAmount)}</span>
            </div>
            <div className="flex w-full max-w-xs justify-between text-base font-semibold text-ink-900">
              <span>Σύνολο</span>
              <span className="tabular-nums">{formatEUR(totals.total)}</span>
            </div>
          </div>
        </section>

        {canSettle ? (
          <section className="soft-panel space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Wallet size={16} className="text-teal-700" />
                  Τρόποι πληρωμής
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Όπως στο POS: αν ενεργοποιήσεις εξόφληση, το παραστατικό
                  εκδίδεται και εισπράττεται μαζί.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={settleNow}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSettleNow(on);
                    if (on && tenders.length === 1 && !tenders[0]?.amount) {
                      setTenders((prev) =>
                        prev.map((t, i) =>
                          i === 0
                            ? { ...t, amount: String(totals.total || "") }
                            : t,
                        ),
                      );
                    }
                  }}
                  className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                Εξόφληση τώρα
              </label>
            </div>

            {settleNow ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {loadingPay ? (
                    <p className="text-sm text-slate-500">Φόρτωση τρόπων…</p>
                  ) : payMethods.length === 0 ? (
                    <p className="text-sm text-amber-800">
                      Δεν υπάρχουν τρόποι εισπράξεων —{" "}
                      <Link
                        href="/settings/payment-methods"
                        className="font-medium text-teal-700 hover:underline"
                      >
                        Ρυθμίσεις → Τρόποι πληρωμής
                      </Link>
                    </p>
                  ) : (
                    payMethods.map((pm) => {
                      const active = tenders.some(
                        (t) => t.paymentMethodId === pm.id,
                      );
                      return (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => {
                            setTenders((prev) => {
                              if (prev.some((t) => t.paymentMethodId === pm.id)) {
                                return prev;
                              }
                              const rem = tenderRemaining > 0
                                ? tenderRemaining
                                : totals.total;
                              if (prev.length === 1 && !prev[0]?.amount) {
                                return [
                                  {
                                    key: prev[0]!.key,
                                    paymentMethodId: pm.id,
                                    amount: String(rem || totals.total || ""),
                                  },
                                ];
                              }
                              return [
                                ...prev,
                                {
                                  key: `t${Date.now()}`,
                                  paymentMethodId: pm.id,
                                  amount: String(rem > 0 ? rem : ""),
                                },
                              ];
                            });
                          }}
                          className={cn(
                            "rounded-xl border px-3 py-2 text-sm font-medium transition",
                            active
                              ? "border-teal-300 bg-teal-50 text-teal-900"
                              : "border-slate-200 bg-white text-slate-700 hover:border-teal-200",
                          )}
                        >
                          {pm.name}
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="space-y-2">
                  {tenders.map((line, idx) => (
                    <div
                      key={line.key}
                      className="grid grid-cols-[1fr_7rem_auto] gap-2"
                    >
                      <select
                        value={line.paymentMethodId}
                        onChange={(e) =>
                          setTenders((prev) =>
                            prev.map((t) =>
                              t.key === line.key
                                ? { ...t, paymentMethodId: e.target.value }
                                : t,
                            ),
                          )
                        }
                        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                      >
                        {payMethods.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.code})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={line.amount}
                        onChange={(e) =>
                          setTenders((prev) =>
                            prev.map((t) =>
                              t.key === line.key
                                ? { ...t, amount: e.target.value }
                                : t,
                            ),
                          )
                        }
                        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm tabular-nums"
                        aria-label={`Ποσό τρόπου ${idx + 1}`}
                      />
                      <button
                        type="button"
                        disabled={tenders.length <= 1}
                        onClick={() =>
                          setTenders((prev) =>
                            prev.filter((t) => t.key !== line.key),
                          )
                        }
                        className="rounded-xl px-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900 disabled:opacity-30"
                        aria-label="Αφαίρεση"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <button
                    type="button"
                    className="font-medium text-teal-700 hover:underline disabled:opacity-40"
                    disabled={
                      payMethods.length === 0 || tenderRemaining <= 0
                    }
                    onClick={() => {
                      const preferred =
                        payMethods.find((m) => m.isDefault)?.id ??
                        payMethods[0]?.id ??
                        "";
                      if (!preferred) return;
                      setTenders((prev) => [
                        ...prev,
                        {
                          key: `t${Date.now()}`,
                          paymentMethodId: preferred,
                          amount: String(tenderRemaining),
                        },
                      ]);
                    }}
                  >
                    + Προσθήκη τρόπου
                  </button>
                  <p>
                    Εισπρακτέα {formatEUR(tenderPaid)}
                    {tenderRemaining > 0.001
                      ? ` · υπόλοιπο ${formatEUR(tenderRemaining)}`
                      : " · πλήρες"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-500">
                Χωρίς εξόφληση τώρα το παραστατικό μένει ανοιχτό — είσπραξη
                αργότερα από την κάρτα ή με αυτόματη πολιτική σειράς.
              </p>
            )}
          </section>
        ) : null}

        {error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending || !seriesId}>
            {pending
              ? "Αποθήκευση..."
              : settleNow && canSettle
                ? `Έκδοση & εξόφληση`
                : issuesNow
                  ? `Έκδοση ${kindTitle.toLowerCase()}`
                  : "Αποθήκευση πρόχειρου"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/invoices")}
          >
            Ακύρωση
          </Button>
        </div>
      </form>
    </div>
  );
}
