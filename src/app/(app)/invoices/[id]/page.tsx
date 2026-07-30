import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import {
  formatEUR,
  invoiceStatusLabel,
  invoiceStatusTone,
  toNumber,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";
import { invoiceKindLabel } from "@/modules/documents/series";
import { InvoiceActions } from "../invoice-actions";
import { CreditFromInvoice } from "./credit-from-invoice";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id },
    select: { number: true },
  });
  return { title: invoice?.number ?? "Τιμολόγιο" };
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      customer: true,
      branch: true,
      space: true,
      series: true,
      site: true,
      relatedInvoice: { select: { id: true, number: true, kind: true } },
      creditNotes: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
        },
      },
      payments: { orderBy: { paidAt: "desc" } },
      lines: {
        orderBy: { position: "asc" },
        include: { product: { select: { sku: true } } },
      },
    },
  });
  if (!invoice) notFound();

  const status = invoice.status as InvoiceStatusKey;
  const total = toNumber(invoice.total);
  const paid = toNumber(invoice.paidAmount);
  const canCredit =
    (invoice.kind === "SALES_INVOICE" || invoice.kind === "RETAIL_RECEIPT") &&
    status !== "DRAFT" &&
    status !== "CANCELLED";

  return (
    <div className="space-y-6">
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
          description={`${invoice.customer.name}${invoice.branch ? ` · ${invoice.branch.name}` : ""}${invoice.space ? ` · ${invoice.space.name}` : ""}${invoice.series ? ` · σειρά ${invoice.series.code}` : ""}`}
          actions={
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <InvoiceActions
                invoiceId={invoice.id}
                status={invoice.status}
                total={total}
                paidAmount={paid}
                size="md"
                showCollect={invoice.kind !== "SALES_CREDIT"}
              />
              <CreditFromInvoice invoiceId={invoice.id} canCredit={canCredit} />
            </div>
          }
        />
      </div>

      <div className="soft-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={invoiceStatusTone[status]}>{invoiceStatusLabel[status]}</Badge>
          <Badge
            tone={
              invoice.kind === "SALES_CREDIT"
                ? "amber"
                : invoice.kind === "RETAIL_RECEIPT"
                  ? "teal"
                  : "slate"
            }
          >
            {invoiceKindLabel[invoice.kind as keyof typeof invoiceKindLabel] ??
              "Τιμολόγιο"}
          </Badge>
          {invoice.series?.myDataEnabled ? (
            <Badge tone="emerald">
              myDATA {invoice.series.myDataInvoiceType ?? ""}
            </Badge>
          ) : null}
          {invoice.site ? <Badge tone="slate">{invoice.site.code}</Badge> : null}
          <span className="text-sm text-slate-500">
            Έκδοση{" "}
            {invoice.issuedAt
              ? invoice.issuedAt.toLocaleDateString("el-GR")
              : "—"}{" "}
            · Λήξη{" "}
            {invoice.dueAt ? invoice.dueAt.toLocaleDateString("el-GR") : "—"}
          </span>
        </div>
        <p className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">
          {formatEUR(total)}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {invoice.kind === "SALES_CREDIT"
            ? `Πίστωση ${formatEUR(total)}`
            : `Εξοφλημένα ${formatEUR(paid)} · Υπόλοιπο ${formatEUR(total - paid)}`}
        </p>
        {invoice.relatedInvoice ? (
          <p className="mt-3 text-sm text-slate-600">
            Συνδεδεμένο παραστατικό{" "}
            <Link
              href={`/invoices/${invoice.relatedInvoice.id}`}
              className="font-medium text-teal-800 hover:underline"
            >
              {invoice.relatedInvoice.number}
            </Link>
          </p>
        ) : null}
        {invoice.series ? (
          <p className="mt-2 text-xs text-slate-500">
            Κινήσεις: πελάτης {invoice.series.affectsCustomer} · αποθήκη{" "}
            {invoice.series.affectsInventory}
            {invoice.series.glDebitAccount
              ? ` · λογ. ${invoice.series.glDebitAccount}/${invoice.series.glCreditAccount ?? "—"}`
              : ""}
          </p>
        ) : null}
        {invoice.notes ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">
            {invoice.notes}
          </p>
        ) : null}
      </div>

      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-950">Γραμμές</h2>
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {invoice.lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="font-medium text-ink-900">{line.description}</p>
                <p className="text-xs text-slate-500">
                  {line.product?.sku ? `${line.product.sku} · ` : ""}
                  {toNumber(line.quantity)} × {formatEUR(toNumber(line.unitPrice))} ·
                  ΦΠΑ {toNumber(line.vatRate)}%
                </p>
              </div>
              <p className="font-medium">{formatEUR(toNumber(line.lineTotal))}</p>
            </li>
          ))}
        </ul>
      </section>

      {invoice.creditNotes.length > 0 ? (
        <section className="soft-panel overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Πιστωτικά</h2>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {invoice.creditNotes.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/invoices/${c.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <p className="font-medium text-ink-900">{c.number}</p>
                    <p className="text-xs text-slate-500">
                      {invoiceStatusLabel[c.status as InvoiceStatusKey] ?? c.status}
                      {" · "}
                      {c.createdAt.toLocaleDateString("el-GR")}
                    </p>
                  </div>
                  <p className="font-medium text-amber-800">
                    {formatEUR(toNumber(c.total))}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {invoice.payments.length > 0 ? (
        <section className="soft-panel overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Εισπράξεις</h2>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {invoice.payments.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-ink-900">
                    {formatEUR(toNumber(p.amount))}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.paidAt.toLocaleString("el-GR")} · {p.method}
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
