"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  ClipboardCopy,
  ExternalLink,
  FileText,
  Hash,
  Mail,
  Package,
  Phone,
  Plus,
  Receipt,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  calcLineTotals,
  formatEUR,
  invoiceStatusLabel,
  invoiceStatusTone,
  paidRatio,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";
import { InvoiceActions } from "../invoice-actions";
import { CreditFromInvoice } from "./credit-from-invoice";
import { TransformActionButton } from "@/modules/document-transforms/transform-dialog";

export type InvoiceDetailPayload = {
  id: string;
  number: string;
  status: string;
  kind: string;
  kindLabel: string;
  issuedAt: string | null;
  dueAt: string | null;
  currency: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  paidAmount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    code: string;
    name: string;
    vatNumber: string | null;
    email: string | null;
    phone: string | null;
  };
  branch: { id: string; name: string } | null;
  space: { id: string; name: string } | null;
  site: { id: string; code: string; name: string } | null;
  series: {
    id: string;
    code: string;
    name: string;
    myDataEnabled: boolean;
    myDataInvoiceType: string | null;
    affectsCustomer: string;
    affectsInventory: string;
    glDebitAccount: string | null;
    glCreditAccount: string | null;
    glVatAccount: string | null;
    editableAfterIssue: boolean;
  } | null;
  relatedInvoice: { id: string; number: string; kind: string } | null;
  order: { id: string; number: string } | null;
  lines: Array<{
    id: string;
    position: number;
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    lineTotal: number;
    product: { id: string; sku: string; name: string; unit: string } | null;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    note: string | null;
    paidAt: string;
    changeAmount: number;
  }>;
  creditNotes: Array<{
    id: string;
    number: string;
    status: string;
    total: number;
    createdAt: string;
  }>;
  deliveryNotes: Array<{
    id: string;
    number: string;
    status: string;
    issuedAt: string | null;
  }>;
  myData: Array<{
    id: string;
    status: string;
    mark: string | null;
    uid: string | null;
    invoiceType: string | null;
    createdAt: string;
  }>;
  journals: Array<{
    id: string;
    number: string;
    sourceType: string | null;
    description: string | null;
    postedAt: string | null;
  }>;
  stockMovements: Array<{
    id: string;
    type: string;
    qty: number;
    sku: string;
    productName: string;
    siteCode: string;
    createdAt: string;
  }>;
  audits: Array<{
    id: string;
    action: string;
    createdAt: string;
    userName: string | null;
    meta: unknown;
  }>;
  canWrite: boolean;
};

type TabKey = "lines" | "payments" | "related" | "activity" | "fiscal";

type EditableLine = {
  key: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
};

const TAB_LABEL: Record<TabKey, string> = {
  lines: "Γραμμές",
  payments: "Εισπράξεις",
  related: "Συσχετιζόμενα",
  activity: "Δραστηριότητα",
  fiscal: "Λογιστική / myDATA",
};

const ACTION_LABEL: Record<string, string> = {
  "invoice.create": "Δημιουργία",
  "invoice.update": "Ενημέρωση",
  "invoice.issue": "Έκδοση",
  "invoice.collect": "Είσπραξη",
  "invoice.send": "Αποστολή",
  "invoice.cancel": "Ακύρωση",
  "invoice.credit_from": "Έκδοση πιστωτικού",
};

const METHOD_LABEL: Record<string, string> = {
  CASH: "Μετρητά",
  CARD: "Κάρτα",
  CARD_VIVA: "Κάρτα (Viva)",
  TRANSFER: "Μεταφορά",
  OTHER: "Άλλο",
  GIFT_CARD: "Δωροκάρτα",
  LOYALTY: "Loyalty",
};

