"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "@/shared/ui/toaster";
import { Button } from "@/shared/ui/button";

type Account = { id: string; code: string; name: string; iban: string | null };
type Line = {
  id: string;
  bookedAt: string;
  amount: number;
  description: string;
  reference: string | null;
  status: string;
  matchedInvoiceId: string | null;
  bankAccount: { code: string; name: string };
};

type OpenInvoice = {
  id: string;
  number: string;
  balance: number;
  customer: string;
};

function money(n: number) {
  return n.toLocaleString("el-GR", { style: "currency", currency: "EUR" });
}

export function BankingPanel({
  openInvoices,
  canWrite,
}: {
  openInvoices: OpenInvoice[];
  canWrite: boolean;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [csv, setCsv] = useState(
    "2026-08-01,1200.50,Είσπραξη Αιγαίο,REF-1001\n2026-08-02,-340.00,Πληρωμή ΔΕΗ,UTIL-22",
  );
  const [pending, startTransition] = useTransition();

  async function load() {
    const [aRes, lRes] = await Promise.all([
      fetch("/api/banking/accounts", { cache: "no-store" }),
      fetch("/api/banking/statements", { cache: "no-store" }),
    ]);
    const aData = await aRes.json();
    const lData = await lRes.json();
    if (aRes.ok) {
      setAccounts(aData.items || []);
      if (!accountId && aData.items?.[0]) setAccountId(aData.items[0].id);
    }
    if (lRes.ok) setLines(lData.items || []);
  }

  useEffect(() => {
    void load();
  }, []);

  function importCsv() {
    if (!accountId) {
      toast.error("Επίλεξε λογαριασμό");
      return;
    }
    const parsed = csv
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => {
        const [bookedAt, amount, description, reference] = row
          .split(",")
          .map((p) => p.trim());
        return {
          bookedAt,
          amount: Number(amount),
          description: description || "Κίνηση",
          reference: reference || null,
        };
      })
      .filter((r) => r.bookedAt && Number.isFinite(r.amount));

    if (parsed.length === 0) {
      toast.error("Καμία έγκυρη γραμμή CSV");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/banking/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId: accountId, lines: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία import");
        return;
      }
      toast.success(`Εισήχθησαν ${data.imported} κινήσεις`);
      void load();
    });
  }

  function matchLine(lineId: string, invoiceId: string) {
    startTransition(async () => {
      const res = await fetch(`/api/banking/statements/${lineId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία match");
        return;
      }
      toast.success("Αντιστοιχίστηκε & καταχωρήθηκε είσπραξη");
      void load();
    });
  }

  return (
    <div className="space-y-4">
      <div className="soft-panel space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-slate-500">Λογαριασμός</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </label>
          {canWrite ? (
            <Button size="sm" disabled={pending} onClick={importCsv}>
              Import CSV
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Μορφή: ημερομηνία,ποσό,περιγραφή,αναφορά (μία γραμμή ανά κίνηση)
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={4}
          disabled={!canWrite}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-teal-300"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Ημ.</th>
              <th className="px-3 py-2">Περιγραφή</th>
              <th className="px-3 py-2 text-right">Ποσό</th>
              <th className="px-3 py-2">Κατάσταση</th>
              <th className="px-3 py-2">Match</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-xs">
                  {new Date(l.bookedAt).toLocaleDateString("el-GR")}
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">{l.description}</p>
                  <p className="text-[11px] text-slate-500">
                    {l.bankAccount.code}
                    {l.reference ? ` · ${l.reference}` : ""}
                  </p>
                </td>
                <td
                  className={`px-3 py-2 text-right font-semibold tabular-nums ${
                    l.amount < 0 ? "text-rose-700" : "text-emerald-700"
                  }`}
                >
                  {money(l.amount)}
                </td>
                <td className="px-3 py-2 text-xs">{l.status}</td>
                <td className="px-3 py-2">
                  {l.status === "MATCHED" && l.matchedInvoiceId ? (
                    <Link
                      href={`/invoices/${l.matchedInvoiceId}`}
                      className="text-xs font-medium text-teal-700 hover:underline"
                    >
                      Τιμολόγιο
                    </Link>
                  ) : null}
                  {canWrite && l.status === "UNMATCHED" && l.amount > 0 ? (
                    <select
                      defaultValue=""
                      disabled={pending}
                      onChange={(e) => {
                        if (e.target.value) matchLine(l.id, e.target.value);
                      }}
                      className="max-w-[180px] rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      <option value="">Αντιστοίχιση…</option>
                      {openInvoices.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.number} · {inv.customer} · {money(inv.balance)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                  Δεν υπάρχουν κινήσεις — κάνε import CSV.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
