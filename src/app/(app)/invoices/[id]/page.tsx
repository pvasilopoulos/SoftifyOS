import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, Send, Wallet } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  demoInvoices,
  formatEUR,
  statusLabel,
  statusTone,
} from "@/modules/sales/demo-data";

export function generateStaticParams() {
  return demoInvoices.map((inv) => ({ id: inv.id }));
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = demoInvoices.find((i) => i.id === id);
  if (!invoice) notFound();

  const steps = ["Πρόχειρο", "Εκδομένο", "Πληρωμένο"] as const;
  const stepIndex =
    invoice.status === "draft"
      ? 0
      : invoice.status === "paid"
        ? 2
        : 1;

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
          description={invoice.customer}
          actions={
            <>
              <Button variant="secondary" size="sm">
                <FileDown size={15} />
                PDF
              </Button>
              <Button variant="secondary" size="sm">
                <Send size={15} />
                Αποστολή
              </Button>
              <Button size="sm">
                <Wallet size={15} />
                Είσπραξη
              </Button>
            </>
          }
        />
      </div>

      <div className="soft-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={statusTone[invoice.status]}>
            {statusLabel[invoice.status]}
          </Badge>
          <span className="text-sm text-slate-500">
            Έκδοση {invoice.issuedAt} · Λήξη {invoice.dueAt}
          </span>
        </div>
        <p className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">
          {formatEUR(invoice.amount)}
        </p>

        <ol className="mt-6 grid grid-cols-3 gap-2">
          {steps.map((step, i) => (
            <li
              key={step}
              className={`rounded-2xl px-3 py-3 text-center text-xs font-medium sm:text-sm ${
                i <= stepIndex
                  ? "bg-teal-50 text-teal-900"
                  : "bg-slate-50 text-slate-400"
              }`}
            >
              {step}
            </li>
          ))}
        </ol>
      </div>

      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-950">Γραμμές</h2>
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {[
            { name: "Υπηρεσία συμβουλευτικής", qty: 1, price: invoice.amount * 0.7 },
            { name: "Άδεια SoftifyOS", qty: 1, price: invoice.amount * 0.3 },
          ].map((line) => (
            <li
              key={line.name}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="font-medium text-ink-900">{line.name}</p>
                <p className="text-xs text-slate-500">Ποσότητα {line.qty}</p>
              </div>
              <p className="font-medium">{formatEUR(line.price)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
