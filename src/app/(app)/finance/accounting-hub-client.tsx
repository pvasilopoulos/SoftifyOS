"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { formatEUR } from "@/modules/sales/invoice-utils";
import {
  filtersToReportQuery,
  matchesText,
  type FinanceFilters,
} from "./finance-filters";

type Tab =
  | "reports"
  | "periods"
  | "dimensions"
  | "controlling"
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
  isOwner = false,
  initialPeriods,
  forcedTab,
  hideOuterChrome,
  filters,
}: {
  canWrite: boolean;
  isOwner?: boolean;
  initialPeriods: Period[];
  forcedTab?: Tab;
  hideOuterChrome?: boolean;
  filters?: FinanceFilters;
}) {
  const [tab, setTab] = useState<Tab>(forcedTab ?? "reports");
  useEffect(() => {
    if (forcedTab) {
      setTab(forcedTab);
      if (forcedTab === "reports") loadReport("trial-balance");
      if (forcedTab === "dimensions") loadDimensions();
      if (forcedTab === "controlling") loadControlling();
      if (forcedTab === "assets") loadAssets();
      if (forcedTab === "purchases") loadPurchases();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedTab]);

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
  const [allocations, setAllocations] = useState<
    Array<{
      id: string;
      code: string;
      name: string;
      amount: number;
      status: string;
      sourceCostCenter: { code: string; name: string };
      glAccount: { code: string; name: string };
    }>
  >([]);
  const [icMatches, setIcMatches] = useState<
    Array<{
      id: string;
      code: string;
      amount: number;
      difference: number;
      status: string;
      legalEntityA: { code: string; name: string };
      legalEntityB: { code: string; name: string };
    }>
  >([]);
  const [ledgers, setLedgers] = useState<
    Array<{
      id: string;
      code: string;
      name: string;
      kind: string;
      isDefault: boolean;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showAllocForm, setShowAllocForm] = useState(false);
  const [showIcForm, setShowIcForm] = useState(false);
  const [showLedgerForm, setShowLedgerForm] = useState(false);
  const [showCcForm, setShowCcForm] = useState(false);
  const [showLeForm, setShowLeForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [allocForm, setAllocForm] = useState({
    code: "",
    name: "",
    amount: "100",
    sourceId: "",
    targetId: "",
    glAccountId: "",
  });
  const [icForm, setIcForm] = useState({
    code: "",
    entityAId: "",
    entityBId: "",
    amount: "100",
    eliminate: true,
  });
  const [ledgerForm, setLedgerForm] = useState({
    code: "IFRS",
    name: "IFRS books",
    kind: "IFRS",
  });
  const [ccForm, setCcForm] = useState({ code: "", name: "" });
  const [leForm, setLeForm] = useState({ code: "", name: "" });
  const [assetForm, setAssetForm] = useState({
    code: "",
    name: "",
    cost: "1000",
    lifeMonths: "60",
  });
  const [glAccounts, setGlAccounts] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);

  const monthPeriods = useMemo(
    () => periods.filter((p) => p.kind === "MONTH"),
    [periods],
  );
  const yearPeriods = useMemo(
    () => periods.filter((p) => p.kind === "YEAR"),
    [periods],
  );

  const loadReport = (kind = reportKind) => {
    startTransition(async () => {
      setError(null);
      const params = filters
        ? filtersToReportQuery(filters)
        : new URLSearchParams();
      params.set("kind", kind);
      const res = await fetch(`/api/finance/reports?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αναφοράς");
        return;
      }
      setReportKind(kind);
      const q = filters?.q?.trim() ?? "";
      if (kind === "trial-balance" || kind === "cost-centers") {
        const next = (data.rows ?? []) as TrialRow[];
        setRows(
          q
            ? next.filter(
                (r) =>
                  matchesText(r.code, q) ||
                  matchesText(r.name, q) ||
                  matchesText(r.type, q),
              )
            : next,
        );
        setPnl(null);
        setBs(null);
      } else if (kind === "pnl") {
        setPnl({
          revenueTotal: data.revenueTotal,
          expenseTotal: data.expenseTotal,
          netIncome: data.netIncome,
        });
        const pnlRows = [
          ...(data.revenue ?? []).map((r: TrialRow) => ({
            ...r,
            balance: r.credit - r.debit,
          })),
          ...(data.expense ?? []).map((r: TrialRow) => ({
            ...r,
            balance: r.debit - r.credit,
          })),
        ];
        setRows(
          q
            ? pnlRows.filter(
                (r) => matchesText(r.code, q) || matchesText(r.name, q),
              )
            : pnlRows,
        );
        setBs(null);
      } else if (kind === "balance-sheet") {
        setBs({
          assetTotal: data.assetTotal,
          liabilityTotal: data.liabilityTotal,
          equityTotal: data.equityTotal,
          netIncome: data.netIncome,
          balanced: data.balanced,
        });
        const bsRows = [
          ...(data.assets ?? []),
          ...(data.liabilities ?? []),
          ...(data.equity ?? []),
        ] as TrialRow[];
        setRows(
          q
            ? bsRows.filter(
                (r) => matchesText(r.code, q) || matchesText(r.name, q),
              )
            : bsRows,
        );
        setPnl(null);
      } else if (kind === "consolidation") {
        const cons = (data.consolidated ?? []) as TrialRow[];
        setRows(
          q
            ? cons.filter(
                (r) => matchesText(r.code, q) || matchesText(r.name, q),
              )
            : cons,
        );
        setPnl(null);
        setBs(null);
      }
    });
  };

  useEffect(() => {
    if (tab === "reports") loadReport(reportKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.from, filters?.to, filters?.legalEntityId, filters?.q]);

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

  const loadControlling = () => {
    startTransition(async () => {
      const res = await fetch("/api/finance/controlling");
      const data = await res.json();
      if (res.ok) {
        setAllocations(data.allocations ?? []);
        setIcMatches(data.intercompany ?? []);
        setLedgers(data.ledgers ?? []);
      }
    });
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setError(null);
    setMessage(null);
    if (t === "reports") loadReport("trial-balance");
    if (t === "dimensions") loadDimensions();
    if (t === "controlling") loadControlling();
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

  const closeYear = (year: number) => {
    if (
      !window.confirm(
        `Κλείσιμο χρήσης ${year}; Θα κλείσουν οι μήνες, θα γίνει άρθρο αποτελεσμάτων σε 80.00.00 και υπόλοιπα έναρξης.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/finance/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close-year",
          year,
          createOpenings: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία κλεισίματος χρήσης");
        return;
      }
      setMessage(
        `Χρήση ${year} κλειστή · αποτέλεσμα ${formatEUR(data.netIncome ?? 0)} → 80.00.00`,
      );
      const list = await fetch(`/api/finance/periods?year=${year}`);
      const listData = await list.json();
      if (list.ok) setPeriods(listData.items ?? []);
    });
  };

  const openAllocForm = () => {
    startTransition(async () => {
      const [dim, glRes] = await Promise.all([
        fetch("/api/finance/dimensions"),
        fetch("/api/settings/gl-accounts"),
      ]);
      const dimData = await dim.json();
      const glData = await glRes.json();
      if (dim.ok) {
        setLegalEntities(dimData.legalEntities ?? []);
        setCostCenters(dimData.costCenters ?? []);
      }
      if (glRes.ok) {
        setGlAccounts(
          ((glData.items ?? []) as Array<{
            id: string;
            code: string;
            name: string;
            isPostable: boolean;
          }>)
            .filter((a) => a.isPostable)
            .map((a) => ({ id: a.id, code: a.code, name: a.name })),
        );
      }
      const ccs = (dimData.costCenters ?? []) as Array<{ id: string }>;
      const glDefault = (
        (glData.items ?? []) as Array<{ id: string; code: string }>
      ).find((a) => a.code === "64.00.00");
      setAllocForm({
        code: `ALLOC-${Date.now().toString().slice(-6)}`,
        name: "",
        amount: "100",
        sourceId: ccs[0]?.id ?? "",
        targetId: ccs[1]?.id ?? ccs[0]?.id ?? "",
        glAccountId: glDefault?.id ?? "",
      });
      setShowAllocForm(true);
    });
  };

  const submitAllocation = () => {
    startTransition(async () => {
      setError(null);
      const amount = Number(allocForm.amount);
      if (
        !allocForm.code ||
        !allocForm.name ||
        !(amount > 0) ||
        !allocForm.sourceId ||
        !allocForm.targetId ||
        !allocForm.glAccountId
      ) {
        setError("Συμπλήρωσε όλα τα πεδία κατανομής");
        return;
      }
      if (allocForm.sourceId === allocForm.targetId) {
        setError("Πηγή και στόχος πρέπει να διαφέρουν");
        return;
      }
      const res = await fetch("/api/finance/controlling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "allocation",
          code: allocForm.code,
          name: allocForm.name,
          method: "PERCENT",
          sourceCostCenterId: allocForm.sourceId,
          glAccountId: allocForm.glAccountId,
          amount,
          targets: [{ costCenterId: allocForm.targetId, weight: 100 }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία κατανομής");
        return;
      }
      setMessage(`Κατανομή ${allocForm.code} posted στο GL`);
      setShowAllocForm(false);
      loadControlling();
    });
  };

  const openIcForm = () => {
    startTransition(async () => {
      const dim = await fetch("/api/finance/dimensions");
      const dimData = await dim.json();
      if (dim.ok) {
        setLegalEntities(dimData.legalEntities ?? []);
        setCostCenters(dimData.costCenters ?? []);
      }
      const les = (dimData.legalEntities ?? []) as Array<{ id: string }>;
      setIcForm({
        code: `IC-${Date.now().toString().slice(-6)}`,
        entityAId: les[0]?.id ?? "",
        entityBId: les[1]?.id ?? "",
        amount: "100",
        eliminate: true,
      });
      setShowIcForm(true);
    });
  };

  const submitIcMatch = () => {
    startTransition(async () => {
      setError(null);
      const amount = Number(icForm.amount);
      if (
        !icForm.code ||
        !icForm.entityAId ||
        !icForm.entityBId ||
        !(amount > 0)
      ) {
        setError("Συμπλήρωσε IC match");
        return;
      }
      const res = await fetch("/api/finance/controlling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "intercompany",
          code: icForm.code,
          legalEntityAId: icForm.entityAId,
          legalEntityBId: icForm.entityBId,
          amount,
          eliminate: icForm.eliminate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία IC");
        return;
      }
      setMessage(`IC ${icForm.code}: ${data.item.status}`);
      setShowIcForm(false);
      loadControlling();
    });
  };

  const submitLedger = () => {
    startTransition(async () => {
      setError(null);
      if (!ledgerForm.code.trim() || !ledgerForm.name.trim()) {
        setError("Συμπλήρωσε κωδικό και όνομα ledger");
        return;
      }
      const res = await fetch("/api/finance/controlling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "ledger",
          code: ledgerForm.code.trim(),
          name: ledgerForm.name.trim(),
          kind: ledgerForm.kind,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία ledger");
        return;
      }
      setMessage(`Ledger ${ledgerForm.code} αποθηκεύτηκε`);
      setShowLedgerForm(false);
      loadControlling();
    });
  };

  const submitCostCenter = () => {
    startTransition(async () => {
      setError(null);
      if (!ccForm.code.trim() || !ccForm.name.trim()) {
        setError("Συμπλήρωσε κωδικό και όνομα κέντρου");
        return;
      }
      const res = await fetch("/api/finance/dimensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "cost-center",
          code: ccForm.code.trim(),
          name: ccForm.name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setCostCenters((prev) => [...prev, data.item]);
      setMessage("Κέντρο κόστους αποθηκεύτηκε");
      setShowCcForm(false);
      setCcForm({ code: "", name: "" });
    });
  };

  const submitLegalEntity = () => {
    startTransition(async () => {
      setError(null);
      if (!leForm.code.trim() || !leForm.name.trim()) {
        setError("Συμπλήρωσε κωδικό και επωνυμία");
        return;
      }
      const res = await fetch("/api/finance/dimensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "legal-entity",
          code: leForm.code.trim(),
          name: leForm.name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setLegalEntities((prev) => [...prev, data.item]);
      setMessage("Νομική οντότητα αποθηκεύτηκε");
      setShowLeForm(false);
      setLeForm({ code: "", name: "" });
    });
  };

  const submitAsset = () => {
    startTransition(async () => {
      setError(null);
      const cost = Number(assetForm.cost);
      const life = Number(assetForm.lifeMonths);
      if (
        !assetForm.code.trim() ||
        !assetForm.name.trim() ||
        !(cost > 0) ||
        !(life > 0)
      ) {
        setError("Συμπλήρωσε πάγιο με κόστος και διάρκεια");
        return;
      }
      const res = await fetch("/api/finance/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: assetForm.code.trim(),
          name: assetForm.name.trim(),
          acquisitionDate: new Date().toISOString(),
          acquisitionCost: cost,
          usefulLifeMonths: life,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setMessage(`Πάγιο ${assetForm.code} + άρθρο GL`);
      setShowAssetForm(false);
      setAssetForm({ code: "", name: "", cost: "1000", lifeMonths: "60" });
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
    { id: "controlling", label: "CO / IC / Ledgers" },
    { id: "assets", label: "Πάγια" },
    { id: "purchases", label: "Αγορές FI" },
  ];

  return (
    <section className="soft-panel space-y-4 p-4">
      {!hideOuterChrome ? (
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
      ) : (
        <div>
          <h2 className="text-base font-semibold text-ink-950">
            {tabs.find((t) => t.id === tab)?.label ?? "FI"}
          </h2>
          <p className="text-xs text-slate-500">
            Λειτουργική ενότητα λογιστικής
          </p>
        </div>
      )}

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
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              Κλείσιμο χρήσης → άρθρο αποτελεσμάτων σε 80.00.00 + υπόλοιπα έναρξης
              89.00.00.
            </p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {yearPeriods.map((p) => (
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
                    {canWrite && p.status === "OPEN" ? (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => closeYear(p.year)}
                      >
                        Κλείσιμο χρήσης → 80.xx
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              Μηνιαίες περίοδοι — κλείσιμο εμποδίζει νέα άρθρα.
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
                    {canWrite && p.status === "OPEN" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => periodAction(p.id, "close")}
                      >
                        Κλείσιμο
                      </Button>
                    ) : null}
                    {isOwner && p.status !== "OPEN" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => periodAction(p.id, "reopen")}
                      >
                        Επαναφορά (OWNER)
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "controlling" ? (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Κατανομές CO</h3>
              {canWrite ? (
                <Button size="sm" variant="secondary" onClick={openAllocForm}>
                  + Κατανομή
                </Button>
              ) : null}
            </div>
            {showAllocForm ? (
              <div className="grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  placeholder="Κωδικός"
                  value={allocForm.code}
                  onChange={(e) =>
                    setAllocForm((f) => ({ ...f, code: e.target.value }))
                  }
                />
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  placeholder="Περιγραφή"
                  value={allocForm.name}
                  onChange={(e) =>
                    setAllocForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={allocForm.amount}
                  onChange={(e) =>
                    setAllocForm((f) => ({ ...f, amount: e.target.value }))
                  }
                />
                <select
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={allocForm.glAccountId}
                  onChange={(e) =>
                    setAllocForm((f) => ({ ...f, glAccountId: e.target.value }))
                  }
                >
                  <option value="">Λογαριασμός εξόδου</option>
                  {glAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={allocForm.sourceId}
                  onChange={(e) =>
                    setAllocForm((f) => ({ ...f, sourceId: e.target.value }))
                  }
                >
                  <option value="">Κέντρο πηγής</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={allocForm.targetId}
                  onChange={(e) =>
                    setAllocForm((f) => ({ ...f, targetId: e.target.value }))
                  }
                >
                  <option value="">Κέντρο στόχου</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
                {costCenters.length < 2 ? (
                  <p className="sm:col-span-2 text-xs text-amber-700">
                    Χρειάζονται ≥2 κέντρα κόστους — δημιούργησέ τα στις Διαστάσεις.
                  </p>
                ) : null}
                <div className="flex gap-2 sm:col-span-2">
                  <Button size="sm" disabled={pending} onClick={submitAllocation}>
                    Post κατανομή
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowAllocForm(false)}
                  >
                    Ακύρωση
                  </Button>
                </div>
              </div>
            ) : null}
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
              {allocations.length === 0 ? (
                <li className="px-3 py-4 text-slate-400">Καμία κατανομή ακόμη</li>
              ) : (
                allocations.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span>
                      <span className="font-mono text-xs text-slate-400">
                        {a.code}
                      </span>{" "}
                      {a.name}
                      <span className="ml-2 text-xs text-slate-500">
                        {a.sourceCostCenter.code} · {a.glAccount.code}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone="teal">{a.status}</Badge>
                      <span className="tabular-nums">{formatEUR(a.amount)}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Intercompany matching</h3>
              {canWrite ? (
                <Button size="sm" variant="secondary" onClick={openIcForm}>
                  + IC match
                </Button>
              ) : null}
            </div>
            {showIcForm ? (
              <div className="grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={icForm.code}
                  onChange={(e) =>
                    setIcForm((f) => ({ ...f, code: e.target.value }))
                  }
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={icForm.amount}
                  onChange={(e) =>
                    setIcForm((f) => ({ ...f, amount: e.target.value }))
                  }
                />
                <select
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={icForm.entityAId}
                  onChange={(e) =>
                    setIcForm((f) => ({ ...f, entityAId: e.target.value }))
                  }
                >
                  <option value="">Οντότητα Α</option>
                  {legalEntities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code} · {e.name}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={icForm.entityBId}
                  onChange={(e) =>
                    setIcForm((f) => ({ ...f, entityBId: e.target.value }))
                  }
                >
                  <option value="">Οντότητα Β</option>
                  {legalEntities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code} · {e.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={icForm.eliminate}
                    onChange={(e) =>
                      setIcForm((f) => ({ ...f, eliminate: e.target.checked }))
                    }
                  />
                  Αυτόματο elimination journal
                </label>
                {legalEntities.length < 2 ? (
                  <p className="sm:col-span-2 text-xs text-amber-700">
                    Χρειάζονται ≥2 νομικές οντότητες στις Διαστάσεις.
                  </p>
                ) : null}
                <div className="flex gap-2 sm:col-span-2">
                  <Button size="sm" disabled={pending} onClick={submitIcMatch}>
                    Match
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowIcForm(false)}
                  >
                    Ακύρωση
                  </Button>
                </div>
              </div>
            ) : null}
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
              {icMatches.length === 0 ? (
                <li className="px-3 py-4 text-slate-400">Κανένα match ακόμη</li>
              ) : (
                icMatches.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span>
                      <span className="font-mono text-xs text-slate-400">
                        {m.code}
                      </span>{" "}
                      {m.legalEntityA.code} ↔ {m.legalEntityB.code}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge
                        tone={
                          m.status === "ELIMINATED"
                            ? "teal"
                            : m.status === "MATCHED"
                              ? "emerald"
                              : "slate"
                        }
                      >
                        {m.status}
                      </Badge>
                      <span className="tabular-nums">{formatEUR(m.amount)}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Parallel ledgers</h3>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setLedgerForm({
                      code: "IFRS",
                      name: "IFRS books",
                      kind: "IFRS",
                    });
                    setShowLedgerForm(true);
                  }}
                >
                  + Ledger
                </Button>
              ) : null}
            </div>
            {showLedgerForm ? (
              <div className="grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-3">
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  placeholder="Κωδικός"
                  value={ledgerForm.code}
                  onChange={(e) =>
                    setLedgerForm((f) => ({ ...f, code: e.target.value }))
                  }
                />
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  placeholder="Όνομα"
                  value={ledgerForm.name}
                  onChange={(e) =>
                    setLedgerForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
                <select
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={ledgerForm.kind}
                  onChange={(e) =>
                    setLedgerForm((f) => ({ ...f, kind: e.target.value }))
                  }
                >
                  <option value="STATUTORY">STATUTORY</option>
                  <option value="IFRS">IFRS</option>
                  <option value="MANAGEMENT">MANAGEMENT</option>
                  <option value="TAX">TAX</option>
                </select>
                <div className="flex gap-2 sm:col-span-3">
                  <Button size="sm" disabled={pending} onClick={submitLedger}>
                    Αποθήκευση
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowLedgerForm(false)}
                  >
                    Ακύρωση
                  </Button>
                </div>
              </div>
            ) : null}
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
              {ledgers.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span>
                    <span className="font-mono text-xs text-slate-400">
                      {l.code}
                    </span>{" "}
                    {l.name}
                    <span className="ml-2 text-xs text-slate-500">{l.kind}</span>
                  </span>
                  {l.isDefault ? <Badge tone="teal">Default</Badge> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "dimensions" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Νομικές οντότητες</h3>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowLeForm(true)}
                >
                  + Οντότητα
                </Button>
              ) : null}
            </div>
            {showLeForm ? (
              <div className="grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  placeholder="Κωδικός"
                  value={leForm.code}
                  onChange={(e) =>
                    setLeForm((f) => ({ ...f, code: e.target.value }))
                  }
                />
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  placeholder="Επωνυμία"
                  value={leForm.name}
                  onChange={(e) =>
                    setLeForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={submitLegalEntity}
                  >
                    Αποθήκευση
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowLeForm(false)}
                  >
                    Ακύρωση
                  </Button>
                </div>
              </div>
            ) : null}
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
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowCcForm(true)}
                >
                  + Κέντρο
                </Button>
              ) : null}
            </div>
            {showCcForm ? (
              <div className="grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  placeholder="Κωδικός"
                  value={ccForm.code}
                  onChange={(e) =>
                    setCcForm((f) => ({ ...f, code: e.target.value }))
                  }
                />
                <input
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  placeholder="Όνομα"
                  value={ccForm.name}
                  onChange={(e) =>
                    setCcForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={submitCostCenter}
                  >
                    Αποθήκευση
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowCcForm(false)}
                  >
                    Ακύρωση
                  </Button>
                </div>
              </div>
            ) : null}
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
            <Button
              size="sm"
              onClick={() => {
                setAssetForm({
                  code: `FA-${Date.now().toString().slice(-4)}`,
                  name: "",
                  cost: "1000",
                  lifeMonths: "60",
                });
                setShowAssetForm(true);
              }}
              disabled={pending}
            >
              + Νέο πάγιο (με GL)
            </Button>
          ) : null}
          {showAssetForm ? (
            <div className="grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
              <input
                className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                placeholder="Κωδικός"
                value={assetForm.code}
                onChange={(e) =>
                  setAssetForm((f) => ({ ...f, code: e.target.value }))
                }
              />
              <input
                className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                placeholder="Περιγραφή"
                value={assetForm.name}
                onChange={(e) =>
                  setAssetForm((f) => ({ ...f, name: e.target.value }))
                }
              />
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                placeholder="Κόστος"
                value={assetForm.cost}
                onChange={(e) =>
                  setAssetForm((f) => ({ ...f, cost: e.target.value }))
                }
              />
              <input
                type="number"
                min="1"
                step="1"
                className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                placeholder="Μήνες ζωής"
                value={assetForm.lifeMonths}
                onChange={(e) =>
                  setAssetForm((f) => ({ ...f, lifeMonths: e.target.value }))
                }
              />
              <div className="flex gap-2 sm:col-span-2">
                <Button size="sm" disabled={pending} onClick={submitAsset}>
                  Καταχώρηση &amp; GL
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowAssetForm(false)}
                >
                  Ακύρωση
                </Button>
              </div>
            </div>
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
        <PurchasesPanel
          canWrite={canWrite}
          pending={pending}
          purchases={purchases}
          onCreated={(msg) => {
            setMessage(msg);
            loadPurchases();
          }}
          onError={setError}
          startTransition={startTransition}
        />
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

function PurchasesPanel({
  canWrite,
  pending,
  purchases,
  onCreated,
  onError,
  startTransition,
}: {
  canWrite: boolean;
  pending: boolean;
  purchases: Array<{
    id: string;
    number: string;
    status: string;
    total: number;
    supplier: { name: string };
  }>;
  onCreated: (msg: string) => void;
  onError: (msg: string | null) => void;
  startTransition: (fn: () => void) => void;
}) {
  const [suppliers, setSuppliers] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    number: "",
    supplierId: "",
    description: "Αγορές εμπορευμάτων",
    qty: "1",
    unitPrice: "100",
    vatRate: "24",
  });

  useEffect(() => {
    fetch("/api/suppliers?limit=100")
      .then((r) => r.json())
      .then((d) => {
        const items = (d.items ?? d.suppliers ?? []).map(
          (s: { id: string; code: string; name: string }) => ({
            id: s.id,
            code: s.code,
            name: s.name,
          }),
        );
        setSuppliers(items);
        if (items[0] && !form.supplierId) {
          setForm((f) => ({ ...f, supplierId: items[0].id }));
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    startTransition(() => {
      void (async () => {
        onError(null);
        const qty = Number(form.qty);
        const unitPrice = Number(form.unitPrice);
        const vatRate = Number(form.vatRate);
        if (!form.number || !form.supplierId || !(qty > 0)) {
          onError("Συμπλήρωσε αριθμό, προμηθευτή και ποσότητα");
          return;
        }
        const res = await fetch("/api/finance/purchase-invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            number: form.number,
            supplierId: form.supplierId,
            post: true,
            lines: [
              {
                description: form.description || "Αγορά",
                qty,
                unitPrice,
                vatRate,
              },
            ],
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          onError(data.error || "Αποτυχία δημιουργίας");
          return;
        }
        setShowForm(false);
        setForm((f) => ({
          ...f,
          number: "",
          description: "Αγορές εμπορευμάτων",
        }));
        onCreated(`Αγορά ${data.item?.number} + GL posting`);
      })();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Τιμολόγια αγοράς με αυτόματο posting σε 50 / έξοδα / ΦΠΑ εισροών.
        </p>
        {canWrite ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setForm((f) => ({
                ...f,
                number: `ΑΓ-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
              }));
              setShowForm(true);
            }}
          >
            + Τιμολόγιο αγοράς
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <div className="grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
          <input
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            placeholder="Αριθμός"
            value={form.number}
            onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
          />
          <select
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={form.supplierId}
            onChange={(e) =>
              setForm((f) => ({ ...f, supplierId: e.target.value }))
            }
          >
            <option value="">Προμηθευτής</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
          <input
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm sm:col-span-2"
            placeholder="Περιγραφή γραμμής"
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
          <input
            type="number"
            min="0.001"
            step="0.001"
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={form.qty}
            onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={form.unitPrice}
            onChange={(e) =>
              setForm((f) => ({ ...f, unitPrice: e.target.value }))
            }
          />
          <input
            type="number"
            min="0"
            step="1"
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={form.vatRate}
            onChange={(e) =>
              setForm((f) => ({ ...f, vatRate: e.target.value }))
            }
          />
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={pending} onClick={submit}>
              Καταχώρηση &amp; Post
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowForm(false)}
            >
              Ακύρωση
            </Button>
          </div>
          {suppliers.length === 0 ? (
            <p className="text-xs text-amber-700 sm:col-span-2">
              Δεν υπάρχουν προμηθευτές — δημιούργησε από Purchasing.
            </p>
          ) : null}
        </div>
      ) : null}

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
  );
}
