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
  matchedPurchaseInvoiceId?: string | null;
  matchNote?: string | null;
  bankAccount: { code: string; name: string };
};

type OpenInvoice = {
  id: string;
  number: string;
  balance: number;
  customer: string;
};

type OpenPurchase = {
  id: string;
  number: string;
  balance: number;
  supplier: string;
};

type Suggestion = {
  kind: "AR" | "AP";
  id: string;
  number: string;
  party: string;
  balance: number;
  score: number;
  reason: string;
};

function money(n: number) {
  return n.toLocaleString("el-GR", { style: "currency", currency: "EUR" });
}

export function BankingPanel({
  openInvoices,
  openPurchases = [],
  canWrite,
}: {
  openInvoices: OpenInvoice[];
  openPurchases?: OpenPurchase[];
  canWrite: boolean;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [csv, setCsv] = useState(
    "2026-08-01,1200.50,Είσπραξη Αιγαίο,REF-1001\n2026-08-02,-340.00,Πληρωμή προμηθευτή,AP-22",
  );
  const [ofxText, setOfxText] = useState("");
  const [importMode, setImportMode] = useState<"csv" | "ofx">("csv");
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>(
    {},
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

  function importStatements() {
    if (!accountId) {
      toast.error("Επίλεξε λογαριασμό");
      return;
    }

    startTransition(async () => {
      let body: Record<string, unknown>;
      if (importMode === "ofx") {
        if (!ofxText.trim()) {
          toast.error("Επικόλλησε OFX/QFX");
          return;
        }
        body = { bankAccountId: accountId, ofxText };
      } else {
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
        body = { bankAccountId: accountId, lines: parsed };
      }

      const res = await fetch("/api/banking/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  function matchLine(
    lineId: string,
    opts: { invoiceId?: string; purchaseInvoiceId?: string },
  ) {
    startTransition(async () => {
      const res = await fetch(`/api/banking/statements/${lineId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία match");
        return;
      }
      const settleNo =
        data.item?.settlementNumber ||
        data.settlementNumber ||
        data.settlement?.number;
      const kind = data.item?.kind === "AP" ? "πληρωμή" : "είσπραξη";
      toast.success(
        settleNo
          ? `Αντιστοιχίστηκε · ${kind} ${settleNo}`
          : "Αντιστοιχίστηκε & καταχωρήθηκε εξόφληση",
      );
      void load();
    });
  }

  function unmatchLine(lineId: string) {
    if (!window.confirm("Ακύρωση αντιστοίχισης (και εξόφλησης αν υπάρχει);")) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/banking/statements/${lineId}/unmatch`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία unmatch");
        return;
      }
      toast.success("Η αντιστοίχιση ακυρώθηκε");
      void load();
    });
  }

  function loadSuggestions(lineId: string) {
    startTransition(async () => {
      const res = await fetch(`/api/banking/statements/${lineId}/suggest`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία προτάσεων");
        return;
      }
      setSuggestions((prev) => ({ ...prev, [lineId]: data.items || [] }));
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
          <div className="flex rounded-xl border border-slate-200 p-0.5 text-xs">
            <button
              type="button"
              className={`rounded-lg px-3 py-2 ${
                importMode === "csv" ? "bg-teal-700 text-white" : "text-slate-600"
              }`}
              onClick={() => setImportMode("csv")}
            >
              CSV
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-2 ${
                importMode === "ofx" ? "bg-teal-700 text-white" : "text-slate-600"
              }`}
              onClick={() => setImportMode("ofx")}
            >
              OFX
            </button>
          </div>
          {canWrite ? (
            <Button size="sm" disabled={pending} onClick={importStatements}>
              Import {importMode === "ofx" ? "OFX" : "CSV"}
            </Button>
          ) : null}
        </div>
        {importMode === "csv" ? (
          <>
            <p className="text-xs text-slate-500">
              Μορφή: ημερομηνία,ποσό,περιγραφή,αναφορά (θετικό=είσπραξη, αρνητικό=πληρωμή)
            </p>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={4}
              disabled={!canWrite}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-teal-300"
            />
          </>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              Επικόλλησε πλήρες OFX/QFX (STMTTRN). Υποστηρίζεται χωρίς εξωτερικό parser.
            </p>
            <textarea
              value={ofxText}
              onChange={(e) => setOfxText(e.target.value)}
              rows={4}
              disabled={!canWrite}
              placeholder="<OFX>…<STMTTRN>…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-teal-300"
            />
          </>
        )}
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
              <tr key={l.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 text-xs">
                  {new Date(l.bookedAt).toLocaleDateString("el-GR")}
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">{l.description}</p>
                  <p className="text-[11px] text-slate-500">
                    {l.bankAccount.code}
                    {l.reference ? ` · ${l.reference}` : ""}
                  </p>
                  {l.matchNote ? (
                    <p className="text-[11px] text-teal-700">{l.matchNote}</p>
                  ) : null}
                </td>
                <td
                  className={`px-3 py-2 text-right font-semibold tabular-nums ${
                    l.amount < 0 ? "text-rose-700" : "text-emerald-700"
                  }`}
                >
                  {money(l.amount)}
                </td>
                <td className="px-3 py-2 text-xs">{l.status}</td>
                <td className="px-3 py-2 space-y-1.5">
                  {l.status === "MATCHED" && l.matchedInvoiceId ? (
                    <Link
                      href={`/invoices/${l.matchedInvoiceId}`}
                      className="block text-xs font-medium text-teal-700 hover:underline"
                    >
                      Τιμολόγιο πώλησης
                    </Link>
                  ) : null}
                  {l.status === "MATCHED" && l.matchedPurchaseInvoiceId ? (
                    <span className="block text-xs font-medium text-slate-700">
                      Αγορά · {l.matchedPurchaseInvoiceId.slice(-8)}
                    </span>
                  ) : null}
                  {canWrite && l.status === "MATCHED" ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => unmatchLine(l.id)}
                      className="text-xs text-rose-700 hover:underline"
                    >
                      Unmatch
                    </button>
                  ) : null}
                  {canWrite && l.status === "UNMATCHED" && l.amount > 0 ? (
                    <div className="space-y-1">
                      <select
                        defaultValue=""
                        disabled={pending}
                        onChange={(e) => {
                          if (e.target.value)
                            matchLine(l.id, { invoiceId: e.target.value });
                        }}
                        className="max-w-[220px] rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="">Είσπραξη → τιμολόγιο…</option>
                        {openInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.number} · {inv.customer} · {money(inv.balance)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => loadSuggestions(l.id)}
                        className="block text-[11px] font-medium text-teal-700 hover:underline"
                      >
                        Προτάσεις
                      </button>
                    </div>
                  ) : null}
                  {canWrite && l.status === "UNMATCHED" && l.amount < 0 ? (
                    <div className="space-y-1">
                      <select
                        defaultValue=""
                        disabled={pending}
                        onChange={(e) => {
                          if (e.target.value)
                            matchLine(l.id, {
                              purchaseInvoiceId: e.target.value,
                            });
                        }}
                        className="max-w-[220px] rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="">Πληρωμή → αγορά…</option>
                        {openPurchases.map((pi) => (
                          <option key={pi.id} value={pi.id}>
                            {pi.number} · {pi.supplier} · {money(pi.balance)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => loadSuggestions(l.id)}
                        className="block text-[11px] font-medium text-teal-700 hover:underline"
                      >
                        Προτάσεις
                      </button>
                    </div>
                  ) : null}
                  {(suggestions[l.id] || []).length > 0 ? (
                    <ul className="mt-1 space-y-1 rounded-lg bg-slate-50 p-1.5">
                      {suggestions[l.id]!.map((s) => (
                        <li key={`${s.kind}-${s.id}`}>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              matchLine(
                                l.id,
                                s.kind === "AR"
                                  ? { invoiceId: s.id }
                                  : { purchaseInvoiceId: s.id },
                              )
                            }
                            className="w-full rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-white"
                          >
                            <span className="font-semibold">
                              {s.kind} {s.number}
                            </span>{" "}
                            · {s.party} · {money(s.balance)}
                            <span className="block text-slate-500">
                              score {s.score} · {s.reason}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                  Δεν υπάρχουν κινήσεις — κάνε import CSV ή OFX.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
