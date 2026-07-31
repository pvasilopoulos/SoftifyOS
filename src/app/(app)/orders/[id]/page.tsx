import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { formatEUR, toNumber } from "@/modules/sales/invoice-utils";
import {
  orderKindLabel,
  orderStatusLabel,
  orderStatusTone,
  type OrderStatusKey,
} from "@/modules/sales/order-utils";
import { OrderIssueInvoice } from "./order-issue-invoice";
import { QuoteConvertOrder } from "./quote-convert-order";
import { OrderEditPanel } from "./order-edit-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await prisma.order.findFirst({
    where: { id },
    select: { number: true },
  });
  return { title: order?.number ?? "Παραστατικό" };
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const order = await prisma.order.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      customer: true,
      branch: true,
      space: true,
      series: true,
      sourceQuote: { select: { id: true, number: true } },
      convertedOrders: {
        where: { kind: "SALES_ORDER" },
        select: { id: true, number: true, status: true, total: true },
        take: 5,
        orderBy: { createdAt: "desc" },
      },
      lines: {
        orderBy: { position: "asc" },
        include: { product: { select: { sku: true } } },
      },
      invoices: {
        select: { id: true, number: true, status: true, total: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) notFound();

  const status = order.status as OrderStatusKey;
  const total = toNumber(order.total);
  const isQuote = order.kind === "SALES_QUOTE";
  const listHref = isQuote ? "/quotes" : "/orders";
  const canInvoice =
    !isQuote && (status === "DRAFT" || status === "CONFIRMED" || status === "PARTIAL_INVOICED");
  const canConvert =
    isQuote && status !== "CANCELLED" && order.convertedOrders.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={listHref}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Πίσω στις {isQuote ? "προσφορές" : "παραγγελίες"}
        </Link>
        <PageHeader
          title={order.number}
          description={`${order.customer.name}${order.branch ? ` · ${order.branch.name}` : ""}${order.space ? ` · ${order.space.name}` : ""}${order.series ? ` · σειρά ${order.series.code}` : ""}`}
          actions={
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              {isQuote ? (
                <QuoteConvertOrder
                  quoteId={order.id}
                  canConvert={canConvert}
                  existingOrderId={order.convertedOrders[0]?.id}
                />
              ) : canInvoice ? (
                <OrderIssueInvoice orderId={order.id} />
              ) : order.invoices[0] ? (
                <Link
                  href={`/invoices/${order.invoices[0].id}`}
                  className="inline-flex h-10 items-center rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
                >
                  Άνοιγμα {order.invoices[0].number}
                </Link>
              ) : null}
            </div>
          }
        />
      </div>

      <div className="soft-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={orderStatusTone[status]}>{orderStatusLabel[status]}</Badge>
          <Badge tone={isQuote ? "amber" : "slate"}>
            {orderKindLabel[order.kind]}
          </Badge>
          <span className="text-sm text-slate-500">
            Ημ. {order.orderedAt.toLocaleDateString("el-GR")}
          </span>
        </div>
        <p className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">
          {formatEUR(total)}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Καθαρό {formatEUR(toNumber(order.subtotal))} · ΦΠΑ{" "}
          {formatEUR(toNumber(order.vatAmount))}
        </p>
        {order.sourceQuote ? (
          <p className="mt-3 text-sm text-slate-600">
            Από προσφορά{" "}
            <Link
              href={`/orders/${order.sourceQuote.id}`}
              className="font-medium text-teal-800 hover:underline"
            >
              {order.sourceQuote.number}
            </Link>
          </p>
        ) : null}
      </div>

      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-950">Γραμμές</h2>
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {order.lines.map((line) => (
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

      {order.convertedOrders.length > 0 ? (
        <section className="soft-panel overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Παραγγελίες</h2>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {order.convertedOrders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/orders/${o.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="font-medium text-ink-900">{o.number}</span>
                  <span className="tabular-nums">{formatEUR(toNumber(o.total))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {order.invoices.length > 0 ? (
        <section className="soft-panel overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Τιμολόγια</h2>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {order.invoices.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/invoices/${inv.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="font-medium text-ink-900">{inv.number}</span>
                  <span className="tabular-nums">{formatEUR(toNumber(inv.total))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <OrderEditPanel
        orderId={order.id}
        status={order.status}
        notes={order.notes}
        canWrite={session.role !== "VIEWER"}
      />
    </div>
  );
}
