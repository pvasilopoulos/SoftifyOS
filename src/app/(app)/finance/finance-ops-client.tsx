"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BankingPanel } from "./banking-panel";
import { toast } from "@/shared/ui/toaster";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { downloadCsvClient, rowsToCsv } from "@/shared/lib/csv";

type ArRow = {
  id: string;
  number: string;
  status: string;
  issuedAt: string | null;
  dueAt: string | null;
  total: number;
  paid: number;
  balance: number;
  daysPastDue: number;
  bucket: string;
  customer: { id: string; code: string; name: string };
};

type ApRow = {
  id: string;
  number: string;
  status: string;
  orderedAt: string;
  issueDate?: string;
  dueAt: string | null;
  total: number;
  paid: number;
  balance: number;
  daysPastDue: number;
  bucket: string;
  supplier: { id: string; code: string; name: string };
};

type VatSummary = {
  from: string;
  to: string;
  salesNet: number;
  salesVat: number;
  creditNet: number;
  creditVat: number;
  netVatPayable: number;
  documentCount: number;
  byRate: Array<{
    vatRate: number;
    net: number;
    vat: number;
    gross: number;
  }>;
};

type MyDataRow = {
  id: string;
  entityType: string;
  entityNumber: string | null;
  invoiceType: string | null;
  status: string;
  mark: string | null;
  createdAt: string;
};

function money(n: number) {
  return n.toLocaleString("el-GR", { style: "currency", currency: "EUR" });
}

type PurchaseInvoiceRow = {
  id: string;
  number: string;
  status: string;
  total: number;
  paidAmount: number;
  supplierId: string;
  supplierName: string;
  issueDate: string;
};

type PayMethod = {
  id: string;
  code: string;
  name: string;
  showInCollect?: boolean;
  isActive?: boolean;
  sortOrder?: number;
};

