"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Boxes,
  Building2,
  Calculator,
  FileSpreadsheet,
  Filter,
  Landmark,
  LayoutDashboard,
  Network,
  Package,
  Receipt,
  Scale,
  Search,
  Send,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { AccountingHubClient } from "./accounting-hub-client";
import { FinanceOpsClient } from "./finance-ops-client";
import { FinanceJournalClient } from "./finance-journal-client";
import {
  defaultFinanceFilters,
  periodPresetDates,
  type FinanceFilters,
} from "./finance-filters";

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
  entryDate?: string;
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

type LegalEntityOpt = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
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
  hint: string;
  items: Array<{
    id: Section;
    label: string;
    hint: string;
    icon: typeof Wallet;
  }>;
}> = [
  {
    group: "Αρχική",
    hint: "Τι χρειάζεται προσοχή σήμερα",
    items: [
      {
        id: "overview",
        label: "Επισκόπηση",
        hint: "KPIs & εκκρεμότητες",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    group: "Καθημερινή λογιστική",
    hint: "Άρθρα & ισοζύγια",
    items: [
      {
        id: "journals",
        label: "Ημερολόγιο",
        hint: "Καταχώρηση / post άρθρων",
        icon: BookOpen,
      },
      {
        id: "gl",
        label: "Ισοζύγιο & αναφορές",
        hint: "TB · Αποτελέσματα · Ισολογισμός",
        icon: FileSpreadsheet,
      },
      {
        id: "periods",
        label: "Περίοδοι",
        hint: "Άνοιγμα / κλείσιμο μηνών",
        icon: Scale,
      },
    ],
  },
  {
    group: "Εισπράξεις & πληρωμές",
    hint: "Πελάτες · προμηθευτές · τράπεζες",
    items: [
      {
        id: "ar",
        label: "Απαιτήσεις πελατών",
        hint: "Ανοιχτά τιμολόγια / aging",
        icon: Wallet,
      },
      {
        id: "ap",
        label: "Υποχρεώσεις",
        hint: "Αγορές FI & ανοιχτά PO",
        icon: Receipt,
      },
      {
        id: "banking",
        label: "Τράπεζες",
        hint: "Λογαριασμοί & matching",
        icon: Landmark,
      },
    ],
  },
  {
    group: "Φορολογία",
    hint: "ΦΠΑ & ΑΑΔΕ",
    items: [
      { id: "vat", label: "ΦΠΑ περιόδου", hint: "Εκροές / εισροές", icon: Calculator },
      { id: "mydata", label: "myDATA", hint: "Ουρά διαβίβασης", icon: Send },
    ],
  },
  {
    group: "Προχωρημένα",
    hint: "Αναλυτική · πάγια · αγορές",
    items: [
      {
        id: "controlling",
        label: "CO / IC / Ledgers",
        hint: "Κατανομές & παράλληλα βιβλία",
        icon: Network,
      },
      {
        id: "dimensions",
        label: "Διαστάσεις",
        hint: "Εταιρείες & κέντρα κόστους",
        icon: Boxes,
      },
      { id: "assets", label: "Πάγια", hint: "Αποσβέσεις", icon: Package },
      {
        id: "purchases",
        label: "Αγορές FI",
        hint: "Τιμολόγια αγοράς + GL",
        icon: Building2,
      },
    ],
  },
];

const SECTION_HELP: Record<Section, { title: string; body: string }> = {
  overview: {
    title: "Επισκόπηση",
    body: "Ξεκίνα από εδώ: ληξιπρόθεσμα, πρόχειρα άρθρα, myDATA ουρά.",
  },
  journals: {
    title: "Ημερολόγιο άρθρων",
    body: "Καταχώρησε, οριστικοποίησε (Post) ή αντιστρέψε λογιστικά άρθρα. Χρησιμοποίησε τα φίλτρα ημερομηνίας/κατάστασης πάνω.",
  },
  gl: {
    title: "Ισοζύγιο & λογιστικές αναφορές",
    body: "Ισοζύγιο, αποτελέσματα χρήσης και ισολογισμός για την επιλεγμένη περίοδο / εταιρεία.",
  },
  periods: {
    title: "Λογιστικές περίοδοι",
    body: "Άνοιγμα ή κλείσιμο μηνών και χρήσης. Το κλείσιμο χρήσης δημιουργεί άρθρα 80.xx.",
  },
  ar: {
    title: "Απαιτήσεις πελατών (AR)",
    body: "Ανοιχτά τιμολόγια πώλησης με aging. Φίλτραρε με αναζήτηση πελάτη ή bucket ληξιπρόθεσμων.",
  },
  ap: {
    title: "Υποχρεώσεις (AP)",
    body: "Ανοιχτές αγορές FI και παραγγελίες αγορών προς πληρωμή.",
  },
  vat: {
    title: "ΦΠΑ περιόδου",
    body: "Σύνοψη ΦΠΑ εκροών / εισροών για το διάστημα των φίλτρων.",
  },
  banking: {
    title: "Τράπεζες",
    body: "Τραπεζικοί λογαριασμοί και συμψηφισμός κινήσεων.",
  },
  mydata: {
    title: "myDATA / ΑΑΔΕ",
    body: "Ουρά διαβίβασης παραστατικών. Έλεγξε περιβάλλον (simulator/test/prod) στις Integrations.",
  },
  controlling: {
    title: "Controlling",
    body: "Κατανομές κόστους, intercompany matching και parallel ledgers.",
  },
  dimensions: {
    title: "Διαστάσεις",
    body: "Νομικές οντότητες (Companies) και κέντρα κόστους για αναλυτική.",
  },
  assets: {
    title: "Πάγια",
    body: "Μητρώο παγίων και μηνιαίες αποσβέσεις με GL.",
  },
  purchases: {
    title: "Αγορές FI",
    body: "Τιμολόγια αγοράς με αυτόματο posting σε λογαριασμούς εξόδων / ΦΠΑ εισροών.",
  },
};

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
  legalEntities = [],
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
  legalEntities?: LegalEntityOpt[];
}) {
  const year = new Date().getFullYear();
  const [section, setSection] = useState<Section>("overview");
  const [filters, setFilters] = useState<FinanceFilters>(() =>
    defaultFinanceFilters(year),
  );

  const openMonths = useMemo(
    () => periods.filter((p) => p.kind === "MONTH" && p.status === "OPEN").length,
    [periods],
  );
  const monthPeriods = useMemo(
    () => periods.filter((p) => p.kind === "MONTH").slice().reverse(),
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

  const help = SECTION_HELP[section];
  const filterSummary = useMemo(() => {
    const bits = [`${filters.from} → ${filters.to}`];
    if (filters.legalEntityId) {
      const le = legalEntities.find((e) => e.id === filters.legalEntityId);
      bits.push(le ? `${le.code}` : "εταιρεία");
    }
    if (filters.q.trim()) bits.push(`«${filters.q.trim()}»`);
    if (filters.status !== "ALL") bits.push(filters.status);
    if (filters.aging !== "ALL") bits.push(`aging ${filters.aging}`);
    return bits.join(" · ");
  }, [filters, legalEntities]);

  const applyPeriod = (periodId: string) => {
    const p = periods.find((x) => x.id === periodId);
    if (!p) {
      setFilters((f) => ({ ...f, periodId: "" }));
      return;
    }
    if (p.kind === "YEAR") {
      setFilters((f) => ({
        ...f,
        periodId,
        from: `${p.year}-01-01`,
        to: `${p.year}-12-31`,
      }));
      return;
    }
    if (p.month != null) {
      const from = new Date(Date.UTC(p.year, p.month - 1, 1));
      const to = new Date(Date.UTC(p.year, p.month, 0));
      setFilters((f) => ({
        ...f,
        periodId,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      }));
    }
  };

  return (
    <div className="fi-hub space-y-4">
      <style jsx global>{`
        .fi-hub {
          --fi-ink: #0c1b2a;
          --fi-accent: #0f766e;
        }
        .fi-hero {
          background:
            radial-gradient(900px 280px at 0% 0%, rgba(15, 118, 110, 0.12), transparent 55%),
            linear-gradient(180deg, #eef6f5 0%, #f8fafc 70%);
          border: 1px solid rgba(15, 118, 110, 0.12);
        }
      `}</style>

      <div className="fi-hero rounded-[1.75rem] px-5 py-4 sm:px-6">
        <PageHeader
          title="Οικονομικά"
          description="Χώρος εργασίας λογιστή · ένα μενού · καθολικά φίλτρα · ξεκάθαρες ενότητες"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/settings/gl-accounts"
                className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white/90 px-3 text-sm font-medium hover:bg-white"
              >
                Λογιστικό σχέδιο ({accountCount})
              </Link>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => setSection("journals")}
                  className="inline-flex h-9 items-center rounded-xl bg-[var(--fi-ink)] px-3 text-sm font-medium text-white"
                >
                  + Νέο άρθρο
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
            <Badge tone="rose">{draftJournalCount} πρόχειρα</Badge>
          ) : null}
          {pendingMyData > 0 ? (
            <Badge tone="teal">{pendingMyData} myDATA</Badge>
          ) : null}
        </div>

        {section === "overview" ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["Εισπρακτέα 7ημ.", kpis.cash7, "ar"],
                ["Εισπρακτέα 30ημ.", kpis.cash30, "ar"],
                ["Ληξιπρόθεσμα", kpis.overdueAr, "ar", true],
                ["Απαιτήσεις", kpis.arTotal, "ar"],
                ["Υποχρεώσεις", kpis.apTotal, "ap"],
                ["ΦΠΑ προς ΑΑΔΕ", kpis.vatPayable, "vat"],
              ] as Array<[string, number, Section, boolean?]>
            ).map(([label, value, target, danger]) => (
              <button
                key={label}
                type="button"
                onClick={() => setSection(target)}
                className="rounded-2xl border border-white/70 bg-white/80 px-3 py-2.5 text-left transition hover:border-teal-300"
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
        ) : null}
      </div>

      {/* Global filters — sticky so the accountant always sees the active period */}
      <section className="soft-panel sticky top-14 z-20 space-y-3 border border-teal-100/80 bg-white/95 p-3 shadow-sm backdrop-blur sm:p-4 lg:top-16">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <Filter className="h-4 w-4 text-teal-700" />
            Φίλτρα εργασίας
            <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800">
              ισχύουν σε όλες τις ενότητες
            </span>
          </div>
          <p className="text-xs text-slate-500">{filterSummary}</p>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <label className="text-xs text-slate-600 xl:col-span-1">
            Από
            <input
              type="date"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              value={filters.from}
              onChange={(e) =>
                setFilters((f) => ({ ...f, from: e.target.value, periodId: "" }))
              }
            />
          </label>
          <label className="text-xs text-slate-600 xl:col-span-1">
            Έως
            <input
              type="date"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              value={filters.to}
              onChange={(e) =>
                setFilters((f) => ({ ...f, to: e.target.value, periodId: "" }))
              }
            />
          </label>
          <label className="text-xs text-slate-600 xl:col-span-1">
            Περίοδος
            <select
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              value={filters.periodId}
              onChange={(e) => applyPeriod(e.target.value)}
            >
              <option value="">Χειροκίνητο διάστημα</option>
              {monthPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.status === "OPEN" ? "ανοιχτή" : "κλειστή"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600 xl:col-span-1">
            Εταιρεία
            <select
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              value={filters.legalEntityId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, legalEntityId: e.target.value }))
              }
            >
              <option value="">Όλες</option>
              {legalEntities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} · {e.name}
                  {e.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600 xl:col-span-2">
            Αναζήτηση
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-sm"
                placeholder="Πελάτης, προμηθευτής, άρθρο, λογαριασμός…"
                value={filters.q}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, q: e.target.value }))
                }
              />
            </div>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Γρήγορα
          </span>
          {(
            [
              ["Μήνας", "month"],
              ["Τρίμηνο", "quarter"],
              ["YTD", "ytd"],
              ["Έτος", "year"],
            ] as const
          ).map(([label, kind]) => (
            <button
              key={kind}
              type="button"
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium hover:border-teal-300"
              onClick={() => {
                const d = periodPresetDates(kind);
                setFilters((f) => ({ ...f, ...d, periodId: "" }));
              }}
            >
              {label}
            </button>
          ))}

          {(section === "journals" || section === "mydata") && (
            <select
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  status: e.target.value as FinanceFilters["status"],
                }))
              }
            >
              <option value="ALL">Όλες οι καταστάσεις</option>
              {section === "journals" ? (
                <>
                  <option value="DRAFT">DRAFT</option>
                  <option value="POSTED">POSTED</option>
                  <option value="VOID">VOID</option>
                </>
              ) : (
                <>
                  <option value="PENDING">PENDING</option>
                  <option value="ACCEPTED">ACCEPTED</option>
                  <option value="REJECTED">REJECTED</option>
                </>
              )}
            </select>
          )}

          {section === "ar" ? (
            <select
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
              value={filters.aging}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  aging: e.target.value as FinanceFilters["aging"],
                }))
              }
            >
              <option value="ALL">Όλο το aging</option>
              <option value="current">Εντός προθεσμίας</option>
              <option value="1-30">1–30</option>
              <option value="31-60">31–60</option>
              <option value="61-90">61–90</option>
              <option value="90+">90+</option>
            </select>
          ) : null}

          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => setFilters(defaultFinanceFilters(year))}
          >
            Καθαρισμός
          </Button>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="soft-panel h-fit space-y-4 p-3 lg:sticky lg:top-20">
          {NAV.map((group) => (
            <div key={group.group}>
              <p className="mb-0.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {group.group}
              </p>
              <p className="mb-1.5 px-2 text-[10px] text-slate-400">{group.hint}</p>
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
                          "flex w-full flex-col rounded-xl px-2.5 py-2 text-left transition",
                          active
                            ? "bg-[var(--fi-ink)] text-white shadow-md shadow-slate-900/10"
                            : "text-slate-700 hover:bg-slate-100",
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Icon className="h-3.5 w-3.5 opacity-80" />
                          {item.label}
                          {item.id === "mydata" && pendingMyData > 0 ? (
                            <span
                              className={cn(
                                "ml-auto rounded-md px-1.5 text-[10px] font-semibold",
                                active
                                  ? "bg-white/20"
                                  : "bg-teal-100 text-teal-800",
                              )}
                            >
                              {pendingMyData}
                            </span>
                          ) : null}
                          {item.id === "journals" && draftJournalCount > 0 ? (
                            <span
                              className={cn(
                                "ml-auto rounded-md px-1.5 text-[10px] font-semibold",
                                active
                                  ? "bg-white/20"
                                  : "bg-rose-100 text-rose-800",
                              )}
                            >
                              {draftJournalCount}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 pl-5 text-[10px]",
                            active ? "text-white/70" : "text-slate-400",
                          )}
                        >
                          {item.hint}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-3">
          <div className="rounded-2xl border border-teal-100 bg-teal-50/50 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">{help.title}</h2>
            <p className="mt-0.5 text-xs text-slate-600">{help.body}</p>
          </div>

          {section === "overview" ? (
            <OverviewPanel
              kpis={kpis}
              journals={journals.slice(0, 5)}
              myDataEnv={myDataEnv}
              pendingMyData={pendingMyData}
              draftJournalCount={draftJournalCount}
              overdueAr={kpis.overdueAr}
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
                filters={filters}
              />
            </section>
          ) : null}

          {accountingTab ? (
            <AccountingHubClient
              canWrite={canWrite}
              initialPeriods={periods}
              forcedTab={accountingTab}
              hideOuterChrome
              filters={filters}
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
              filters={filters}
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
  draftJournalCount,
  overdueAr,
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
  draftJournalCount: number;
  overdueAr: number;
  purchaseInvoices: Array<{
    number: string;
    status: string;
    total: number;
    supplierName: string;
  }>;
  onGo: (s: Section) => void;
  canWrite: boolean;
}) {
  const todos = [
    overdueAr > 0
      ? {
          title: "Ληξιπρόθεσμες απαιτήσεις",
          detail: formatEUR(overdueAr),
          target: "ar" as Section,
          tone: "rose" as const,
        }
      : null,
    draftJournalCount > 0
      ? {
          title: "Πρόχειρα άρθρα προς Post",
          detail: `${draftJournalCount} DRAFT`,
          target: "journals" as Section,
          tone: "rose" as const,
        }
      : null,
    pendingMyData > 0
      ? {
          title: "myDATA σε ουρά",
          detail: `${pendingMyData} · ${myDataEnv}`,
          target: "mydata" as Section,
          tone: "teal" as const,
        }
      : null,
    {
      title: "Ισοζύγιο περιόδου",
      detail: "Έλεγχος TB / αποτελεσμάτων",
      target: "gl" as Section,
      tone: "slate" as const,
    },
  ].filter(Boolean) as Array<{
    title: string;
    detail: string;
    target: Section;
    tone: "rose" | "teal" | "slate";
  }>;

  return (
    <div className="space-y-4">
      <section className="soft-panel p-4">
        <h3 className="text-sm font-semibold">Τι χρειάζεται προσοχή</h3>
        <p className="mt-1 text-xs text-slate-500">
          Λίστα εργασίας για τον λογιστή — πάτα για μετάβαση.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {todos.map((t) => (
            <li key={t.title}>
              <button
                type="button"
                onClick={() => onGo(t.target)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-left transition hover:border-teal-300"
              >
                <span>
                  <span className="block text-sm font-medium">{t.title}</span>
                  <span className="text-xs text-slate-500">{t.detail}</span>
                </span>
                <Badge tone={t.tone}>Άνοιγμα</Badge>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Νέο άρθρο", "Ημερολόγιο GL", "journals"],
            ["Απαιτήσεις", formatEUR(kpis.arTotal), "ar"],
            ["Υποχρεώσεις", formatEUR(kpis.apTotal), "ap"],
            ["Κλείσιμο περιόδου", "Μήνες / 80.xx", "periods"],
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
