"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
  total: number;
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

const PO_STATUS: Record<string, string> = {
  ORDERED: "Παραγγελία",
  PARTIAL: "Μερική",
  RECEIVED: "Παραληφθείσα",
};

export function FinanceOpsClient({
  arRows,
  apRows,
  vat,
  myData,
  canWrite,
}: {
  arRows: ArRow[];
  apRows: ApRow[];
  vat: VatSummary;
  myData: MyDataRow[];
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<"ar" | "ap" | "vat" | "mydata">("ar");
  const [rows, setRows] = useState(myData);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const arTotal = useMemo(
    () => arRows.reduce((s, r) => s + r.balance, 0),
    [arRows],
  );
  const apTotal = useMemo(
    () => apRows.reduce((s, r) => s + r.total, 0),
    [apRows],
  );

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {(
          [
            ["ar", `Απαιτήσεις (AR) · ${money(arTotal)}`],
            ["ap", `Υποχρεώσεις (AP) · ${money(apTotal)}`],
            ["vat", "ΦΠΑ περιόδου"],
            ["mydata", `myDATA · ${rows.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === key
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {tab === "ar" ? (
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
              {arRows.map((r) => (
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
              {arRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Καμία ανοιχτή απαίτηση.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "ap" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
            Βάση: ανοιχτές παραγγελίες αγοράς (τιμολόγια αγοράς σε επόμενη φάση).
          </p>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">PO</th>
                <th className="px-3 py-2">Προμηθευτής</th>
                <th className="px-3 py-2">Κατάσταση</th>
                <th className="px-3 py-2 text-right">Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              {apRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs font-semibold">
                    <Link href="/purchasing" className="text-sky-700 hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.supplier.name}</td>
                  <td className="px-3 py-2 text-xs">
                    {PO_STATUS[r.status] ?? r.status}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {money(r.total)}
                  </td>
                </tr>
              ))}
              {apRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Καμία ανοιχτή υποχρέωση αγοράς.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
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

      {tab === "mydata" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
            Τοπικός simulator — ενεργοποιείται όταν η σειρά έχει myDATA ON.
            Πραγματικό AADE client σε επόμενη φάση.
          </p>
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
              {rows.map((r) => (
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
                    {canWrite && r.status === "PENDING" ? (
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => processMyData(r.id)}
                        className="rounded-md bg-teal-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Διαβίβαση
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Καμία εγγραφή στην ουρά. Ενεργοποίησε myDATA στη σειρά
                    παραστατικού.
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