export function FinanceOpsClient({
  arRows,
  apRows,
  vat,
  myData,
  canWrite,
  forcedTab,
  hideTabBar,
  myDataEnv = "simulator",
  purchaseInvoices = [],
  filters,
}: {
  arRows: ArRow[];
  apRows: ApRow[];
  vat: VatSummary;
  myData: MyDataRow[];
  canWrite: boolean;
  forcedTab?: "ar" | "ap" | "vat" | "mydata" | "banking";
  hideTabBar?: boolean;
  myDataEnv?: "simulator" | "test" | "prod";
  purchaseInvoices?: PurchaseInvoiceRow[];
  filters?: {
    from: string;
    to: string;
    q: string;
    status: string;
    aging: string;
  };
}) {
  const [tab, setTab] = useState<"ar" | "ap" | "vat" | "mydata" | "banking">(
    forcedTab ?? "ar",
  );
  const [rows, setRows] = useState(myData);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localPurchases, setLocalPurchases] = useState(purchaseInvoices);
  const [payTarget, setPayTarget] = useState<PurchaseInvoiceRow | null>(null);
  const [payMethods, setPayMethods] = useState<PayMethod[]>([]);
  const [payMethodId, setPayMethodId] = useState("");
  const [payAmount, setPayAmount] = useState("");

  useEffect(() => {
    setLocalPurchases(purchaseInvoices);
  }, [purchaseInvoices]);

  useEffect(() => {
    if (forcedTab) setTab(forcedTab);
  }, [forcedTab]);

  useEffect(() => {
    setRows(myData);
  }, [myData]);

  const arTotal = useMemo(
    () => arRows.reduce((s, r) => s + r.balance, 0),
    [arRows],
  );
  const apTotal = useMemo(
    () => apRows.reduce((s, r) => s + r.balance, 0),
    [apRows],
  );

  const filteredAr = useMemo(() => {
    const q = filters?.q?.trim().toLowerCase() ?? "";
    const aging = filters?.aging ?? "ALL";
    return arRows.filter((r) => {
      if (aging !== "ALL" && r.bucket !== aging) return false;
      // Period filter on issue date (not due) so open AR stays meaningful.
      const issued = r.issuedAt?.slice(0, 10);
      if (filters?.from && issued && issued < filters.from) return false;
      if (filters?.to && issued && issued > filters.to) return false;
      if (!q) return true;
      return (
        r.number.toLowerCase().includes(q) ||
        r.customer.name.toLowerCase().includes(q) ||
        r.customer.code.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      );
    });
  }, [arRows, filters]);

  const filteredAp = useMemo(() => {
    const q = filters?.q?.trim().toLowerCase() ?? "";
    const aging = filters?.aging ?? "ALL";
    return apRows.filter((r) => {
      if (aging !== "ALL" && r.bucket !== aging) return false;
      const issued = (r.issueDate ?? r.orderedAt)?.slice(0, 10);
      if (filters?.from && issued && issued < filters.from) return false;
      if (filters?.to && issued && issued > filters.to) return false;
      if (!q) return true;
      return (
        r.number.toLowerCase().includes(q) ||
        r.supplier.name.toLowerCase().includes(q) ||
        r.supplier.code.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      );
    });
  }, [apRows, filters]);

  const filteredPurchases = useMemo(() => {
    const q = filters?.q?.trim().toLowerCase() ?? "";
    return localPurchases.filter((r) => {
      if (filters?.from && r.issueDate.slice(0, 10) < filters.from) return false;
      if (filters?.to && r.issueDate.slice(0, 10) > filters.to) return false;
      if (!q) return true;
      return (
        r.number.toLowerCase().includes(q) ||
        r.supplierName.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      );
    });
  }, [localPurchases, filters]);

  async function openPay(row: PurchaseInvoiceRow) {
    const balance = Math.max(0, Math.round((row.total - row.paidAmount) * 100) / 100);
    if (balance <= 0) return;
    setPayTarget(row);
    setPayAmount(String(balance));
    setError(null);
    const res = await fetch("/api/settings/payment-methods");
    const data = (await res.json()) as { items?: PayMethod[] };
    const items = (data.items ?? []).filter(
      (m) => m.isActive !== false && m.showInCollect !== false,
    );
    setPayMethods(items);
    setPayMethodId(items[0]?.id ?? "");
  }

  async function submitPay() {
    if (!payTarget) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !payMethodId) {
      setError("Συμπλήρωσε ποσό και τρόπο πληρωμής");
      return;
    }
    setBusyId(payTarget.id);
    setError(null);
    try {
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "PAYMENT",
          supplierId: payTarget.supplierId,
          purchaseInvoiceId: payTarget.id,
          methods: [{ paymentMethodId: payMethodId, amount }],
        }),
      });
      const data = (await res.json()) as {
        item?: { number: string };
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Αποτυχία πληρωμής");
        return;
      }
      toast.success(`Πληρωμή ${data.item?.number ?? ""}`);
      setLocalPurchases((prev) =>
        prev.map((p) => {
          if (p.id !== payTarget.id) return p;
          const paidAmount =
            Math.round((p.paidAmount + amount) * 100) / 100;
          const status =
            paidAmount + 0.001 >= p.total
              ? "PAID"
              : paidAmount > 0
                ? "PARTIAL"
                : p.status;
          return { ...p, paidAmount, status };
        }),
      );
      setPayTarget(null);
    } finally {
      setBusyId(null);
    }
  }

  const filteredMyData = useMemo(() => {
    const q = filters?.q?.trim().toLowerCase() ?? "";
    const st = filters?.status ?? "ALL";
    return rows.filter((r) => {
      if (st !== "ALL" && r.status !== st) return false;
      if (filters?.from && r.createdAt.slice(0, 10) < filters.from) return false;
      if (filters?.to && r.createdAt.slice(0, 10) > filters.to) return false;
      if (!q) return true;
      return (
        (r.entityNumber ?? "").toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        (r.mark ?? "").toLowerCase().includes(q) ||
        (r.invoiceType ?? "").toLowerCase().includes(q) ||
        r.entityType.toLowerCase().includes(q)
      );
    });
  }, [rows, filters]);

  const filteredArTotal = useMemo(
    () => filteredAr.reduce((s, r) => s + r.balance, 0),
    [filteredAr],
  );
  const filteredApTotal = useMemo(
    () => filteredAp.reduce((s, r) => s + r.balance, 0),
    [filteredAp],
  );
  const filteredPurchaseOpen = useMemo(
    () =>
      filteredPurchases.reduce(
        (s, r) => s + Math.max(0, r.total - r.paidAmount),
        0,
      ),
    [filteredPurchases],
  );

  async function previewMyData(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/preview`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία preview");
      const xml = data.item?.xml as string | undefined;
      if (!xml) throw new Error("Κενό XML");
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(
          `<pre style="white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;padding:16px">${xml
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</pre>`,
        );
        w.document.title = `myDATA XML · ${data.item?.entityNumber || id}`;
      } else {
        toast.success("Επίτρεψε pop-ups για προεπισκόπηση XML");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function processMyData(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/process`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status: data.item.status,
                mark: data.item.mark,
              }
            : r,
        ),
      );
      toast.success(`myDATA ${data.item?.status ?? "OK"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMyData(id: string) {
    if (!window.confirm("Ακύρωση δήλωσης στην ΑΑΔΕ (CancelInvoice);")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία ακύρωσης");
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, status: data.item?.status ?? "CANCELLED" }
            : r,
        ),
      );
      toast.success("Ακυρώθηκε στην ΑΑΔΕ / ουρά");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function processBatch() {
    setBusyId("batch");
    setError(null);
    try {
      const res = await fetch("/api/mydata/submissions/process-batch", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία batch");
      const map = new Map(
        (data.items as Array<{ id: string; status: string; mark: string | null }>).map(
          (i) => [i.id, i],
        ),
      );
      setRows((prev) =>
        prev.map((r) => {
          const next = map.get(r.id);
          return next
            ? { ...r, status: next.status, mark: next.mark }
            : r;
        }),
      );
      toast.success(`Επεξεργάστηκαν ${data.processed ?? 0} εγγραφές`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="soft-panel space-y-3 p-4">
      {!hideTabBar ? (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
          {(
            [
              ["ar", `Απαιτήσεις (AR) · ${money(arTotal)}`],
              ["ap", `Υποχρεώσεις (AP) · ${money(apTotal)}`],
              ["vat", "ΦΠΑ περιόδου"],
              ["banking", "Τράπεζες"],
              ["mydata", `myDATA · ${rows.length}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium ${
                tab === key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <div>
          <h2 className="text-base font-semibold text-ink-950">
            {tab === "ar"
              ? "Απαιτήσεις (AR)"
              : tab === "ap"
                ? "Υποχρεώσεις (AP)"
                : tab === "vat"
                  ? "ΦΠΑ περιόδου"
                  : tab === "banking"
                    ? "Τράπεζες"
                    : "myDATA / ΑΑΔΕ"}
          </h2>
          <p className="text-xs text-slate-500">
            {tab === "ar"
              ? `Εμφάνιση ${filteredAr.length}/${arRows.length} · υπόλοιπο ${money(filteredArTotal)}`
              : tab === "ap"
                ? `Aging ${filteredAp.length}/${apRows.length} · ${money(filteredApTotal)} · αγορές FI ${money(filteredPurchaseOpen)}`
                : tab === "mydata"
                  ? `Περιβάλλον: ${myDataEnv} · ${filteredMyData.length}/${rows.length} εγγραφές`
                  : tab === "vat"
                    ? "Σύνοψη ΦΠΑ χρήσης (server) — άλλαξε περίοδο στα φίλτρα για GL αναφορές"
                    : "Λειτουργική ενότητα"}
          </p>
        </div>
      )}

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {tab === "ar" ? (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              disabled={filteredAr.length === 0}
              onClick={() => {
                const rows: Array<Array<string | number>> = [
                  [
                    "number",
                    "customerCode",
                    "customerName",
                    "dueAt",
                    "bucket",
                    "balance",
                    "total",
                    "paid",
                  ],
                  ...filteredAr.map((r) => [
                    r.number,
                    r.customer.code,
                    r.customer.name,
                    r.dueAt ? new Date(r.dueAt).toISOString().slice(0, 10) : "",
                    r.bucket,
                    r.balance,
                    r.total,
                    r.paid,
                  ]),
                ];
                downloadCsvClient("ar-aging.csv", rowsToCsv(rows));
              }}
            >
              CSV
            </Button>
          </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Παραστατικό</th>
                <th className="px-3 py-2">Πελάτης</th>
                <th className="px-3 py-2">Λήξη</th>
                <th className="px-3 py-2">Aging</th>
                <th className="px-3 py-2 text-right">Υπόλοιπο</th>
              </tr>
            </thead>
            <tbody>
              {filteredAr.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link
                      href={`/invoices/${r.id}`}
                      className="font-mono text-xs font-semibold text-sky-700 hover:underline"
                    >
                      {r.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.customer.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {r.dueAt
                      ? new Date(r.dueAt).toLocaleDateString("el-GR")
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium">
                      {r.bucket}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {money(r.balance)}
                  </td>
                </tr>
              ))}
              {filteredAr.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Καμία απαίτηση με τα τρέχοντα φίλτρα.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </div>
      ) : null}

      {tab === "ap" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">
                AP aging (φίλτρο {filteredAp.length}/{apRows.length})
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {money(filteredApTotal)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">
                Αγορές FI λίστα ({filteredPurchases.length})
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {money(filteredPurchaseOpen)}
              </p>
            </div>
          </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={filteredAp.length === 0}
              onClick={() => {
                const rows: Array<Array<string | number>> = [
                  [
                    "number",
                    "supplierCode",
                    "supplierName",
                    "dueAt",
                    "bucket",
                    "balance",
                    "total",
                    "paid",
                  ],
                  ...filteredAp.map((r) => [
                    r.number,
                    r.supplier.code,
                    r.supplier.name,
                    r.dueAt ? new Date(r.dueAt).toISOString().slice(0, 10) : "",
                    r.bucket,
                    r.balance,
                    r.total,
                    r.paid,
                  ]),
                ];
                downloadCsvClient("ap-aging.csv", rowsToCsv(rows));
              }}
            >
              CSV
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Aging τιμολογίων αγοράς
            </p>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Αρ.</th>
                  <th className="px-3 py-2">Προμηθευτής</th>
                  <th className="px-3 py-2">Λήξη</th>
                  <th className="px-3 py-2">Aging</th>
                  <th className="px-3 py-2 text-right">Υπόλοιπο</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filteredAp.map((r) => {
                  const canPay =
                    canWrite &&
                    r.balance > 0 &&
                    r.status !== "DRAFT" &&
                    r.status !== "CANCELLED" &&
                    r.status !== "PAID";
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs font-semibold">
                        {r.number}
                      </td>
                      <td className="px-3 py-2">{r.supplier.name}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {r.dueAt
                          ? new Date(r.dueAt).toLocaleDateString("el-GR")
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium">
                          {r.bucket}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {money(r.balance)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canPay ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === r.id}
                            onClick={() =>
                              void openPay({
                                id: r.id,
                                number: r.number,
                                status: r.status,
                                total: r.total,
                                paidAmount: r.paid,
                                supplierId: r.supplier.id,
                                supplierName: r.supplier.name,
                                issueDate: r.issueDate ?? r.orderedAt,
                              })
                            }
                          >
                            Πληρωμή
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {filteredAp.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      {apRows.length === 0
                        ? "Καμία ανοιχτή υποχρέωση — δημιούργησε αγορές FI."
                        : "Καμία υποχρέωση με τα τρέχοντα φίλτρα."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {payTarget ? (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/40 p-4 sm:items-center">
              <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                <h3 className="text-lg font-semibold text-ink-950">
                  Πληρωμή {payTarget.number}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {payTarget.supplierName} · υπόλοιπο{" "}
                  {money(
                    Math.max(0, payTarget.total - payTarget.paidAmount),
                  )}
                </p>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">
                      Ποσό (€)
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">
                      Τρόπος πληρωμής
                    </span>
                    <select
                      value={payMethodId}
                      onChange={(e) => setPayMethodId(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    >
                      {payMethods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.code})
                        </option>
                      ))}
                    </select>
                  </label>
                  {error ? (
                    <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {error}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      disabled={busyId === payTarget.id}
                      onClick={() => void submitPay()}
                    >
                      {busyId === payTarget.id ? "..." : "Καταχώρηση"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setPayTarget(null)}
                    >
                      Ακύρωση
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "vat" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ["Πωλήσεις καθαρή", vat.salesNet],
                ["ΦΠΑ πωλήσεων", vat.salesVat],
                ["ΦΠΑ πιστωτικών", vat.creditVat],
                ["Καθαρός ΦΠΑ", vat.netVatPayable],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {money(value)}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Περίοδος{" "}
            {new Date(vat.from).toLocaleDateString("el-GR")} –{" "}
            {new Date(vat.to).toLocaleDateString("el-GR")} · {vat.documentCount}{" "}
            παραστατικά
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Συντελεστής</th>
                  <th className="px-3 py-2 text-right">Καθαρή</th>
                  <th className="px-3 py-2 text-right">ΦΠΑ</th>
                  <th className="px-3 py-2 text-right">Μικτή</th>
                </tr>
              </thead>
              <tbody>
                {vat.byRate.map((r) => (
                  <tr key={r.vatRate} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{r.vatRate}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.net)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.vat)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.gross)}
                    </td>
                  </tr>
                ))}
                {vat.byRate.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Δεν υπάρχουν εκδομένα παραστατικά στην περίοδο.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "banking" ? (
        <BankingPanel
          canWrite={canWrite}
          openInvoices={arRows.map((r) => ({
            id: r.id,
            number: r.number,
            balance: r.balance,
            customer: r.customer.name,
          }))}
          openPurchases={(purchaseInvoices.length
            ? purchaseInvoices
                .filter((p) => p.status === "POSTED" || p.status === "PARTIAL")
                .map((p) => ({
                  id: p.id,
                  number: p.number,
                  balance: Math.max(0, p.total - p.paidAmount),
                  supplier: p.supplierName,
                }))
                .filter((p) => p.balance > 0)
            : apRows.map((r) => ({
                id: r.id,
                number: r.number,
                balance: r.balance,
                supplier: r.supplier.name,
              }))
          ).filter((p) => p.balance > 0)}
        />
      ) : null}

      {tab === "mydata" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <div className="text-xs text-slate-600">
              <p>
                Περιβάλλον:{" "}
                <span className="font-semibold text-ink-900">{myDataEnv}</span>
                {myDataEnv === "simulator"
                  ? " · τοπικό MARK"
                  : " · live AADE SendInvoices"}
              </p>
              <p className="text-slate-500">
                Περιβάλλον / πάροχος e-invoicing:{" "}
                <Link
                  href="/settings/integrations"
                  className="text-teal-700 hover:underline"
                >
                  Ρυθμίσεις → Integrations → myDATA
                </Link>
              </p>
            </div>
            {canWrite ? (
              <Button
                size="sm"
                disabled={busyId === "batch"}
                onClick={() => void processBatch()}
              >
                Επεξεργασία ουράς
              </Button>
            ) : null}
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Οντότητα</th>
                <th className="px-3 py-2">Τύπος</th>
                <th className="px-3 py-2">Κατάσταση</th>
                <th className="px-3 py-2">MARK</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredMyData.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs font-semibold">
                      {r.entityNumber || r.id.slice(0, 8)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {r.entityType}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.invoiceType || "—"}</td>
                  <td className="px-3 py-2 text-xs font-medium">{r.status}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                    {r.mark || "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite &&
                      (r.status === "PENDING" ||
                        r.status === "SENT" ||
                        r.status === "REJECTED") ? (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => processMyData(r.id)}
                          className="rounded-md bg-teal-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                        >
                          Διαβίβαση
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void previewMyData(r.id)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                      >
                        XML
                      </button>
                      {canWrite && r.status === "ACCEPTED" && r.mark ? (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void cancelMyData(r.id)}
                          className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 disabled:opacity-50"
                        >
                          Ακύρωση ΑΑΔΕ
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredMyData.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    {rows.length === 0
                      ? "Καμία εγγραφή στην ουρά. Ενεργοποίησε myDATA στη σειρά παραστατικού."
                      : "Καμία εγγραφή με τα τρέχοντα φίλτρα."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
