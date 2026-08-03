"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import {
  calcInvoiceTotals,
  calcLineTotals,
  formatEUR,
} from "@/modules/sales/invoice-utils";
import { SeriesPicker } from "@/modules/documents/series-picker";
import { invoiceKindLabel } from "@/modules/documents/series";
import { maybeAutoPrintAfterIssue, preparePrintWindow } from "@/modules/print-forms/open-invoice-print";

export type InvoiceDocKind = "SALES_INVOICE" | "SALES_CREDIT" | "RETAIL_RECEIPT";

type CustomerOption = { id: string; code: string; name: string };
type BranchOption = {
  id: string;
  code: string;
  name: string;
  spaces: Array<{ id: string; code: string; name: string }>;
};
type LineDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};

function newLine(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: "",
    quantity: "1",
    unitPrice: "",
    vatRate: "24",
  };
}

export function NewInvoiceForm({ kind }: { kind: InvoiceDocKind }) {
  const router = useRouter();
  const kindTitle = invoiceKindLabel[kind];

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [statusOptionId, setStatusOptionId] = useState("");
  const [statusOptions, setStatusOptions] = useState<
    Array<{ id: string; code: string; name: string; workflow: string }>
  >([]);
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);

  const selectedStatus = useMemo(
    () => statusOptions.find((s) => s.id === statusOptionId) ?? null,
    [statusOptions, statusOptionId],
  );
  const issuesNow = selectedStatus?.workflow === "ISSUED";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      try {
        const [custRes, statusRes] = await Promise.all([
          fetch("/api/customers?limit=50&status=ACTIVE"),
          fetch("/api/settings/invoice-statuses?selectableOnCreate=1"),
        ]);
        const custData = (await custRes.json()) as {
          items?: CustomerOption[];
          error?: string;
        };
        const statusData = (await statusRes.json()) as {
          items?: Array<{
            id: string;
            code: string;
            name: string;
            workflow: string;
          }>;
        };
        if (!cancelled) {
          setCustomers(custData.items ?? []);
          const opts = statusData.items ?? [];
          setStatusOptions(opts);
          const draft =
            opts.find((o) => o.code === "DRAFT") ??
            opts.find((o) => o.workflow === "DRAFT") ??
            opts[0];
          if (draft) setStatusOptionId(draft.id);
          if (!custRes.ok) setError(custData.error || "Αποτυχία φόρτωσης πελατών");
        }
      } catch {
        if (!cancelled) setError("Αποτυχία φόρτωσης πελατών");
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      setLoadingHierarchy(true);
      try {
        const res = await fetch(`/api/customers/${customerId}`);
        const data = (await res.json()) as {
          item?: { branches: BranchOption[] };
          error?: string;
        };
        if (!cancelled) {
          setBranches(data.item?.branches ?? []);
          if (!res.ok) setError(data.error || "Αποτυχία φόρτωσης υποκαταστημάτων");
        }
      } catch {
        if (!cancelled) setError("Αποτυχία φόρτωσης υποκαταστημάτων");
      } finally {
        if (!cancelled) setLoadingHierarchy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const spaces = useMemo(() => {
    const branch = branches.find((b) => b.id === branchId);
    return branch?.spaces ?? [];
  }, [branches, branchId]);

  const totals = useMemo(() => {
    const parsed = lines.map((line) => ({
      quantity: Number(line.quantity) || 0,
      unitPrice: Number(line.unitPrice) || 0,
      vatRate: Number(line.vatRate) || 0,
    }));
    return calcInvoiceTotals(parsed);
  }, [lines]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    if (!customerId) {
      setError("Επιλέξτε πελάτη");
      setPending(false);
      return;
    }
    if (!seriesId) {
      setError("Επιλέξτε σειρά παραστατικού");
      setPending(false);
      return;
    }

    const printWin = issuesNow ? preparePrintWindow() : null;
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        branchId: branchId || null,
        spaceId: spaceId || null,
        seriesId,
        kind,
        statusOptionId: statusOptionId || null,
        dueAt: dueAt || null,
        notes: notes.trim() || null,
        lines: lines.map((line) => ({
          description: line.description.trim(),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          vatRate: Number(line.vatRate),
        })),
      }),
    });
    const data = (await res.json()) as {
      item?: {
        id: string;
        status?: string;
        series?: {
          printPrinter?: string | null;
          printCopies?: number | null;
        } | null;
      };
      error?: string;
    };
    setPending(false);
    if (!res.ok) {
      printWin?.close();
      setError(data.error || "Αποτυχία δημιουργίας");
      return;
    }
    const created = data.item!;
    if (created.status === "ISSUED" || issuesNow) {
      maybeAutoPrintAfterIssue(created.id, created.series, printWin);
    } else {
      printWin?.close();
    }
    router.push(`/invoices/${created.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Πίσω στα παραστατικά
      </Link>
      <PageHeader
        title={`Νέο ${kindTitle.toLowerCase()}`}
        description="Επιλέξτε σειρά αρίθμησης, πελάτη και γραμμές."
      />

      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["SALES_INVOICE", "Τιμολόγιο"],
            ["SALES_CREDIT", "Πιστωτικό"],
            ["RETAIL_RECEIPT", "ΑΠΥ"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={k === "SALES_INVOICE" ? "/invoices/new" : `/invoices/new?kind=${k}`}
            className={
              kind === k
                ? "rounded-xl bg-teal-600 px-3 py-1.5 font-medium text-white"
                : "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            }
          >
            {label}
          </Link>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <section className="soft-panel space-y-4 p-5">
          <h2 className="text-sm font-semibold text-ink-900">Στοιχεία</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <SeriesPicker
              key={kind}
              kind={kind}
              value={seriesId}
              onChange={setSeriesId}
            />

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Πελάτης *</span>
              <select
                required
                value={customerId}
                disabled={loadingCustomers}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setBranches([]);
                  setBranchId("");
                  setSpaceId("");
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              >
                <option value="">
                  {loadingCustomers ? "Φόρτωση..." : "Επιλέξτε πελάτη"}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Υποκατάστημα</span>
              <select
                value={branchId}
                disabled={!customerId || loadingHierarchy}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setSpaceId("");
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
              >
                <option value="">— Προαιρετικό —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Χώρος</span>
              <select
                value={spaceId}
                disabled={!branchId}
                onChange={(e) => setSpaceId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
              >
                <option value="">— Προαιρετικό —</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium">
                <span>Κατάσταση</span>
                <Link
                  href="/settings/invoice-statuses"
                  className="text-xs font-normal text-teal-700 hover:underline"
                >
                  Διαχείριση
                </Link>
              </span>
              <select
                value={statusOptionId}
                onChange={(e) => setStatusOptionId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              >
                {statusOptions.length === 0 ? (
                  <option value="">— Φόρτωση —</option>
                ) : null}
                {statusOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Ημ. λήξης</span>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Σημειώσεις</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
            </label>
          </div>
        </section>

        <section className="soft-panel space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-900">Γραμμές</h2>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              <Plus size={14} />
              Γραμμή
            </Button>
          </div>

          <div className="space-y-3">
            {lines.map((line, idx) => {
              const { lineTotal } = calcLineTotals({
                quantity: Number(line.quantity) || 0,
                unitPrice: Number(line.unitPrice) || 0,
                vatRate: Number(line.vatRate) || 0,
              });
              return (
                <div
                  key={line.key}
                  className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-12"
                >
                  <label className="block sm:col-span-5">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Περιγραφή {idx + 1} *
                    </span>
                    <input
                      required
                      value={line.description}
                      onChange={(e) =>
                        updateLine(line.key, { description: e.target.value })
                      }
                      placeholder="Υπηρεσία / προϊόν"
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Ποσότητα
                    </span>
                    <input
                      required
                      type="number"
                      min="0.001"
                      step="any"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.key, { quantity: e.target.value })
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Τιμή μονάδας
                    </span>
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) =>
                        updateLine(line.key, { unitPrice: e.target.value })
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    />
                  </label>
                  <label className="block sm:col-span-1">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      ΦΠΑ %
                    </span>
                    <input
                      required
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={line.vatRate}
                      onChange={(e) =>
                        updateLine(line.key, { vatRate: e.target.value })
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    />
                  </label>
                  <div className="flex items-end justify-between gap-2 sm:col-span-2">
                    <div>
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Σύνολο
                      </span>
                      <p className="h-10 content-center text-sm font-medium tabular-nums text-ink-900">
                        {formatEUR(lineTotal)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Διαγραφή γραμμής"
                      disabled={lines.length <= 1}
                      onClick={() => removeLine(line.key)}
                    >
                      <Trash2 size={16} className="text-slate-500" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-end gap-1 border-t border-slate-100 pt-4 text-sm">
            <div className="flex w-full max-w-xs justify-between text-slate-600">
              <span>Καθαρή αξία</span>
              <span className="tabular-nums">{formatEUR(totals.subtotal)}</span>
            </div>
            <div className="flex w-full max-w-xs justify-between text-slate-600">
              <span>ΦΠΑ</span>
              <span className="tabular-nums">{formatEUR(totals.vatAmount)}</span>
            </div>
            <div className="flex w-full max-w-xs justify-between text-base font-semibold text-ink-900">
              <span>Σύνολο</span>
              <span className="tabular-nums">{formatEUR(totals.total)}</span>
            </div>
          </div>
        </section>

        {error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending || !seriesId}>
            {pending
              ? "Αποθήκευση..."
              : issuesNow
                ? `Έκδοση ${kindTitle.toLowerCase()}`
                : "Αποθήκευση πρόχειρου"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/invoices")}
          >
            Ακύρωση
          </Button>
        </div>
      </form>
    </div>
  );
}