function daysUntil(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function toDateInput(iso: string | null) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function lineKey() {
  return `L-${Math.random().toString(36).slice(2, 9)}`;
}

export function InvoiceDetailClient({
  invoice,
}: {
  invoice: InvoiceDetailPayload;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("lines");
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [dueAt, setDueAt] = useState(toDateInput(invoice.dueAt));
  const [editingLines, setEditingLines] = useState(false);
  const [draftLines, setDraftLines] = useState<EditableLine[]>(() =>
    invoice.lines.map((l) => ({
      key: l.id,
      productId: l.product?.id ?? null,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
    })),
  );
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const status = invoice.status as InvoiceStatusKey;
  const balance = Math.max(
    0,
    Math.round((invoice.total - invoice.paidAmount) * 100) / 100,
  );
  const ratio = paidRatio(invoice.paidAmount, invoice.total);
  const dueDays = daysUntil(invoice.dueAt);
  const canCredit =
    (invoice.kind === "SALES_INVOICE" || invoice.kind === "RETAIL_RECEIPT") &&
    status !== "DRAFT" &&
    status !== "CANCELLED";
  const canEdit =
    invoice.canWrite &&
    (status === "DRAFT" ||
      (Boolean(invoice.series?.editableAfterIssue) &&
        status !== "CANCELLED" &&
        status !== "PAID"));
  const canEditNotes = canEdit;
  const canEditLines = canEdit && status === "DRAFT";

  const lineNets = useMemo(
    () =>
      invoice.lines.map((l) => {
        const { net, vat } = calcLineTotals(l);
        return { ...l, net, vat };
      }),
    [invoice.lines],
  );

  const draftTotals = useMemo(() => {
    let subtotal = 0;
    let vatAmount = 0;
    const rows = draftLines.map((l) => {
      const t = calcLineTotals(l);
      subtotal += t.net;
      vatAmount += t.vat;
      return { ...l, ...t };
    });
    return {
      rows,
      subtotal: Math.round(subtotal * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      total: Math.round((subtotal + vatAmount) * 100) / 100,
    };
  }, [draftLines]);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(invoice.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function patchInvoice(body: Record<string, unknown>, okMsg: string) {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Αποτυχία αποθήκευσης",
        );
        return;
      }
      setMessage(okMsg);
      setEditingLines(false);
      router.refresh();
    });
  }

  function saveNotes() {
    if (!canEditNotes) return;
    patchInvoice({ notes: notes || null }, "Οι σημειώσεις αποθηκεύτηκαν");
  }

  function saveDueAt() {
    if (!canEdit) return;
    patchInvoice(
      { dueAt: dueAt || null },
      "Η ημερομηνία λήξης ενημερώθηκε",
    );
  }

  function saveLines() {
    if (!canEditLines) return;
    if (draftLines.length === 0) {
      setError("Χρειάζεται τουλάχιστον μία γραμμή");
      return;
    }
    if (draftLines.some((l) => !l.description.trim())) {
      setError("Όλες οι γραμμές χρειάζονται περιγραφή");
      return;
    }
    patchInvoice(
      {
        lines: draftLines.map((l) => ({
          productId: l.productId,
          description: l.description.trim(),
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
        })),
      },
      "Οι γραμμές αποθηκεύτηκαν",
    );
  }

  async function processMyData(id: string) {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/mydata/submissions/${id}/process`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Αποτυχία myDATA");
        return;
      }
      setMessage(`myDATA ${data.item?.mark ?? "OK"}`);
      router.refresh();
    });
  }

  const counts: Record<TabKey, number> = {
    lines: invoice.lines.length,
    payments: invoice.payments.length,
    related:
      invoice.creditNotes.length +
      invoice.deliveryNotes.length +
      (invoice.order ? 1 : 0) +
      (invoice.relatedInvoice ? 1 : 0),
    activity: invoice.audits.length,
    fiscal: invoice.journals.length + invoice.myData.length + invoice.stockMovements.length,
  };

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/invoices"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Πίσω στα παραστατικά
        </Link>
        <PageHeader
          title={invoice.number}
          description={`${invoice.customer.name}${invoice.branch ? ` · ${invoice.branch.name}` : ""}${invoice.space ? ` · ${invoice.space.name}` : ""}`}
          actions={
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="md"
                  variant="secondary"
                  type="button"
                  onClick={copyNumber}
                >
                  {copied ? <Check size={15} /> : <ClipboardCopy size={15} />}
                  {copied ? "Αντιγράφηκε" : "Αριθμός"}
                </Button>
              </div>
              <InvoiceActions
                invoiceId={invoice.id}
                status={invoice.status}
                total={invoice.total}
                paidAmount={invoice.paidAmount}
                size="md"
                showCollect={invoice.kind !== "SALES_CREDIT"}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <TransformActionButton
                  sourceKind={invoice.kind}
                  sourceId={invoice.id}
                  canWrite={
                    invoice.canWrite && invoice.kind !== "SALES_CREDIT"
                  }
                />
                <CreditFromInvoice invoiceId={invoice.id} canCredit={canCredit} />
              </div>
            </div>
          }
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      {/* KPI strip */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(
          [
            ["Σύνολο", formatEUR(invoice.total), "ink"],
            ["Καθαρή", formatEUR(invoice.subtotal), "slate"],
            ["ΦΠΑ", formatEUR(invoice.vatAmount), "slate"],
            [
              invoice.kind === "SALES_CREDIT" ? "Πίστωση" : "Εξοφλημένα",
              formatEUR(invoice.paidAmount),
              "teal",
            ],
            [
              "Υπόλοιπο",
              formatEUR(balance),
              balance > 0 ? "rose" : "emerald",
            ],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="soft-panel px-4 py-3">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold tracking-tight text-ink-950 tabular-nums">
              {value}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {/* Status hero */}
          <section className="soft-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={invoiceStatusTone[status]}>
                {invoiceStatusLabel[status]}
              </Badge>
              <Badge
                tone={
                  invoice.kind === "SALES_CREDIT"
                    ? "amber"
                    : invoice.kind === "RETAIL_RECEIPT"
                      ? "teal"
                      : "slate"
                }
              >
                {invoice.kindLabel}
              </Badge>
              {invoice.series?.myDataEnabled ? (
                <Badge tone="emerald">
                  myDATA {invoice.series.myDataInvoiceType ?? ""}
                </Badge>
              ) : null}
              {invoice.site ? (
                <Badge tone="slate">{invoice.site.code}</Badge>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} className="text-slate-400" />
                Έκδοση{" "}
                {invoice.issuedAt
                  ? new Date(invoice.issuedAt).toLocaleDateString("el-GR")
                  : "—"}
              </span>
              {canEdit ? (
                <label className="inline-flex items-center gap-1.5">
                  <Calendar size={14} className="text-slate-400" />
                  Λήξη
                  <input
                    type="date"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                  />
                  {dueAt !== toDateInput(invoice.dueAt) ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={saveDueAt}
                      className="rounded-lg bg-teal-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Αποθήκευση
                    </button>
                  ) : null}
                </label>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar size={14} className="text-slate-400" />
                  Λήξη{" "}
                  {invoice.dueAt
                    ? new Date(invoice.dueAt).toLocaleDateString("el-GR")
                    : "—"}
                  {dueDays != null && balance > 0 ? (
                    <span
                      className={
                        dueDays < 0
                          ? "font-medium text-rose-700"
                          : "text-slate-500"
                      }
                    >
                      (
                      {dueDays < 0
                        ? `${Math.abs(dueDays)}η καθυστέρηση`
                        : `σε ${dueDays}η`}
                      )
                    </span>
                  ) : null}
                </span>
              )}
              {invoice.series ? (
                <span className="inline-flex items-center gap-1.5">
                  <Hash size={14} className="text-slate-400" />
                  Σειρά {invoice.series.code}
                </span>
              ) : null}
            </div>

            {invoice.kind !== "SALES_CREDIT" ? (
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-slate-500">
                  <span>Πρόοδος εξόφλησης</span>
                  <span>{Math.round(ratio * 100)}%</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-teal-500 transition-all"
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </section>

          {/* Tabs */}
          <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
            {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === key
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {TAB_LABEL[key]}
                {counts[key] > 0 ? (
                  <span className="ml-1.5 text-xs opacity-70">{counts[key]}</span>
                ) : null}
              </button>
            ))}
          </div>

          {tab === "lines" ? (
            <section className="soft-panel overflow-hidden">
              {canEditLines ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                  <p className="text-sm text-slate-600">
                    {editingLines
                      ? "Επεξεργασία γραμμών πρόχειρου"
                      : `${invoice.lines.length} γραμμές`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {editingLines ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setEditingLines(false);
                            setDraftLines(
                              invoice.lines.map((l) => ({
                                key: l.id,
                                productId: l.product?.id ?? null,
                                description: l.description,
                                quantity: l.quantity,
                                unitPrice: l.unitPrice,
                                vatRate: l.vatRate,
                              })),
                            );
                          }}
                        >
                          Ακύρωση
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          disabled={pending}
                          onClick={saveLines}
                        >
                          Αποθήκευση γραμμών
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        type="button"
                        onClick={() => setEditingLines(true)}
                      >
                        Επεξεργασία γραμμών
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}

              {editingLines ? (
                <div className="space-y-3 p-4">
                  {draftTotals.rows.map((line, idx) => (
                    <div
                      key={line.key}
                      className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-[1fr_5.5rem_6.5rem_4.5rem_auto]"
                    >
                      <div>
                        <label className="text-[11px] font-medium text-slate-500">
                          #{idx + 1} Περιγραφή
                        </label>
                        <input
                          value={line.description}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((r) =>
                                r.key === line.key
                                  ? { ...r, description: e.target.value }
                                  : r,
                              ),
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                        />
                        <p className="mt-1 text-right text-xs text-slate-500 sm:text-left">
                          Σύνολο {formatEUR(line.lineTotal)}
                        </p>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-500">
                          Ποσ.
                        </label>
                        <input
                          type="number"
                          min={0.001}
                          step="any"
                          value={line.quantity}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((r) =>
                                r.key === line.key
                                  ? {
                                      ...r,
                                      quantity: Number(e.target.value) || 0,
                                    }
                                  : r,
                              ),
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm tabular-nums outline-none focus:border-teal-300"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-500">
                          Τιμή
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((r) =>
                                r.key === line.key
                                  ? {
                                      ...r,
                                      unitPrice: Number(e.target.value) || 0,
                                    }
                                  : r,
                              ),
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm tabular-nums outline-none focus:border-teal-300"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-500">
                          ΦΠΑ %
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="1"
                          value={line.vatRate}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((r) =>
                                r.key === line.key
                                  ? {
                                      ...r,
                                      vatRate: Number(e.target.value) || 0,
                                    }
                                  : r,
                              ),
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm tabular-nums outline-none focus:border-teal-300"
                        />
                      </div>
                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          title="Διαγραφή γραμμής"
                          disabled={draftLines.length <= 1}
                          onClick={() =>
                            setDraftLines((prev) =>
                              prev.filter((r) => r.key !== line.key),
                            )
                          }
                          className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDraftLines((prev) => [
                          ...prev,
                          {
                            key: lineKey(),
                            productId: null,
                            description: "",
                            quantity: 1,
                            unitPrice: 0,
                            vatRate: 24,
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-50"
                    >
                      <Plus size={15} /> Προσθήκη γραμμής
                    </button>
                    <div className="text-sm tabular-nums text-slate-600">
                      Καθαρή {formatEUR(draftTotals.subtotal)} · ΦΠΑ{" "}
                      {formatEUR(draftTotals.vatAmount)} ·{" "}
                      <span className="font-semibold text-ink-900">
                        {formatEUR(draftTotals.total)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">#</th>
                        <th className="px-4 py-2.5 font-medium">Περιγραφή</th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Ποσ.
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Τιμή
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          ΦΠΑ
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Καθαρή
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Σύνολο
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lineNets.map((line, idx) => (
                        <tr key={line.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {line.position || idx + 1}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-ink-900">
                              {line.description}
                            </p>
                            {line.product ? (
                              <p className="font-mono text-[11px] text-slate-500">
                                {line.product.sku}
                                {line.product.unit
                                  ? ` · ${line.product.unit}`
                                  : ""}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {line.quantity.toLocaleString("el-GR")}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatEUR(line.unitPrice)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                            {line.vatRate}%
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatEUR(line.net)}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {formatEUR(line.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-slate-200 bg-slate-50/80 text-sm">
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-2 text-right text-slate-500"
                        >
                          Καθαρή
                        </td>
                        <td
                          colSpan={2}
                          className="px-4 py-2 text-right font-medium tabular-nums"
                        >
                          {formatEUR(invoice.subtotal)}
                        </td>
                      </tr>
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-2 text-right text-slate-500"
                        >
                          ΦΠΑ
                        </td>
                        <td
                          colSpan={2}
                          className="px-4 py-2 text-right font-medium tabular-nums"
                        >
                          {formatEUR(invoice.vatAmount)}
                        </td>
                      </tr>
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-2.5 text-right font-semibold text-ink-900"
                        >
                          Σύνολο
                        </td>
                        <td
                          colSpan={2}
                          className="px-4 py-2.5 text-right text-base font-semibold tabular-nums text-ink-950"
                        >
                          {formatEUR(invoice.total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {tab === "payments" ? (
            <section className="soft-panel overflow-hidden">
              {invoice.payments.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  Δεν υπάρχουν εισπράξεις ακόμη.
                  {balance > 0 && status !== "DRAFT" && status !== "CANCELLED"
                    ? " Χρησιμοποίησε «Είσπραξη» από τις ενέργειες."
                    : ""}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {invoice.payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-start justify-between gap-3 px-4 py-3.5"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                          <Wallet size={16} />
                        </span>
                        <div>
                          <p className="font-semibold text-ink-900">
                            {formatEUR(p.amount)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(p.paidAt).toLocaleString("el-GR")} ·{" "}
                            <span className="font-medium text-slate-700">
                              {METHOD_LABEL[p.method] ?? p.method}
                            </span>
                            {p.changeAmount > 0
                              ? ` · ρέστα ${formatEUR(p.changeAmount)}`
                              : ""}
                          </p>
                          {p.note ? (
                            <p className="mt-1 text-xs text-slate-600">{p.note}</p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === "related" ? (
            <section className="space-y-3">
              {invoice.order ? (
                <Link
                  href={`/orders/${invoice.order.id}`}
                  className="soft-panel flex items-center gap-3 p-4 hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <Receipt size={18} className="text-teal-700" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500">Παραγγελία</p>
                    <p className="font-semibold text-ink-900">
                      {invoice.order.number}
                    </p>
                  </div>
                  <ExternalLink size={14} className="text-slate-400" />
                </Link>
              ) : null}
              {invoice.relatedInvoice ? (
                <Link
                  href={`/invoices/${invoice.relatedInvoice.id}`}
                  className="soft-panel flex items-center gap-3 p-4 hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <FileText size={18} className="text-amber-700" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500">Συνδεδεμένο παραστατικό</p>
                    <p className="font-semibold text-ink-900">
                      {invoice.relatedInvoice.number}
                    </p>
                  </div>
                  <ExternalLink size={14} className="text-slate-400" />
                </Link>
              ) : null}
              {invoice.creditNotes.map((c) => (
                <Link
                  key={c.id}
                  href={`/invoices/${c.id}`}
                  className="soft-panel flex items-center justify-between gap-3 p-4 hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <div>
                    <p className="text-xs text-slate-500">Πιστωτικό</p>
                    <p className="font-semibold text-ink-900">{c.number}</p>
                    <p className="text-xs text-slate-500">
                      {invoiceStatusLabel[c.status as InvoiceStatusKey] ??
                        c.status}{" "}
                      · {new Date(c.createdAt).toLocaleDateString("el-GR")}
                    </p>
                  </div>
                  <p className="font-semibold text-amber-800">
                    {formatEUR(c.total)}
                  </p>
                </Link>
              ))}
              {invoice.deliveryNotes.map((d) => (
                <Link
                  key={d.id}
                  href="/delivery-notes"
                  className="soft-panel flex items-center gap-3 p-4 hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <Truck size={18} className="text-sky-700" />
                  <div>
                    <p className="text-xs text-slate-500">Δελτίο αποστολής</p>
                    <p className="font-semibold text-ink-900">{d.number}</p>
                    <p className="text-xs text-slate-500">{d.status}</p>
                  </div>
                </Link>
              ))}
              {!invoice.order &&
              !invoice.relatedInvoice &&
              invoice.creditNotes.length === 0 &&
              invoice.deliveryNotes.length === 0 ? (
                <div className="soft-panel px-4 py-10 text-center text-sm text-slate-500">
                  Δεν υπάρχουν συσχετιζόμενα παραστατικά.
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === "activity" ? (
            <section className="soft-panel overflow-hidden">
              {invoice.audits.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  Δεν υπάρχει καταγεγραμμένη δραστηριότητα.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {invoice.audits.map((a) => (
                    <li key={a.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink-900">
                          {ACTION_LABEL[a.action] ?? a.action}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(a.createdAt).toLocaleString("el-GR")}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {a.userName || "Σύστημα"}
                        <span className="ml-1.5 font-mono text-[10px] text-slate-400">
                          {a.action}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === "fiscal" ? (
            <section className="space-y-3">
              <div className="soft-panel overflow-hidden">
                <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">
                  myDATA
                </div>
                {invoice.myData.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-500">
                    Δεν υπάρχει εγγραφή στην ουρά. Ενεργοποίησε myDATA στη σειρά
                    και έκδωσε το παραστατικό.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {invoice.myData.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-medium">{m.status}</p>
                          <p className="text-xs text-slate-500">
                            {m.invoiceType || "—"}
                            {m.mark ? ` · ${m.mark}` : ""}
                          </p>
                        </div>
                        {invoice.canWrite && m.status === "PENDING" ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => processMyData(m.id)}
                            className="rounded-lg bg-teal-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Διαβίβαση
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="soft-panel overflow-hidden">
                <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">
                  Άρθρα ημερολογίου
                </div>
                {invoice.journals.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-500">
                    Δεν υπάρχουν συνδεδεμένα άρθρα.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {invoice.journals.map((j) => (
                      <li key={j.id} className="px-4 py-3">
                        <Link
                          href="/finance"
                          className="font-mono text-xs font-semibold text-sky-700 hover:underline"
                        >
                          {j.number}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {j.sourceType} · {j.description || "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="soft-panel overflow-hidden">
                <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">
                  Κινήσεις αποθήκης
                </div>
                {invoice.stockMovements.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-500">
                    Δεν υπάρχουν κινήσεις αποθέματος για αυτό το παραστατικό.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {invoice.stockMovements.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-2 px-4 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <Package size={14} className="text-slate-400" />
                          <div>
                            <p className="font-medium">
                              {m.sku} · {m.productName}
                            </p>
                            <p className="text-xs text-slate-500">
                              {m.siteCode} · {m.type} ·{" "}
                              {new Date(m.createdAt).toLocaleString("el-GR")}
                            </p>
                          </div>
                        </div>
                        <span className="font-semibold tabular-nums">
                          {m.qty.toLocaleString("el-GR")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : null}

          {/* Notes */}
          <section className="soft-panel p-4">
            <h2 className="text-sm font-semibold text-ink-950">Σημειώσεις</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEditNotes || pending}
              rows={3}
              placeholder="Εσωτερικές σημειώσεις παραστατικού…"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50"
            />
            {canEditNotes ? (
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  type="button"
                  disabled={pending || notes === (invoice.notes ?? "")}
                  onClick={saveNotes}
                >
                  Αποθήκευση σημειώσεων
                </Button>
              </div>
            ) : null}
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <section className="soft-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <Building2 size={16} className="text-teal-700" />
              <h2 className="text-sm font-semibold text-ink-950">Πελάτης</h2>
            </div>
            <Link
              href={`/customers/${invoice.customer.id}`}
              className="group block"
            >
              <p className="font-semibold text-ink-900 group-hover:text-teal-800">
                {invoice.customer.name}
              </p>
              <p className="font-mono text-xs text-slate-500">
                {invoice.customer.code}
              </p>
            </Link>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">ΑΦΜ</dt>
                <dd className="font-medium">
                  {invoice.customer.vatNumber || "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Email</dt>
                <dd className="truncate font-medium">
                  {invoice.customer.email ? (
                    <a
                      href={`mailto:${invoice.customer.email}`}
                      className="inline-flex max-w-full items-center gap-1 text-teal-800 hover:underline"
                    >
                      <Mail size={12} className="shrink-0" />
                      <span className="truncate">{invoice.customer.email}</span>
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Τηλ.</dt>
                <dd className="font-medium">
                  {invoice.customer.phone ? (
                    <a
                      href={`tel:${invoice.customer.phone}`}
                      className="inline-flex items-center gap-1 text-teal-800 hover:underline"
                    >
                      <Phone size={12} />
                      {invoice.customer.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {invoice.branch ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Υποκατάστημα</dt>
                  <dd className="font-medium">{invoice.branch.name}</dd>
                </div>
              ) : null}
              {invoice.space ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Χώρος</dt>
                  <dd className="font-medium">{invoice.space.name}</dd>
                </div>
              ) : null}
            </dl>
            <Link
              href={`/customers/${invoice.customer.id}`}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"
            >
              Καρτέλα πελάτη <ExternalLink size={12} />
            </Link>
          </section>

          {invoice.series ? (
            <section className="soft-panel p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileText size={16} className="text-teal-700" />
                <h2 className="text-sm font-semibold text-ink-950">Σειρά</h2>
              </div>
              <p className="font-semibold text-ink-900">
                {invoice.series.code} · {invoice.series.name}
              </p>
              <dl className="mt-3 space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <dt>Πελάτης</dt>
                  <dd className="font-medium">{invoice.series.affectsCustomer}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Αποθήκη</dt>
                  <dd className="font-medium">{invoice.series.affectsInventory}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Λογ. χρέωση</dt>
                  <dd className="font-mono">
                    {invoice.series.glDebitAccount || "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Λογ. πίστωση</dt>
                  <dd className="font-mono">
                    {invoice.series.glCreditAccount || "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>ΦΠΑ</dt>
                  <dd className="font-mono">
                    {invoice.series.glVatAccount || "—"}
                  </dd>
                </div>
              </dl>
              <Link
                href="/settings/series"
                className="mt-3 inline-flex text-xs font-medium text-teal-700 hover:underline"
              >
                Ρυθμίσεις σειρών
              </Link>
            </section>
          ) : null}

          <section className="soft-panel p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-950">Μεταδεδομένα</h2>
            <dl className="space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between gap-2">
                <dt>Νόμισμα</dt>
                <dd className="font-medium">{invoice.currency}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Δημιουργία</dt>
                <dd>
                  {new Date(invoice.createdAt).toLocaleString("el-GR")}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Ενημέρωση</dt>
                <dd>
                  {new Date(invoice.updatedAt).toLocaleString("el-GR")}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>ID</dt>
                <dd className="truncate font-mono text-[10px]">{invoice.id}</dd>
              </div>
            </dl>
          </section>

          <section className="soft-panel space-y-2 p-4">
            <h2 className="text-sm font-semibold text-ink-950">
              Γρήγορες ενέργειες
            </h2>
            <a
              href={`/invoices/${invoice.id}/print`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <FileText size={15} /> Προεπισκόπηση / PDF
            </a>
            {invoice.customer.email ? (
              <a
                href={`mailto:${invoice.customer.email}?subject=${encodeURIComponent(
                  `Παραστατικό ${invoice.number}`,
                )}`}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Mail size={15} /> Email πελάτη
              </a>
            ) : null}
            <Link
              href="/finance"
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Wallet size={15} /> Οικονομικά / AR
            </Link>
            <Link
              href="/delivery-notes"
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Truck size={15} /> Δελτία αποστολής
            </Link>
            {invoice.stockMovements.length > 0 ? (
              <Link
                href="/inventory"
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Package size={15} /> Αποθήκη
              </Link>
            ) : null}
            {canEditLines && !editingLines ? (
              <button
                type="button"
                onClick={() => {
                  setTab("lines");
                  setEditingLines(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <Receipt size={15} /> Επεξεργασία γραμμών
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
