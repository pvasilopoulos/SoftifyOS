"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { toast } from "@/shared/ui/toaster";
import { SettlementTenders } from "./settlement-tenders";

type SettlementRow = {
  id: string;
  number: string;
  kind: string;
  status: string;
  partyType: string;
  totalAmount: number;
  settledAt: string;
  reference: string | null;
  journalEntryId: string | null;
  customer: { id: string; name: string; code: string } | null;
  supplier: { id: string; name: string; code: string } | null;
  methods: Array<{ methodCode: string; amount: number }>;
  allocations: Array<{
    id: string;
    targetType: string;
    invoiceId: string | null;
    purchaseInvoiceId: string | null;
    amount: number;
    invoice?: { id: string; number: string } | null;
    purchaseInvoice?: { id: string; number: string } | null;
  }>;
};

type PendingClearing = {
  id: string;
  settlementId: string;
  settlementNumber: string;
  settledAt: string;
  customer: { id: string; name: string; code: string } | null;
  methodCode: string;
  amount: number;
  clearingGl: string;
  bankGl: string;
};

function money(n: number) {
  return n.toLocaleString("el-GR", { style: "currency", currency: "EUR" });
}

const KIND_LABEL: Record<string, string> = {
  RECEIPT: "Είσπραξη",
  PAYMENT: "Πληρωμή",
  CLEARING: "Εκκαθάριση",
};

type CashbookRow = {
  methodCode: string;
  receipts: number;
  payments: number;
  net: number;
  count: number;
};

