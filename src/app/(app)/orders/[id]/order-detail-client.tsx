"use client";

import Link from "next/link";
import { useState } from "react";
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
  Phone,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  formatEUR,
  invoiceStatusLabel,
  invoiceStatusTone,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";
import {
  orderKindLabel,
  orderStatusLabel,
  orderStatusTone,
  type OrderKindKey,
  type OrderStatusKey,
} from "@/modules/sales/order-utils";

export type OrderDetailPayload = {
  id: string;
  number: string;
  status: string;
  statusLabel: string;
  kind: string;
  kindLabel: string;
  orderedAt: string;
  currency: string;
  subtotal: number;
  vatAmount: number;
  total: number;
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
    affectsCustomer: string;
    affectsInventory: string;
  } | null;
  sourceQuote: { id: string; number: string } | null;
  convertedOrders: Array<{
    id: string;
    number: string;
    status: string;
    total: number;
  }>;
  lines: Array<{
    id: string;
    position: number;
    description: string;
    quantity: number;
    quantityInvoiced: number;
    unitPrice: number;
    vatRate: number;
    lineTotal: number;
    product: { id: string; sku: string; name: string; unit: string } | null;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    total: number;
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
  isQuote: boolean;
  listHref: string;
};

type TabKey = "lines" | "invoices" | "related" | "activity";

const TAB_LABEL: Record<TabKey, string> = {
  lines: "Γραμμές",
  invoices: "Τιμολόγια",
  related: "Συσχετιζόμενα",
  activity: "Δραστηριότητα",
};

