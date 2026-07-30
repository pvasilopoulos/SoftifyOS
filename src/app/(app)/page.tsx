import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  PackageMinus,
  Receipt,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import {
  demoInvoices,
  formatEUR,
  statusLabel,
  statusTone,
} from "@/modules/sales/demo-data";

export const metadata = { title: "Πίνακας ελέγχου" };

const kpis = [
  { label: "Εισπράξεις μήνα", value: "€48.2κ", delta: "+12%" },
  { label: "Open AR", value: "€126.4κ", delta: "−3%" },
  { label: "Παραγγελίες σήμερα", value: "37", delta: "+5" },
  { label: "Υγεία stock", value: "94%", delta: "σταθερό" },
];

const workQueue = [
  {
    id: "1",
    title: "2 ληξιπρόθεσμα τιμολόγια",
    meta: "Αιγαίο Foods · Αττική Supplies",
    tone: "rose" as const,
    icon: Receipt,
  },
  {
    id: "2",
    title: "Χαμηλό απόθεμα · SKU-1842",
    meta: "Αποθήκη κεντρική · 6 τεμ.",
    tone: "amber" as const,
    icon: PackageMinus,
  },
  {
    id: "3",
    title: "Έγκριση αγοράς PO-2291",
    meta: "Αναμονή από CFO",
    tone: "teal" as const,
    icon: Clock3,
  },
];

export default function DashboardPage() {
  const recent = demoInvoices.slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Καλημέρα, Μαρία"
        description="Τι χρειάζεται ενέργεια σήμερα στην Ακρόπολις ΑΕ."
        actions={
          <Link
            href="/invoices?new=1"
            className="hidden h-10 items-center justify-center rounded-xl bg-teal-600 px-4 text-sm font-medium text-white shadow-sm shadow-teal-900/10 hover:bg-teal-700 sm:inline-flex"
          >
            Νέο τιμολόγιο
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi, i) => (
          <div
            key={kpi.label}
            className="soft-panel animate-rise px-4 py-4"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="text-2xl font-semibold tracking-tight text-ink-950">
                {kpi.value}
              </p>
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-teal-700">
                <ArrowUpRight size={12} />
                {kpi.delta}
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-teal-500/80"
                style={{ width: `${55 + i * 10}%` }}
              />
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="soft-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-ink-950">
                Χρειάζεται ενέργεια
              </h2>
              <p className="text-sm text-slate-500">Work queue · σήμερα</p>
            </div>
            <Badge tone="amber">3 ανοιχτά</Badge>
          </div>
          <ul className="space-y-2.5">
            {workQueue.map((item) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 px-3.5 py-3"
                >
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm">
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{item.title}</p>
                    <p className="text-xs text-slate-500">{item.meta}</p>
                  </div>
                  <Badge tone={item.tone}>ενέργεια</Badge>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="soft-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink-950">
                Πρόσφατη δραστηριότητα
              </h2>
              <p className="text-sm text-slate-500">Τελευταία παραστατικά</p>
            </div>
            <Link
              href="/invoices"
              className="text-sm font-medium text-teal-700 hover:text-teal-800"
            >
              Όλα
            </Link>
          </div>
          <ul className="space-y-2">
            {recent.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/invoices/${inv.id}`}
                  className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 text-[11px] font-semibold text-white">
                    {inv.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {inv.number}
                    </p>
                    <p className="truncate text-xs text-slate-500">{inv.customer}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{formatEUR(inv.amount)}</p>
                    <Badge tone={statusTone[inv.status]} className="mt-1">
                      {statusLabel[inv.status]}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="soft-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <p className="font-medium text-ink-950">Template v2 ενεργό</p>
            <p className="text-sm text-slate-500">
              Desktop shell + mobile tabs · multi-tenant ready foundation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <AlertTriangle size={14} className="text-amber-500" />
          Demo data — χωρίς σύνδεση βάσης ακόμη
        </div>
      </section>
    </div>
  );
}
