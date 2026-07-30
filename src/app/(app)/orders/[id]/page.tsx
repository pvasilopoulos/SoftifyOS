import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import {
  formatEUR,
  toNumber,
} from "@/modules/sales/invoice-utils";
import {
  orderStatusLabel,
  orderStatusTone,
  type OrderStatusKey,
} from "@/modules/sales/order-utils";
import { OrderIssueInvoice } from "./order-issue-invoice";

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
  return { title: order?.number ?? "Παραγγελία" };
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
  const canInvoice = status === "DRAFT" || status === "CONFIRMED";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/orders"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Πίσω στις παραγγελίες
        </Link>
        <PageHeader
          title={order.number}
          description={`${order.customer.name}${order.branch ? ` · ${order.branch.name}` : ""}${order.space ? ` · ${order.space.name}` : ""}`}
          actions={
            canInvoice ? (
              <OrderIssueInvoice orderId={order.id} />
            ) : order.invoices[0] ? (
              <Link
                href={`/invoices/${order.invoices[0].id}`}
                className="inline-flex h-10 items-center rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
              >
                Άνοιγμα {order.invoices[0].number}
              </Link>
            ) : null
          }
        />
      </div>

      <div className="soft-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={orderStatusTone[status]}>{orderStatusLabel[status]}</Badge>
          <span className="text-sm text-slate-500">
            Ημ. παραγγελίας {order.orderedAt.toLocaleDateString("el-GR")}
          </span>
        </div>
        <p className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">
          {formatEUR(total)}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Καθαρό {formatEUR(toNumber(order.subtotal))} · ΦΠΑ{" "}
          {formatEUR(toNumber(order.vatAmount))}
        </p>
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

      {order.notes ? (
        <section className="soft-panel p-5">
          <h2 className="mb-2 text-sm font-semibold text-ink-950">Σημειώσεις</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-600">{order.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
