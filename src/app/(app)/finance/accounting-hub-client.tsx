"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { formatEUR } from "@/modules/sales/invoice-utils";

type Tab =
  | "reports"
  | "periods"
  | "dimensions"
  | "assets"
  | "purchases";

type Period = {
  id: string;
  code: string;
  name: string;
  kind: string;
  year: number;
  month: number | null;
  status: string;
};

type TrialRow = {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
};

export function AccountingHubClient({
  canWrite,
  initialPeriods,
}: {
  canWrite: boolean;
  initialPeriods: Period[];
}) {
  const [tab, setTab] = useState<Tab>("reports");
  const [reportKind, setReportKind] = useState("trial-balance");
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [pnl, setPnl] = useState<{
    revenueTotal: number;
    expenseTotal: number;
    netIncome: number;
  } | null>(null);
  const [bs, setBs] = useState<{
    assetTotal: number;
    liabilityTotal: number;
    equityTotal: number;
    netIncome: number;
    balanced: boolean;
  } | null>(null);
  const [periods, setPeriods] = useState(initialPeriods);
  const [costCenters, setCostCenters] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);
  const [legalEntities, setLegalEntities] = useState<
    Array<{ id: string; code: string; name: string; isDefault: boolean }>
  >([]);
  const [assets, setAssets] = useState<
    Array<{
      id: string;
      code: string;
      name: string;
      acquisitionCost: number;
      status: string;
      usefulLifeMonths: number;
    }>
  >([]);
  const [purchases, setPurchases] = useState<
    Array<{
      id: string;
      number: string;
      status: string;
      total: number;
      supplier: { name: string };
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const monthPeriods = useMemo(
    () => periods.filter((p) => p.kind === "MONTH"),
    [periods],
  );

  const loadReport = (kind = reportKind) => {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/finance/reports?kind=${kind}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αναφοράς");
        return;
      }
      setReportKind(kind);
      if (kind === "trial-balance" || kind === "cost-centers") {
        setRows(data.rows ?? []);
        setPnl(null);
        setBs(null);
      } else if (kind === "pnl") {
        setPnl({
          revenueTotal: data.revenueTotal,
          expenseTotal: data.expenseTotal,
          netIncome: data.netIncome,
        });
        setRows([
          ...(data.revenue ?? []).map((r: TrialRow) => ({
            ...r,
            balance: r.credit - r.debit,
          })),
          ...(data.expense ?? []).map((r: TrialRow) => ({
            ...r,
            balance: r.debit - r.credit,
          })),
        ]);
        setBs(null);
      } else if (kind === "balance-sheet") {
        setBs({
          assetTotal: data.assetTotal,
          liabilityTotal: data.liabilityTotal,
          equityTotal: data.equityTotal,
          netIncome: data.netIncome,
          balanced: data.balanced,
        });
        setRows([
          ...(data.assets ?? []),
          ...(data.liabilities ?? []),
          ...(data.equity ?? []),
        ]);
        setPnl(null);
      } else if (kind === "consolidation") {
        setRows(data.consolidated ?? []);
        setPnl(null);
        setBs(null);
      }
    });
  };

  const loadDimensions = () => {
    startTransition(async () => {
      const res = await fetch("/api/finance/dimensions");
      const data = await res.json();
      if (res.ok) {
        setLegalEntities(data.legalEntities ?? []);
        setCostCenters(data.costCenters ?? []);
      }
    });
  };

  const loadAssets = () => {
    startTransition(async () => {
      const res = await fetch("/api/finance/fixed-assets");
      const data = await res.json();
      if (res.ok) setAssets(data.items ?? []);
    });
  };

  const loadPurchases = () => {
    startTransition(async () => {
      const res = await fetch("/api/finance/purchase-invoices");
      const data = await res.json();
      if (res.ok) setPurchases(data.items ?? []);
    });
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setError(null);
    setMessage(null);
    if (t === "reports") loadReport("trial-balance");
    if (t === "dimensions") loadDimensions();
    if (t === "assets") loadAssets();
    if (t === "purchases") loadPurchases();
  };

  const periodAction = (periodId: string, action: "close" | "reopen") => {
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/finance/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setPeriods((prev) =>
        prev.map((p) => (p.id === periodId ? { ...p, ...data.item } : p)),
      );
      setMessage(action === "close" ? "Περίοδος κλειστή" : "Περίοδος ανοιχτή");
    });
  };

  const createCostCenter = () => {
    const code = window.prompt("Κωδικός κέντρου κόστους");
    const name = window.prompt("Όνομα");
    if (!code || !name) return;
    startTransition(async () => {
      const res = await fetch("/api/finance/dimensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "cost-center", code, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setCostCenters((prev) => [...prev, data.item]);
      setMessage("Κέντρο κόστους αποθηκεύτηκε");
    });
  };

  const createLegalEntity = () => {
    const code = window.prompt("Κωδικός νομικής οντότητας");
    const name = window.prompt("Επωνυμία");
    if (!code || !name) return;
    startTransition(async () => {
      const res = await fetch("/api/finance/dimensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "legal-entity", code, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setLegalEntities((prev) => [...prev, data.item]);
      setMessage("Νομική οντότητα αποθηκεύτηκε");
    });
  };

  const createAsset = () => {
    const code = window.prompt("Κωδικός παγίου");
    const name = window.prompt("Περιγραφή παγίου");
    const cost = Number(window.prompt("Κόστος απόκτησης", "1000") || 0);
    if (!code || !name || !(cost > 0)) return;
    startTransition(async () => {
      const res = await fetch("/api/finance/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          acquisitionDate: new Date().toISOString(),
          acquisitionCost: cost,
          usefulLifeMonths: 60,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setMessage(`Πάγιο ${code} + άρθρο GL`);
      loadAssets();
    });
  };

  const depreciate = (id: string) => {
    startTransition(async () => {
      const res = await fetch("/api/finance/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "depreciate", fixedAssetId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setMessage(`Απόσβεση ${formatEUR(data.amount)}`);
    });
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "reports", label: "Αναφορές GL" },
    { id: "periods", label: "Περίοδοι" },
    { id: "dimensions", label: "Διαστάσεις" },
    { id: "assets", label: "Πάγια" },
    { id: "purchases", label: "Αγορές FI" },
  ];

  return (
    <section className="soft-panel space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink-950">
            Λογιστική (FI)
          </h2>
          <p className="text-xs text-slate-500">
            Γενική · περίοδοι · αναλυτική · πάγια · consolidation · αγορές
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              className={
                tab === t.id
                  ? "rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-medium text-white"
                  : "rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      {tab === "reports" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["trial-balance", "Ισοζύγιο"],
                ["pnl", "Αποτελέσματα"],
                ["balance-sheet", "Ισολογισμός"],
                ["cost-centers", "Αναλυτική"],
                ["consolidation", "Consolidation"],
              ] as const
            ).map(([k, label]) => (
              <Button
                key={k}
                size="sm"
                variant={reportKind === k ? "primary" : "secondary"}
                disabled={pending}
                onClick={() => loadReport(k)}
              >
                {label}
              </Button>
            ))}
          </div>
          {pnl ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="Έσοδα" value={pnl.revenueTotal} />
              <Stat label="Έξοδα" value={pnl.expenseTotal} />
              <Stat label="Αποτέλεσμα" value={pnl.netIncome} emphasize />
            </div>
          ) : null}
          {bs ? (
            <div className="grid gap-2 sm:grid-cols-4">
              <Stat label="Ενεργητικό" value={bs.assetTotal} />
              <Stat label="Παθητικό" value={bs.liabilityTotal} />
              <Stat label="Καθαρή θέση" value={bs.equityTotal} />
              <div className="rounded-xl border border-slate-100 px-3 py-2">
                <p className="text-xs text-slate-500">Ισοσκελισμός</p>
                <Badge tone={bs.balanced ? "emerald" : "rose"}>
                  {bs.balanced ? "OK" : "Απόκλιση"}
                </Badge>
              </div>
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Κωδ.</th>
                  <th className="px-3 py-2">Λογαριασμός</th>
                  <th className="px-3 py-2 text-right">Χρέωση</th>
                  <th className="px-3 py-2 text-right">Πίστωση</th>
                  <th className="px-3 py-2 text-right">Υπόλοιπο</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-slate-400"
                    >
                      Επίλεξε αναφορά για φόρτωση
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.code} className="border-t border-slate-50">
                      <td className="px-3 py-1.5 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.debit ? formatEUR(r.debit) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.credit ? formatEUR(r.credit) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatEUR(r.balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "periods" ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Μηνιαίες περίοδοι τρέχουσας χρήσης — κλείσιμο εμποδίζει νέα άρθρα.
          </p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {monthPeriods.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-slate-400">{p.code}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={p.status === "OPEN" ? "emerald" : "rose"}>
                    {p.status === "OPEN" ? "Ανοιχτή" : "Κλειστή"}
                  </Badge>
                  {canWrite ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        periodAction(
                          p.id,
                          p.status === "OPEN" ? "close" : "reopen",
                        )
                      }
                    >
                      {p.status === "OPEN" ? "Κλείσιμο" : "Επαναφορά"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "dimensions" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Νομικές οντότητες</h3>
              {canWrite ? (
                <Button size="sm" variant="secondary" onClick={createLegalEntity}>
                  + Οντότητα
                </Button>
              ) : null}
            </div>
            <ul className="space-y-1 text-sm">
              {legalEntities.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
                >
                  <span>
                    <span className="font-mono text-xs text-slate-400">
                      {e.code}
                    </span>{" "}
                    {e.name}
                  </span>
                  {e.isDefault ? <Badge tone="teal">Default</Badge> : null}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Κέντρα κόστους</h3>
              {canWrite ? (
                <Button size="sm" variant="secondary" onClick={createCostCenter}>
                  + Κέντρο
                </Button>
              ) : null}
            </div>
            <ul className="space-y-1 text-sm">
              {costCenters.length === 0 ? (
                <li className="text-slate-400">Κανένα ακόμη</li>
              ) : (
                costCenters.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-slate-100 px-3 py-2"
                  >
                    <span className="font-mono text-xs text-slate-400">
                      {c.code}
                    </span>{" "}
                    {c.name}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "assets" ? (
        <div className="space-y-3">
          {canWrite ? (
            <Button size="sm" onClick={createAsset} disabled={pending}>
              + Νέο πάγιο (με GL)
            </Button>
          ) : null}
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {assets.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-400">
                Δεν υπάρχουν πάγια
              </li>
            ) : (
              assets.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {a.code} · {a.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatEUR(a.acquisitionCost)} · {a.usefulLifeMonths} μήνες
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={a.status === "ACTIVE" ? "emerald" : "slate"}>
                      {a.status}
                    </Badge>
                    {canWrite && a.status === "ACTIVE" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => depreciate(a.id)}
                      >
                        Απόσβεση
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

      {tab === "purchases" ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Τιμολόγια αγοράς με αυτόματο posting σε προμηθευτές / έξοδα / ΦΠΑ
            εισροών. Δημιουργία μέσω API{" "}
            <code className="rounded bg-slate-100 px-1">
              POST /api/finance/purchase-invoices
            </code>
            .
          </p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {purchases.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-400">
                Δεν υπάρχουν τιμολόγια αγοράς ακόμη
              </li>
            ) : (
              purchases.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span>
                    {p.number} · {p.supplier.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone="teal">{p.status}</Badge>
                    <span className="tabular-nums">{formatEUR(p.total)}</span>
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={
          emphasize
            ? "mt-1 text-lg font-semibold tabular-nums text-teal-800"
            : "mt-1 text-lg font-semibold tabular-nums"
        }
      >
        {formatEUR(value)}
      </p>
    </div>
  );
}
