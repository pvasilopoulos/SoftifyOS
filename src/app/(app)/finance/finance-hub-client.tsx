"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Boxes,
  Building2,
  Calculator,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Network,
  Package,
  Receipt,
  Scale,
  Send,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { AccountingHubClient } from "./accounting-hub-client";
import { FinanceOpsClient } from "./finance-ops-client";
import { FinanceJournalClient } from "./finance-journal-client";

type Period = {
  id: string;
  code: string;
  name: string;
  kind: string;
  year: number;
  month: number | null;
  status: string;
};

type Journal = {
  id: string;
  number: string;
  status: string;
  description: string | null;
  sourceType: string | null;
  postedAt: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    memo: string | null;
    debit: number;
    credit: number;
    accountCode: string;
    accountName: string;
  }>;
};

type Section =
  | "overview"
  | "journals"
  | "gl"
  | "periods"
  | "ar"
  | "ap"
  | "vat"
  | "banking"
  | "mydata"
  | "controlling"
  | "dimensions"
  | "assets"
  | "purchases";

const NAV: Array<{
  group: string;
  items: Array<{ id: Section; label: string; icon: typeof Wallet }>;
}> = [
  {
    group: "Επισκόπηση",
    items: [{ id: "overview", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    group: "Γενική λογιστική",
    items: [
      { id: "journals", label: "Ημερολόγιο", icon: BookOpen },
      { id: "gl", label: "Αναφορές GL", icon: FileSpreadsheet },
      { id: "periods", label: "Περίοδοι", icon: Scale },
    ],
  },
  {
    group: "Ταμείο & συναλλαγές",
    items: [
      { id: "ar", label: "Απαιτήσεις", icon: Wallet },
      { id: "ap", label: "Υποχρεώσεις", icon: Receipt },
      { id: "banking", label: "Τράπεζες", icon: Landmark },
    ],
  },
  {
    group: "Φορολογία",
    items: [
      { id: "vat", label: "ΦΠΑ", icon: Calculator },
      { id: "mydata", label: "myDATA", icon: Send },
    ],
  },
  {
    group: "Αναλυτική & οντότητες",
    items: [
      { id: "controlling", label: "CO / IC / Ledgers", icon: Network },
      { id: "dimensions", label: "Διαστάσεις", icon: Boxes },
      { id: "assets", label: "Πάγια", icon: Package },
      { id: "purchases", label: "Αγορές FI", icon: Building2 },
    ],
  },
];

export function FinanceHubClient({
  canWrite,
  accountCount,
  period,
  periods,
  kpis,
  journals,
  arRows,
  apRows,
  purchaseInvoices,
  vat,
  myData,
  myDataEnv,
  draftJournalCount,
  pendingMyData,
}: {
  canWrite: boolean;
  accountCount: number;
  period: { code: string; status: string };
  periods: Period[];
  kpis: {
    cash7: number;
    cash30: number;
    overdueAr: number;
    arTotal: number;
    apTotal: number;
    vatPayable: number;
  };
  journals: Journal[];
  arRows: Parameters<typeof FinanceOpsClient>[0]["arRows"];
  apRows: Parameters<typeof FinanceOpsClient>[0]["apRows"];
  purchaseInvoices: Array<{
    id: string;
    number: string;
    status: string;
    total: number;
    paidAmount: number;
    supplierName: string;
    issueDate: string;
  }>;
  vat: Parameters<typeof FinanceOpsClient>[0]["vat"];
  myData: Parameters<typeof FinanceOpsClient>[0]["myData"];
  myDataEnv: "simulator" | "test" | "prod";
  draftJournalCount: number;
  pendingMyData: number;
}) {
  const [section, setSection] = useState<Section>("overview");

  const openMonths = useMemo(
    () => periods.filter((p) => p.kind === "MONTH" && p.status === "OPEN").length,
    [periods],
  );

  const accountingTab =
    section === "gl"
      ? "reports"
      : section === "periods"
        ? "periods"
        : section === "controlling"
          ? "controlling"
          : section === "dimensions"
            ? "dimensions"
            : section === "assets"
              ? "assets"
              : section === "purchases"
                ? "purchases"
                : null;

  const opsTab =
    section === "ar"
      ? "ar"
      : section === "ap"
        ? "ap"
        : section === "vat"
          ? "vat"
          : section === "banking"
            ? "banking"
            : section === "mydata"
              ? "mydata"
              : null;

  return (
    <div className="fi-hub space-y-5">
      <style jsx global>{`
        .fi-hub {
          --fi-ink: #0c1b2a;
          --fi-accent: #0f766e;
        }
        .fi-hero {
          background:
            radial-gradient(900px 280px at 0% 0%, rgba(15, 118, 110, 0.12), transparent 55%),
            radial-gradient(700px 240px at 100% 0%, rgba(14, 116, 144, 0.1), transparent 50%),
            linear-gradient(180deg, #eef6f5 0%, #f8fafc 70%);
          border: 1px solid rgba(15, 118, 110, 0.12);
        }
      `}</style>

      <div className="fi-hero rounded-[1.75rem] px-5 py-5 sm:px-6">
        <PageHeader
          title="Οικονομικά"
          description="Ενοποιημένο FI hub · ημερολόγιο · AR/AP · ΦΠΑ · myDATA · CO"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/settings/gl-accounts"
                className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white/90 px-3 text-sm font-medium hover:bg-white"
              >
                Λογιστικό σχέδιο ({accountCount})
              </Link>
              <Link
                href="/settings/integrations"
                className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white/90 px-3 text-sm font-medium hover:bg-white"
              >
                myDATA: {myDataEnv}
              </Link>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => setSection("journals")}
                  className="inline-flex h-9 items-center rounded-xl bg-[var(--fi-ink)] px-3 text-sm font-medium text-white"
                >
                  + Άρθρο
                </button>
              ) : null}
            </div>
          }
        />

        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Badge tone="teal">Χρήση {period.code}</Badge>
          <Badge tone={period.status === "OPEN" ? "emerald" : "rose"}>
            {period.status === "OPEN" ? "Ανοιχτή" : "Κλειστή"}
          </Badge>
          <Badge tone="slate">{openMonths} ανοιχτοί μήνες</Badge>
          {draftJournalCount > 0 ? (
            <Badge tone="rose">{draftJournalCount} πρόχειρα άρθρα</Badge>
          ) : null}
          {pendingMyData > 0 ? (
            <Badge tone="teal">{pendingMyData} myDATA σε ουρά</Badge>
          ) : null}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["Cash 7ημ.", kpis.cash7, () => setSection("ar")],
              ["Cash 30ημ.", kpis.cash30, () => setSection("ar")],
              ["Ληξιπρ. AR", kpis.overdueAr, () => setSection("ar"), true],
              ["AR σύνολο", kpis.arTotal, () => setSection("ar")],
              ["AP σύνολο", kpis.apTotal, () => setSection("ap")],
              ["ΦΠΑ", kpis.vatPayable, () => setSection("vat")],
            ] as Array<[string, number, () => void, boolean?]>
          ).map(([label, value, onClick, danger]) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="rounded-2xl border border-white/70 bg-white/80 px-3 py-2.5 text-left transition hover:border-teal-300 hover:shadow-sm"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {label}
              </p>
              <p
                className={cn(
                  "mt-1 text-lg font-semibold tabular-nums",
                  danger ? "text-rose-700" : "text-[var(--fi-ink)]",
                )}
              >
                {formatEUR(value)}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="soft-panel h-fit space-y-4 p-3 lg:sticky lg:top-20">
          {NAV.map((group) => (
            <div key={group.group}>
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {group.group}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSection(item.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition",
                          active
                            ? "bg-[var(--fi-ink)] text-white shadow-md shadow-slate-900/10"
                            : "text-slate-600 hover:bg-slate-100",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 opacity-80" />
                        {item.label}
                        {item.id === "mydata" && pendingMyData > 0 ? (
                          <span
                            className={cn(
                              "ml-auto rounded-md px-1.5 text-[10px] font-semibold",
                              active ? "bg-white/20" : "bg-teal-100 text-teal-800",
                            )}
                          >
                            {pendingMyData}
                          </span>
                        ) : null}
                        {item.id === "journals" && draftJournalCount > 0 ? (
                          <span
                            className={cn(
                              "ml-auto rounded-md px-1.5 text-[10px] font-semibold",
                              active ? "bg-white/20" : "bg-rose-100 text-rose-800",
                            )}
                          >
                            {draftJournalCount}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {section === "overview" ? (
            <OverviewPanel
              kpis={kpis}
              journals={journals.slice(0, 5)}
              myDataEnv={myDataEnv}
              pendingMyData={pendingMyData}
              purchaseInvoices={purchaseInvoices.slice(0, 5)}
              onGo={setSection}
              canWrite={canWrite}
            />
          ) : null}

          {section === "journals" ? (
            <section className="soft-panel p-4">
              <FinanceJournalClient
                initialJournals={journals}
                canWrite={canWrite}
                showActions
              />
            </section>
          ) : null}

          {accountingTab ? (
            <AccountingHubClient
              canWrite={canWrite}
              initialPeriods={periods}
              forcedTab={accountingTab}
              hideOuterChrome
            />
          ) : null}

          {opsTab ? (
            <FinanceOpsClient
              arRows={arRows}
              apRows={apRows}
              vat={vat}
              myData={myData}
              canWrite={canWrite}
              forcedTab={opsTab}
              hideTabBar
              myDataEnv={myDataEnv}
              purchaseInvoices={purchaseInvoices}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OverviewPanel({
  kpis,
  journals,
  myDataEnv,
  pendingMyData,
  purchaseInvoices,
  onGo,
  canWrite,
}: {
  kpis: {
    cash7: number;
    cash30: number;
    overdueAr: number;
    arTotal: number;
    apTotal: number;
    vatPayable: number;
  };
  journals: Journal[];
  myDataEnv: string;
  pendingMyData: number;
  purchaseInvoices: Array<{
    number: string;
    status: string;
    total: number;
    supplierName: string;
  }>;
  onGo: (s: Section) => void;
  canWrite: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Νέο άρθρο", "Πολυγραμμικό GL", "journals"],
            ["Απαιτήσεις", formatEUR(kpis.arTotal), "ar"],
            ["myDATA ουρά", `${pendingMyData} · ${myDataEnv}`, "mydata"],
            ["Κλείσιμο περιόδου", "Μήνες / χρήση 80.xx", "periods"],
          ] as const
        ).map(([title, sub, target]) => (
          <button
            key={title}
            type="button"
            onClick={() => onGo(target)}
            className="soft-panel rounded-2xl px-4 py-3 text-left transition hover:border-teal-300"
          >
            <p className="text-sm font-semibold text-ink-950">{title}</p>
            <p className="mt-1 text-xs text-slate-500">{sub}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="soft-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Τελευταία άρθρα</h3>
            <button
              type="button"
              className="text-xs font-medium text-teal-700"
              onClick={() => onGo("journals")}
            >
              Όλα →
            </button>
          </div>
          {journals.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Δεν υπάρχουν άρθρα ακόμη
              {canWrite ? " — δημιούργησε από Ημερολόγιο" : ""}
            </p>
          ) : (
            <ul className="space-y-2">
              {journals.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-mono text-xs text-teal-800">
                      {j.number}
                    </span>{" "}
                    {j.description || j.sourceType || "—"}
                  </span>
                  <Badge tone={j.status === "POSTED" ? "teal" : "slate"}>
                    {j.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="soft-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Τιμολόγια αγοράς</h3>
            <button
              type="button"
              className="text-xs font-medium text-teal-700"
              onClick={() => onGo("purchases")}
            >
              FI αγορές →
            </button>
          </div>
          {purchaseInvoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Καμία αγορά FI ακόμη
            </p>
          ) : (
            <ul className="space-y-2">
              {purchaseInvoices.map((p) => (
                <li
                  key={p.number}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
                >
                  <span>
                    {p.number} · {p.supplierName}
                  </span>
                  <span className="tabular-nums">{formatEUR(p.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
