import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import {
  formatEUR,
  invoiceStatusLabel,
  toNumber,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";
import { PrintControls } from "./print-controls";

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
  return { title: invoice ? `PDF ${invoice.number}` : "PDF τιμολογίου" };
}

export default async function InvoicePrintPage({
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
      tenant: true,
    },
  });
  if (!invoice) notFound();

  const status = invoice.status as InvoiceStatusKey;
  const total = toNumber(invoice.total);
  const paid = toNumber(invoice.paidAmount);
  const subtotal = toNumber(invoice.subtotal);
  const vatAmount = toNumber(invoice.vatAmount);

  return (
    <div className="min-h-screen bg-slate-100 text-ink-950 print:bg-white">
      <PrintControls invoiceNumber={invoice.number} />

      <article className="mx-auto max-w-3xl bg-white px-8 py-10 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
              SoftifyOS
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {invoice.tenant.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">Τιμολόγιο πώλησης</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-xl font-semibold">{invoice.number}</p>
            <p className="mt-1 text-slate-500">
              {invoiceStatusLabel[status]}
            </p>
          </div>
        </header>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Πελάτης
            </p>
            <p className="mt-1 font-medium">{invoice.customer.name}</p>
            <p className="text-sm text-slate-500">{invoice.customer.code}</p>
            {invoice.customer.vatNumber ? (
              <p className="text-sm text-slate-500">
                ΑΦΜ {invoice.customer.vatNumber}
              </p>
            ) : null}
            {invoice.branch ? (
              <p className="mt-2 text-sm text-slate-600">
                {invoice.branch.name}
                {invoice.space ? ` · ${invoice.space.name}` : ""}
              </p>
            ) : null}
          </div>
          <div className="text-sm sm:text-right">
            <Row
              label="Έκδοση"
              value={
                invoice.issuedAt
                  ? invoice.issuedAt.toLocaleDateString("el-GR")
                  : "—"
              }
            />
            <Row
              label="Λήξη"
              value={
                invoice.dueAt ? invoice.dueAt.toLocaleDateString("el-GR") : "—"
              }
            />
            <Row label="Νόμισμα" value={invoice.currency} />
          </div>
        </div>

        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3 font-medium">Περιγραφή</th>
              <th className="py-2 pr-3 font-medium text-right">Ποσ.</th>
              <th className="py-2 pr-3 font-medium text-right">Τιμή</th>
              <th className="py-2 pr-3 font-medium text-right">ΦΠΑ</th>
              <th className="py-2 font-medium text-right">Σύνολο</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-b border-slate-100">
                <td className="py-3 pr-3 font-medium">{line.description}</td>
                <td className="py-3 pr-3 text-right tabular-nums">
                  {toNumber(line.quantity)}
                </td>
                <td className="py-3 pr-3 text-right tabular-nums">
                  {formatEUR(toNumber(line.unitPrice))}
                </td>
                <td className="py-3 pr-3 text-right tabular-nums">
                  {toNumber(line.vatRate)}%
                </td>
                <td className="py-3 text-right tabular-nums font-medium">
                  {formatEUR(toNumber(line.lineTotal))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 ml-auto w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Καθαρή αξία</span>
            <span className="tabular-nums">{formatEUR(subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>ΦΠΑ</span>
            <span className="tabular-nums">{formatEUR(vatAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <span>Σύνολο</span>
            <span className="tabular-nums">{formatEUR(total)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>Εξοφλημένα</span>
            <span className="tabular-nums">{formatEUR(paid)}</span>
          </div>
          <div className="flex justify-between font-medium text-ink-900">
            <span>Υπόλοιπο</span>
            <span className="tabular-nums">{formatEUR(total - paid)}</span>
          </div>
        </div>

        {invoice.notes ? (
          <p className="mt-8 text-sm text-slate-500">
            <span className="font-medium text-ink-800">Σημειώσεις: </span>
            {invoice.notes}
          </p>
        ) : null}

        <p className="mt-10 text-xs text-slate-400 print:hidden">
          <Link href={`/invoices/${invoice.id}`} className="text-teal-700">
            Επιστροφή στην καρτέλα
          </Link>
        </p>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-6 sm:block">
      <span className="text-slate-400">{label}</span>{" "}
      <span className="font-medium text-ink-900">{value}</span>
    </p>
  );
}