const ACTION_LABEL: Record<string, string> = {
  "order.create": "Δημιουργία παραγγελίας",
  "order.update": "Ενημέρωση",
  "order.confirm": "Επιβεβαίωση",
  "order.cancel": "Ακύρωση",
  "order.invoice": "Έκδοση τιμολογίου",
  "quote.create": "Δημιουργία προσφοράς",
  "quote.convert": "Μετατροπή σε παραγγελία",
};

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export function OrderDetailClient({
  order,
  headerActions,
  editPanel,
}: {
  order: OrderDetailPayload;
  headerActions?: React.ReactNode;
  editPanel?: React.ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("lines");
  const [copied, setCopied] = useState(false);
  const status = order.status as OrderStatusKey;
  const kind = order.kind as OrderKindKey;

  const counts: Record<TabKey, number> = {
    lines: order.lines.length,
    invoices: order.invoices.length,
    related: (order.sourceQuote ? 1 : 0) + order.convertedOrders.length,
    activity: order.audits.length,
  };

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(order.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const desc = [order.customer.name, order.branch?.name, order.space?.name]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={order.listHref}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Πίσω στις {order.isQuote ? "προσφορές" : "παραγγελίες"}
        </Link>
        <PageHeader
          title={order.number}
          description={desc}
          actions={
            <div
              role="toolbar"
              aria-label="Ενέργειες παραστατικού"
              className="inline-flex max-w-full flex-wrap items-center gap-1.5"
            >
              <Button
                size="icon"
                variant="secondary"
                type="button"
                onClick={() => void copyNumber()}
                title={copied ? "Αντιγράφηκε" : "Αντιγραφή αριθμού"}
                aria-label={copied ? "Αντιγράφηκε" : "Αντιγραφή αριθμού"}
                className="h-9 w-9 shrink-0"
              >
                {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
              </Button>
              {headerActions}
            </div>
          }
        />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(
          [
            ["Σύνολο", formatEUR(order.total)],
            ["Καθαρή", formatEUR(order.subtotal)],
            ["ΦΠΑ", formatEUR(order.vatAmount)],
            ["Γραμμές", String(order.lines.length)],
            ["Τιμολόγια", String(order.invoices.length)],
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
          <section className="soft-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={orderStatusTone[status]}>
                {order.statusLabel || orderStatusLabel[status]}
              </Badge>
              <Badge tone={order.isQuote ? "amber" : "slate"}>
                {order.kindLabel || orderKindLabel[kind]}
              </Badge>
              {order.site ? <Badge tone="slate">{order.site.code}</Badge> : null}
              {order.series ? (
                <Badge tone="slate">σειρά {order.series.code}</Badge>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} className="text-slate-400" />
                {new Date(order.orderedAt).toLocaleDateString("el-GR")}
              </span>
              {order.series ? (
                <span className="inline-flex items-center gap-1.5">
                  <Hash size={14} className="text-slate-400" />
                  Σειρά {order.series.code}
                </span>
              ) : null}
            </div>
          </section>

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
              {order.lines.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  Δεν υπάρχουν γραμμές.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {order.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-ink-900">
                          {line.description}
                        </p>
                        <p className="text-xs text-slate-500">
                          {line.product?.sku ? `${line.product.sku} · ` : ""}
                          {line.quantity.toLocaleString("el-GR")} ×{" "}
                          {formatEUR(line.unitPrice)} · ΦΠΑ {line.vatRate}%
                          {line.quantityInvoiced > 0
                            ? ` · τιμολ. ${line.quantityInvoiced.toLocaleString("el-GR")}`
                            : ""}
                        </p>
                      </div>
                      <p className="font-medium tabular-nums">
                        {formatEUR(line.lineTotal)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === "invoices" ? (
            <section className="soft-panel overflow-hidden">
              {order.invoices.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  {order.isQuote
                    ? "Οι προσφορές δεν τιμολογούνται απευθείας."
                    : "Δεν έχουν εκδοθεί τιμολόγια ακόμη."}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {order.invoices.map((inv) => (
                    <li key={inv.id}>
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                            <Receipt size={16} />
                          </span>
                          <div>
                            <p className="font-semibold text-ink-900">
                              {inv.number}
                            </p>
                            <p className="text-xs text-slate-500">
                              {new Date(inv.createdAt).toLocaleDateString("el-GR")}{" "}
                              ·{" "}
                              <Badge
                                tone={
                                  invoiceStatusTone[
                                    inv.status as InvoiceStatusKey
                                  ] ?? "slate"
                                }
                              >
                                {invoiceStatusLabel[
                                  inv.status as InvoiceStatusKey
                                ] ?? inv.status}
                              </Badge>
                            </p>
                          </div>
                        </div>
                        <p className="font-semibold tabular-nums">
                          {formatEUR(inv.total)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === "related" ? (
            <section className="space-y-3">
              {order.sourceQuote ? (
                <Link
                  href={`/orders/${order.sourceQuote.id}`}
                  className="soft-panel flex items-center gap-3 p-4 hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <FileText size={18} className="text-amber-700" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500">Προσφορά προέλευσης</p>
                    <p className="font-semibold text-ink-900">
                      {order.sourceQuote.number}
                    </p>
                  </div>
                  <ExternalLink size={14} className="text-slate-400" />
                </Link>
              ) : null}
              {order.convertedOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="soft-panel flex items-center justify-between gap-3 p-4 hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <div className="flex items-center gap-3">
                    <ShoppingCart size={18} className="text-teal-700" />
                    <div>
                      <p className="text-xs text-slate-500">Παραγγελία</p>
                      <p className="font-semibold text-ink-900">{o.number}</p>
                      <p className="text-xs text-slate-500">
                        {orderStatusLabel[o.status as OrderStatusKey] ?? o.status}
                      </p>
                    </div>
                  </div>
                  <p className="font-semibold tabular-nums">
                    {formatEUR(o.total)}
                  </p>
                </Link>
              ))}
              {!order.sourceQuote && order.convertedOrders.length === 0 ? (
                <div className="soft-panel px-4 py-10 text-center text-sm text-slate-500">
                  Δεν υπάρχουν συσχετιζόμενα παραστατικά.
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === "activity" ? (
            <section className="soft-panel overflow-hidden">
              {order.audits.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  Δεν υπάρχει καταγεγραμμένη δραστηριότητα.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {order.audits.map((a) => (
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
        </div>

        <aside className="space-y-4">
          <section className="soft-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <Building2 size={16} className="text-teal-700" />
              <h2 className="text-sm font-semibold text-ink-950">Πελάτης</h2>
            </div>
            <Link href={`/customers/${order.customer.id}`} className="group block">
              <p className="font-semibold text-ink-900 group-hover:text-teal-800">
                {order.customer.name}
              </p>
              <p className="font-mono text-xs text-slate-500">{order.customer.code}</p>
            </Link>
            <dl className="mt-3 space-y-1.5 text-sm">
              <MetaRow label="ΑΦΜ">{order.customer.vatNumber || "—"}</MetaRow>
              <MetaRow label="Email">
                {order.customer.email ? (
                  <a
                    href={`mailto:${order.customer.email}`}
                    className="inline-flex items-center gap-1 text-teal-800 hover:underline"
                  >
                    <Mail size={12} />
                    <span className="truncate">{order.customer.email}</span>
                  </a>
                ) : (
                  "—"
                )}
              </MetaRow>
              <MetaRow label="Τηλ.">
                {order.customer.phone ? (
                  <a
                    href={`tel:${order.customer.phone}`}
                    className="inline-flex items-center gap-1 text-teal-800 hover:underline"
                  >
                    <Phone size={12} />
                    {order.customer.phone}
                  </a>
                ) : (
                  "—"
                )}
              </MetaRow>
              {order.branch ? (
                <MetaRow label="Υποκατάστημα">{order.branch.name}</MetaRow>
              ) : null}
              {order.space ? (
                <MetaRow label="Χώρος">{order.space.name}</MetaRow>
              ) : null}
            </dl>
            <Link
              href={`/customers/${order.customer.id}`}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"
            >
              Καρτέλα πελάτη <ExternalLink size={12} />
            </Link>
          </section>

          {order.series ? (
            <section className="soft-panel p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileText size={16} className="text-teal-700" />
                <h2 className="text-sm font-semibold text-ink-950">Σειρά</h2>
              </div>
              <p className="font-semibold text-ink-900">
                {order.series.code} · {order.series.name}
              </p>
              <dl className="mt-3 space-y-1.5 text-xs text-slate-600">
                <MetaRow label="Πελάτης">{order.series.affectsCustomer}</MetaRow>
                <MetaRow label="Αποθήκη">{order.series.affectsInventory}</MetaRow>
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
              <MetaRow label="Νόμισμα">{order.currency}</MetaRow>
              <MetaRow label="Ημερομηνία">
                {new Date(order.orderedAt).toLocaleDateString("el-GR")}
              </MetaRow>
              <MetaRow label="Δημιουργία">
                {new Date(order.createdAt).toLocaleString("el-GR")}
              </MetaRow>
              <MetaRow label="Ενημέρωση">
                {new Date(order.updatedAt).toLocaleString("el-GR")}
              </MetaRow>
              <MetaRow label="ID">
                <span className="truncate font-mono text-[10px]">{order.id}</span>
              </MetaRow>
            </dl>
          </section>

          <section className="soft-panel space-y-2 p-4">
            <h2 className="text-sm font-semibold text-ink-950">Γρήγορες ενέργειες</h2>
            {order.invoices[0] ? (
              <Link
                href={`/invoices/${order.invoices[0].id}`}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Receipt size={15} /> Άνοιγμα τιμολογίου
              </Link>
            ) : null}
            {order.customer.email ? (
              <a
                href={`mailto:${order.customer.email}?subject=${encodeURIComponent(
                  `${order.isQuote ? "Προσφορά" : "Παραγγελία"} ${order.number}`,
                )}`}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Mail size={15} /> Email πελάτη
              </a>
            ) : null}
            <Link
              href={order.listHref}
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <FileText size={15} />{" "}
              {order.isQuote ? "Λίστα προσφορών" : "Λίστα παραγγελιών"}
            </Link>
          </section>

          {editPanel}
        </aside>
      </div>
    </div>
  );
}