export function SettlementsPanel({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<SettlementRow[]>([]);
  const [pending, setPending] = useState<PendingClearing[]>([]);
  const [kind, setKind] = useState<"ALL" | "RECEIPT" | "PAYMENT" | "CLEARING">(
    "ALL",
  );
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cashbook, setCashbook] = useState<{
    receiptTotal: number;
    paymentTotal: number;
    netTotal: number;
    rows: CashbookRow[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = kind === "ALL" ? "" : `?kind=${kind}`;
      const year = new Date().getFullYear();
      const [res, clrRes, cashRes] = await Promise.all([
        fetch(`/api/settlements${qs}`),
        fetch("/api/settlements?pendingClearing=1"),
        fetch(
          `/api/finance/reports?kind=cashbook&from=${year}-01-01&to=${year}-12-31`,
        ),
      ]);
      const data = (await res.json()) as {
        items?: SettlementRow[];
        error?: string;
      };
      const clr = (await clrRes.json()) as {
        items?: PendingClearing[];
      };
      const cash = (await cashRes.json()) as {
        receiptTotal?: number;
        paymentTotal?: number;
        netTotal?: number;
        rows?: CashbookRow[];
      };
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία φόρτωσης");
        return;
      }
      setItems(data.items ?? []);
      setPending(clr.items ?? []);
      if (cashRes.ok) {
        setCashbook({
          receiptTotal: cash.receiptTotal ?? 0,
          paymentTotal: cash.paymentTotal ?? 0,
          netTotal: cash.netTotal ?? 0,
          rows: cash.rows ?? [],
        });
      }
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function voidSettlement(id: string, number: string) {
    if (!window.confirm(`Ακύρωση εξόφλησης ${number};`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/settlements/${id}/void`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία ακύρωσης");
        return;
      }
      toast.success(`Ακυρώθηκε ${number}`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runClearing() {
    if (selected.size === 0) {
      toast.error("Επίλεξε τουλάχιστον μία γραμμή");
      return;
    }
    setBusyId("clearing");
    try {
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "CLEARING",
          sourceMethodLineIds: [...selected],
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        item?: { number: string };
      };
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία εκκαθάρισης");
        return;
      }
      toast.success(`Εκκαθάριση ${data.item?.number ?? ""}`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const pendingTotal = pending
    .filter((p) => selected.has(p.id))
    .reduce((s, p) => s + p.amount, 0);

  return (
    <section className="space-y-4">
      {pending.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink-950">
                Εκκρεμής εκκαθάριση καρτών (βήμα 2)
              </p>
              <p className="text-xs text-slate-600">
                {pending.length} γραμμές · Clearing → Τράπεζα/Ταμείο
              </p>
            </div>
            {canWrite ? (
              <Button
                size="sm"
                disabled={busyId === "clearing" || selected.size === 0}
                onClick={() => void runClearing()}
              >
                {busyId === "clearing"
                  ? "..."
                  : `Εκκαθάριση ${selected.size ? money(pendingTotal) : ""}`}
              </Button>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-lg border border-amber-100 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-amber-50/80 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2">Είσπραξη</th>
                  <th className="px-3 py-2">Πελάτης</th>
                  <th className="px-3 py-2">Τρόπος</th>
                  <th className="px-3 py-2">GL</th>
                  <th className="px-3 py-2 text-right">Ποσό</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                        disabled={!canWrite}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">
                      {p.settlementNumber}
                    </td>
                    <td className="px-3 py-2">{p.customer?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{p.methodCode}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                      {p.clearingGl} → {p.bankGl}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {money(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {cashbook ? (
        <div className="soft-panel space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-950">
              Ταμείο (YTD) · ανά τρόπο
            </h3>
            <p className="text-xs text-slate-500">
              Εισπράξεις {money(cashbook.receiptTotal)} · Πληρωμές{" "}
              {money(cashbook.paymentTotal)} · Καθαρό{" "}
              <span className="font-semibold text-ink-900">
                {money(cashbook.netTotal)}
              </span>
            </p>
          </div>
          {cashbook.rows.length === 0 ? (
            <p className="text-xs text-slate-500">Δεν υπάρχουν κινήσεις ακόμα.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cashbook.rows.map((r) => (
                <div
                  key={r.methodCode}
                  className="min-w-[8.5rem] rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {r.methodCode}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink-950">
                    {money(r.net)}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    +{money(r.receipts)} / −{money(r.payments)} · {r.count}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(
            [
              ["ALL", "Όλες"],
              ["RECEIPT", "Εισπράξεις"],
              ["PAYMENT", "Πληρωμές"],
              ["CLEARING", "Εκκαθαρίσεις"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={
                kind === k
                  ? "rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-sm"
                  : "rounded-lg px-3 py-1.5 text-xs text-slate-600"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          Ανανέωση
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Αρ.</th>
              <th className="px-3 py-2.5">Είδος</th>
              <th className="px-3 py-2.5">Αντισυμβαλλόμενος</th>
              <th className="min-w-[14rem] px-3 py-2.5">Ανάλυση τρόπων</th>
              <th className="px-3 py-2.5 text-right">Σύνολο</th>
              <th className="px-3 py-2.5">Κατάσταση</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((s) => {
              const party = s.customer?.name || s.supplier?.name || "—";
              return (
                <tr
                  key={s.id}
                  className="border-t border-slate-100 align-top transition-colors hover:bg-slate-50/60"
                >
                  <td className="px-3 py-3">
                    <p className="font-mono text-xs font-semibold text-ink-950">
                      {s.number}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {new Date(s.settledAt).toLocaleDateString("el-GR")}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">
                    {KIND_LABEL[s.kind] ?? s.kind}
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-sm font-medium text-ink-900">{party}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.allocations.slice(0, 4).map((a) => {
                        if (a.invoice?.number) {
                          return (
                            <Link
                              key={a.id}
                              href={`/invoices/${a.invoice.id}`}
                              className="rounded-md bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-800 hover:bg-teal-100"
                            >
                              {a.invoice.number}
                            </Link>
                          );
                        }
                        if (a.purchaseInvoice?.number) {
                          return (
                            <Link
                              key={a.id}
                              href="/finance?section=purchases"
                              className="rounded-md bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-900 hover:bg-amber-100"
                              title="Άνοιγμα αγορών"
                            >
                              {a.purchaseInvoice.number}
                            </Link>
                          );
                        }
                        return null;
                      })}
                      {s.allocations.length > 4 ? (
                        <span className="text-[10px] text-slate-400">
                          +{s.allocations.length - 4}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <SettlementTenders
                      methods={s.methods}
                      totalAmount={s.totalAmount}
                    />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <p className="text-sm font-semibold tabular-nums text-ink-950">
                      {money(s.totalAmount)}
                    </p>
                    {s.methods.length > 1 ? (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {s.methods.length} τρόποι
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={s.status === "POSTED" ? "emerald" : "rose"}>
                      {s.status === "POSTED" ? "Οριστική" : "Ακυρωμένη"}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {canWrite && s.status === "POSTED" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === s.id}
                        onClick={() => void voidSettlement(s.id, s.number)}
                      >
                        Ακύρωση
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!loading && items.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Δεν υπάρχουν εξοφλήσεις ακόμη.
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Φόρτωση…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
