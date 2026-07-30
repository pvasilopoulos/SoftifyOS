"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Filter, Plus, Search } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  demoInvoices,
  formatEUR,
  statusLabel,
  statusTone,
  type InvoiceStatus,
} from "@/modules/sales/demo-data";
import { cn } from "@/shared/lib/cn";

const tabs: { id: "all" | InvoiceStatus; label: string }[] = [
  { id: "all", label: "Όλα" },
  { id: "issued", label: "Εκκρεμή" },
  { id: "overdue", label: "Ληξιπρόθεσμα" },
  { id: "paid", label: "Πληρωμένα" },
  { id: "draft", label: "Πρόχειρα" },
];

export default function InvoicesPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(demoInvoices[0]?.id ?? null);

  const filtered = useMemo(() => {
    return demoInvoices.filter((inv) => {
      const matchesTab =
        tab === "all"
          ? true
          : tab === "issued"
            ? inv.status === "issued" || inv.status === "partial"
            : inv.status === tab;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        inv.number.toLowerCase().includes(q) ||
        inv.customer.toLowerCase().includes(q);
      return matchesTab && matchesQuery;
    });
  }, [tab, query]);

  const preview = demoInvoices.find((i) => i.id === selected) ?? filtered[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Τιμολόγια"
        description="Workspace παραστατικών · cursor-ready list pattern"
        actions={
          <Button className="gap-1.5">
            <Plus size={16} />
            Νέο τιμολόγιο
          </Button>
        }
      />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition",
              tab === t.id
                ? "bg-ink-950 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="soft-surface flex flex-1 items-center gap-2 px-3 py-2.5">
          <Search size={16} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση αριθμού ή πελάτη..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </label>
        <Button variant="secondary" className="shrink-0">
          <Filter size={16} />
          Φίλτρα
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <section className="soft-panel overflow-hidden">
          <div className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[1.1fr_1.2fr_0.7fr_0.8fr_0.9fr] md:gap-3">
            <span>Αριθμός</span>
            <span>Πελάτης</span>
            <span>Ημερομηνία</span>
            <span className="text-right">Ποσό</span>
            <span>Κατάσταση</span>
          </div>

          <ul className="divide-y divide-slate-100">
            {filtered.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/invoices/${inv.id}`}
                  onClick={() => setSelected(inv.id)}
                  onMouseEnter={() => setSelected(inv.id)}
                  className={cn(
                    "block px-4 py-3 transition hover:bg-slate-50 md:grid md:grid-cols-[1.1fr_1.2fr_0.7fr_0.8fr_0.9fr] md:items-center md:gap-3",
                    selected === inv.id && "bg-teal-50/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 md:block">
                    <p className="text-sm font-semibold text-ink-950">{inv.number}</p>
                    <p className="text-sm font-medium md:hidden">{formatEUR(inv.amount)}</p>
                  </div>
                  <div className="mt-1 flex items-center gap-2 md:mt-0">
                    <span className="hidden h-7 w-7 items-center justify-center rounded-full bg-ink-950 text-[10px] font-semibold text-white md:flex">
                      {inv.initials}
                    </span>
                    <p className="truncate text-sm text-slate-600">{inv.customer}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 md:mt-0 md:text-sm">
                    {inv.issuedAt}
                  </p>
                  <p className="hidden text-right text-sm font-medium md:block">
                    {formatEUR(inv.amount)}
                  </p>
                  <div className="mt-2 md:mt-0">
                    <Badge tone={statusTone[inv.status]}>
                      {statusLabel[inv.status]}
                    </Badge>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100 md:hidden">
                      <div
                        className="h-full bg-teal-500"
                        style={{ width: `${Math.round(inv.paidRatio * 100)}%` }}
                      />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>
              Εμφάνιση {filtered.length} · cursor pagination pattern
            </span>
            <span>Επόμενα →</span>
          </div>
        </section>

        <aside className="soft-panel hidden p-5 xl:block">
          {preview ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">Προεπισκόπηση</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-950">
                    {preview.number}
                  </h2>
                  <p className="text-sm text-slate-500">{preview.customer}</p>
                </div>
                <Badge tone={statusTone[preview.status]}>
                  {statusLabel[preview.status]}
                </Badge>
              </div>
              <p className="text-3xl font-semibold tracking-tight text-ink-950">
                {formatEUR(preview.amount)}
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>Έκδοση</span>
                  <span className="text-ink-900">{preview.issuedAt}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Λήξη</span>
                  <span className="text-ink-900">{preview.dueAt}</span>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-slate-500">
                    <span>Είσπραξη</span>
                    <span className="text-ink-900">
                      {Math.round(preview.paidRatio * 100)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${Math.round(preview.paidRatio * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm">PDF</Button>
                <Button size="sm" variant="secondary">
                  Αποστολή
                </Button>
                <Button size="sm" variant="secondary">
                  Είσπραξη
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Επιλέξτε τιμολόγιο</p>
          )}
        </aside>
      </div>
    </div>
  );
}
