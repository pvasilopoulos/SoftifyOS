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
import { InvoiceActions } from "../invoice-actions";

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
      lines: { orderBy: { position: "asc" } },
    },
  });
  if (!invoice) notFound();

  const status = invoice.status as InvoiceStatusKey;
  const total = toNumber(invoice.total);
  const paid = toNumber(invoice.paidAmount);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/invoices"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Πίσω στα τιμολόγια
        </Link>
        <PageHeader
          title={invoice.number}
          description={`${invoice.customer.name}${invoice.branch ? ` · ${invoice.branch.name}` : ""}${invoice.space ? ` · ${invoice.space.name}` : ""}`}
          actions={
            <InvoiceActions
              invoiceId={invoice.id}
              status={invoice.status}
              total={total}
              paidAmount={paid}
              size="md"
            />
          }
        />
      </div>

      <div className="soft-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={invoiceStatusTone[status]}>{invoiceStatusLabel[status]}</Badge>
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
          Εξοφλημένα {formatEUR(paid)} · Υπόλοιπο {formatEUR(total - paid)}
        </p>
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
                  {toNumber(line.quantity)} × {formatEUR(toNumber(line.unitPrice))} ·
                  ΦΠΑ {toNumber(line.vatRate)}%
                </p>
              </div>
              <p className="font-medium">{formatEUR(toNumber(line.lineTotal))}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
