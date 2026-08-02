"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import type { FinanceFilters } from "./finance-filters";
import { filtersToReportQuery } from "./finance-filters";

function money(n: number) {
  return n.toLocaleString("el-GR", { style: "currency", currency: "EUR" });
}

type VatRow = {
  vatRate: number;
  salesNet: number;
  salesVat: number;
  purchaseNet: number;
  purchaseVat: number;
  netVat: number;
};

type PartyLine = {
  at: string;
  docType: string;
  number: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  refId?: string;
};

type PartyOpt = { id: string; code: string; name: string };

type ObLine = {
  glAccountCode: string;
  debit: string;
  credit: string;
  memo: string;
};

export function GreekBooksPanel({
  canWrite,
  filters,
}: {
  canWrite: boolean;
  filters?: FinanceFilters;
}) {
  const [tab, setTab] = useState<"vat" | "customer" | "supplier" | "opening">(
    "vat",
  );
  const [vatRows, setVatRows] = useState<VatRow[]>([]);
  const [vatTotals, setVatTotals] = useState<{
    salesNet: number;
    salesVat: number;
    purchaseNet: number;
    purchaseVat: number;
    netVat: number;
  } | null>(null);
  const [customers, setCustomers] = useState<PartyOpt[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOpt[]>([]);
  const [partyId, setPartyId] = useState("");
  const [cardLines, setCardLines] = useState<PartyLine[]>([]);
  const [cardBalance, setCardBalance] = useState(0);
  const [partyLabel, setPartyLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [obLines, setObLines] = useState<ObLine[]>([
    { glAccountCode: "38.00.00", debit: "0", credit: "0", memo: "" },
    { glAccountCode: "30.00.00", debit: "0", credit: "0", memo: "" },
    { glAccountCode: "50.00.00", debit: "0", credit: "0", memo: "" },
    { glAccountCode: "40.00.00", debit: "0", credit: "0", memo: "" },
  ]);
  const [obDesc, setObDesc] = useState("Υπόλοιπα έναρξης");

  const loadVat = useCallback(async () => {
    setBusy(true);
    try {
      const params = filters
        ? filtersToReportQuery(filters)
        : new URLSearchParams();
      params.set("kind", "vat-books");
      const res = await fetch(`/api/finance/reports?${params}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία βιβλίου ΦΠΑ");
        return;
      }
      setVatRows(data.rows ?? []);
      setVatTotals(data.totals ?? null);
    } finally {
      setBusy(false);
    }
  }, [filters]);

  const loadParties = useCallback(async () => {
    const [cRes, sRes] = await Promise.all([
      fetch("/api/customers?limit=100"),
      fetch("/api/suppliers"),
    ]);
    const cData = await cRes.json().catch(() => ({}));
    const sData = await sRes.json().catch(() => ({}));
    setCustomers(
      (cData.items ?? cData.customers ?? []).map(
        (c: { id: string; code: string; name: string }) => ({
          id: c.id,
          code: c.code,
          name: c.name,
        }),
      ),
    );
    setSuppliers(
      (sData.items ?? sData.suppliers ?? []).map(
        (s: { id: string; code: string; name: string }) => ({
          id: s.id,
          code: s.code,
          name: s.name,
        }),
      ),
    );
  }, []);

  useEffect(() => {
    void loadParties();
  }, [loadParties]);

  useEffect(() => {
    if (tab === "vat") void loadVat();
  }, [tab, loadVat]);

  async function loadCard(kind: "customer-card" | "supplier-card") {
    if (!partyId) {
      toast.error("Επίλεξε αντισυμβαλλόμενο");
      return;
    }
    setBusy(true);
    try {
      const params = filters
        ? filtersToReportQuery(filters)
        : new URLSearchParams();
      params.set("kind", kind);
      params.set("partyId", partyId);
      const res = await fetch(`/api/finance/reports?${params}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία καρτέλας");
        return;
      }
      setCardLines(data.lines ?? []);
      setCardBalance(data.balance ?? 0);
      setPartyLabel(
        data.party
          ? `${data.party.code} · ${data.party.name}`
          : partyId,
      );
    } finally {
      setBusy(false);
    }
  }

  async function postOpening() {
    const lines = obLines
      .map((l) => ({
        glAccountCode: l.glAccountCode.trim(),
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        memo: l.memo || null,
      }))
      .filter((l) => l.glAccountCode && (l.debit > 0 || l.credit > 0));
    if (lines.length < 2) {
      toast.error("Χρειάζονται ≥2 γραμμές με ποσά");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/finance/opening-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: obDesc,
          legalEntityId: filters?.legalEntityId || null,
          lines,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία");
        return;
      }
      toast.success(`Άρθρο έναρξης ${data.item?.number ?? ""}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ["vat", "Βιβλίο ΦΠΑ"],
            ["customer", "Καρτέλα πελάτη"],
            ["supplier", "Καρτέλα προμηθευτή"],
            ["opening", "Υπόλοιπα έναρξης"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={
              tab === k
                ? "rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-sm"
                : "rounded-lg px-3 py-1.5 text-xs text-slate-600"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "vat" ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void loadVat()}>
              Ανανέωση
            </Button>
          </div>
          {vatTotals ? (
            <div className="grid gap-2 sm:grid-cols-5">
              {(
                [
                  ["Πωλ. καθαρή", vatTotals.salesNet],
                  ["ΦΠΑ εκροών", vatTotals.salesVat],
                  ["Αγορ. καθαρή", vatTotals.purchaseNet],
                  ["ΦΠΑ εισροών", vatTotals.purchaseVat],
                  ["Καθαρός ΦΠΑ", vatTotals.netVat],
                ] as const
              ).map(([label, v]) => (
                <div
                  key={label}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-sm font-semibold tabular-nums">{money(v)}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Συντ.</th>
                  <th className="px-3 py-2 text-right">Πωλ. καθαρή</th>
                  <th className="px-3 py-2 text-right">ΦΠΑ εκροών</th>
                  <th className="px-3 py-2 text-right">Αγορ. καθαρή</th>
                  <th className="px-3 py-2 text-right">ΦΠΑ εισροών</th>
                  <th className="px-3 py-2 text-right">Καθαρός</th>
                </tr>
              </thead>
              <tbody>
                {vatRows.map((r) => (
                  <tr key={r.vatRate} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{r.vatRate}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.salesNet)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.salesVat)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.purchaseNet)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.purchaseVat)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {money(r.netVat)}
                    </td>
                  </tr>
                ))}
                {vatRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      Δεν υπάρχουν κινήσεις ΦΠΑ στην περίοδο.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "customer" || tab === "supplier" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {tab === "customer" ? "Πελάτης" : "Προμηθευτής"}
              </span>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
              >
                <option value="">— επίλεξε —</option>
                {(tab === "customer" ? customers : suppliers).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void loadCard(
                  tab === "customer" ? "customer-card" : "supplier-card",
                )
              }
            >
              Φόρτωση
            </Button>
          </div>
          {partyLabel ? (
            <p className="text-sm text-slate-600">
              {partyLabel} · υπόλοιπο{" "}
              <span className="font-semibold tabular-nums">
                {money(cardBalance)}
              </span>
            </p>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Ημ/νία</th>
                  <th className="px-3 py-2">Είδος</th>
                  <th className="px-3 py-2">Αρ.</th>
                  <th className="px-3 py-2">Περιγραφή</th>
                  <th className="px-3 py-2 text-right">Χρέωση</th>
                  <th className="px-3 py-2 text-right">Πίστωση</th>
                  <th className="px-3 py-2 text-right">Υπόλ.</th>
                </tr>
              </thead>
              <tbody>
                {cardLines.map((l, i) => (
                  <tr key={`${l.refId ?? l.number}-${i}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-xs">
                      {new Date(l.at).toLocaleDateString("el-GR")}
                    </td>
                    <td className="px-3 py-2 text-xs">{l.docType}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.number}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {l.description}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l.debit ? money(l.debit) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l.credit ? money(l.credit) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {money(l.balance)}
                    </td>
                  </tr>
                ))}
                {cardLines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                      Επίλεξε αντισυμβαλλόμενο και φόρτωσε την καρτέλα.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "opening" ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Δημιουργεί άρθρο ανοίγματος (isOpening) με χρεώσεις/πιστώσεις στους
            επιλεγμένους λογαριασμούς. Η περίοδος πρέπει να είναι ανοιχτή.
          </p>
          <label className="block max-w-md">
            <span className="mb-1 block text-xs font-medium">Περιγραφή</span>
            <input
              value={obDesc}
              onChange={(e) => setObDesc(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
          </label>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Λογαριασμός</th>
                  <th className="px-3 py-2">Χρέωση</th>
                  <th className="px-3 py-2">Πίστωση</th>
                  <th className="px-3 py-2">Σημείωση</th>
                </tr>
              </thead>
              <tbody>
                {obLines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">
                      <input
                        value={l.glAccountCode}
                        onChange={(e) => {
                          const next = [...obLines];
                          next[i] = { ...l, glAccountCode: e.target.value };
                          setObLines(next);
                        }}
                        className="h-9 w-full rounded-lg border border-slate-200 px-2 font-mono text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        value={l.debit}
                        onChange={(e) => {
                          const next = [...obLines];
                          next[i] = { ...l, debit: e.target.value };
                          setObLines(next);
                        }}
                        className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        value={l.credit}
                        onChange={(e) => {
                          const next = [...obLines];
                          next[i] = { ...l, credit: e.target.value };
                          setObLines(next);
                        }}
                        className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={l.memo}
                        onChange={(e) => {
                          const next = [...obLines];
                          next[i] = { ...l, memo: e.target.value };
                          setObLines(next);
                        }}
                        className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setObLines((prev) => [
                  ...prev,
                  { glAccountCode: "", debit: "0", credit: "0", memo: "" },
                ])
              }
            >
              + Γραμμή
            </Button>
            {canWrite ? (
              <Button size="sm" disabled={busy} onClick={() => void postOpening()}>
                Καταχώρηση άρθρου
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
