import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  orderKindLabel,
  orderStatusLabel,
  type OrderStatusKey,
} from "@/modules/sales/order-utils";
import {
  OrderDetailClient,
  type OrderDetailPayload,
} from "./order-detail-client";
import { OrderIssueInvoice } from "./order-issue-invoice";
import { QuoteConvertOrder } from "./quote-convert-order";
import { OrderEditPanel } from "./order-edit-panel";
import { TransformActionButton } from "@/modules/document-transforms/transform-dialog";

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
      customer: {
        select: {
          id: true,
          code: true,
          name: true,
          vatNumber: true,
          email: true,
          phone: true,
        },
      },
      branch: { select: { id: true, name: true } },
      space: { select: { id: true, name: true } },
      site: { select: { id: true, code: true, name: true } },
      series: {
        select: {
          id: true,
          code: true,
          name: true,
          affectsCustomer: true,
          affectsInventory: true,
        },
      },
      sourceQuote: { select: { id: true, number: true } },
      statusOption: { select: { id: true, name: true, tone: true } },
      convertedOrders: {
        where: { kind: "SALES_ORDER" },
        select: { id: true, number: true, status: true, total: true },
        take: 10,
        orderBy: { createdAt: "desc" },
      },
      lines: {
        orderBy: { position: "asc" },
        include: {
          product: {
            select: { id: true, sku: true, name: true, unit: true },
          },
        },
      },
      invoices: {
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) notFound();

  const audits = await prisma.auditEvent.findMany({
    where: {
      tenantId: session.tenantId,
      entity: "order",
      entityId: order.id,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  const status = order.status as OrderStatusKey;
  const isQuote = order.kind === "SALES_QUOTE";
  const listHref = isQuote ? "/quotes" : "/orders";
  const canInvoice =
    !isQuote &&
    (status === "DRAFT" ||
      status === "CONFIRMED" ||
      status === "PARTIAL_INVOICED");
  const canConvert =
    isQuote && status !== "CANCELLED" && order.convertedOrders.length === 0;

  const payload: OrderDetailPayload = {
    id: order.id,
    number: order.number,
    status: order.status,
    statusLabel: order.statusOption?.name ?? orderStatusLabel[status] ?? order.status,
    kind: order.kind,
    kindLabel: orderKindLabel[order.kind],
    orderedAt: order.orderedAt.toISOString(),
    currency: order.currency,
    subtotal: toNumber(order.subtotal),
    vatAmount: toNumber(order.vatAmount),
    total: toNumber(order.total),
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    customer: order.customer,
    branch: order.branch,
    space: order.space,
    site: order.site,
    series: order.series,
    sourceQuote: order.sourceQuote,
    convertedOrders: order.convertedOrders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      total: toNumber(o.total),
    })),
    lines: order.lines.map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      quantity: toNumber(line.quantity),
      quantityInvoiced: toNumber(line.quantityInvoiced),
      unitPrice: toNumber(line.unitPrice),
      vatRate: toNumber(line.vatRate),
      lineTotal: toNumber(line.lineTotal),
      product: line.product,
    })),
    invoices: order.invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      total: toNumber(inv.total),
      createdAt: inv.createdAt.toISOString(),
    })),
    audits: audits.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
      userName: a.user?.name || a.user?.email || null,
      meta: a.meta,
    })),
    canWrite: session.role !== "VIEWER",
    isQuote,
    listHref,
  };

  const headerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <TransformActionButton
        sourceKind={isQuote ? "SALES_QUOTE" : "SALES_ORDER"}
        sourceId={order.id}
        canWrite={session.role !== "VIEWER"}
      />
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
  );

  return (
    <OrderDetailClient
      order={payload}
      headerActions={headerActions}
      editPanel={
        <OrderEditPanel
          orderId={order.id}
          status={order.status}
          notes={order.notes}
          canWrite={session.role !== "VIEWER"}
        />
      }
    />
  );
}
