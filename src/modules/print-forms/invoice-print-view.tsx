import Link from "next/link";
import {
  isHtmlBody,
  type PrintFormBody,
  type PrintBlock,
} from "@/modules/print-forms/defaults";
import {
  renderPrintTemplate,
  sanitizePrintCss,
  sanitizePrintHtml,
} from "@/modules/print-forms/template-engine";
import {
  formatEUR,
  invoiceStatusLabel,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";

export type InvoicePrintModel = {
  id: string;
  number: string;
  status: InvoiceStatusKey;
  kindLabel: string;
  currency: string;
  notes: string | null;
  issuedAt: Date | null;
  dueAt: Date | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  paid: number;
  tenantName: string;
  tenantCode: string;
  formName: string;
  customer: {
    name: string;
    code: string;
    vatNumber: string | null;
    email: string | null;
    phone: string | null;
  };
  branchName: string | null;
  spaceName: string | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    lineTotal: number;
  }>;
};

export function invoiceToTemplateContext(
  invoice: InvoicePrintModel,
): Record<string, unknown> {
  return {
    tenant: { name: invoice.tenantName, code: invoice.tenantCode },
    form: { name: invoice.formName },
    doc: {
      number: invoice.number,
      status: invoiceStatusLabel[invoice.status],
      kindLabel: invoice.kindLabel,
      issuedAt: invoice.issuedAt?.toISOString() ?? "",
      dueAt: invoice.dueAt?.toISOString() ?? "",
      currency: invoice.currency,
      notes: invoice.notes ?? "",
    },
    customer: {
      name: invoice.customer.name,
      code: invoice.customer.code,
      vatNumber: invoice.customer.vatNumber ?? "",
      email: invoice.customer.email ?? "",
      phone: invoice.customer.phone ?? "",
    },
    branch: { name: invoice.branchName ?? "" },
    space: { name: invoice.spaceName ?? "" },
    lines: invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      lineTotal: l.lineTotal,
    })),
    totals: {
      subtotal: invoice.subtotal,
      vatAmount: invoice.vatAmount,
      total: invoice.total,
      paid: invoice.paid,
      balance: invoice.total - invoice.paid,
    },
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-6 sm:block">
      <span className="text-slate-400">{label}</span>{" "}
      <span className="font-medium text-ink-900">{value}</span>
    </p>
  );
}

function BlockView({
  block,
  invoice,
}: {
  block: PrintBlock;
  invoice: InvoicePrintModel;
}) {
  switch (block.type) {
    case "header":
      return (
        <header className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
              SoftifyOS
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {invoice.tenantName}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{invoice.formName}</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-xl font-semibold">{invoice.number}</p>
            <p className="mt-1 text-slate-500">
              {invoiceStatusLabel[invoice.status]}
            </p>
          </div>
        </header>
      );
    case "parties":
      return (
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
          {invoice.branchName ? (
            <p className="mt-2 text-sm text-slate-600">
              {invoice.branchName}
              {invoice.spaceName ? ` · ${invoice.spaceName}` : ""}
            </p>
          ) : null}
        </div>
      );
    case "meta":
      return (
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
      );
    case "lines":
      return (
        <table className="w-full border-collapse text-sm">
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
                  {line.quantity}
                </td>
                <td className="py-3 pr-3 text-right tabular-nums">
                  {formatEUR(line.unitPrice)}
                </td>
                <td className="py-3 pr-3 text-right tabular-nums">
                  {line.vatRate}%
                </td>
                <td className="py-3 text-right tabular-nums font-medium">
                  {formatEUR(line.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "totals":
      return (
        <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Καθαρή αξία</span>
            <span className="tabular-nums">{formatEUR(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>ΦΠΑ</span>
            <span className="tabular-nums">{formatEUR(invoice.vatAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <span>Σύνολο</span>
            <span className="tabular-nums">{formatEUR(invoice.total)}</span>
          </div>
          {block.showPaidBalance !== false ? (
            <>
              <div className="flex justify-between text-slate-500">
                <span>Εξοφλημένα</span>
                <span className="tabular-nums">{formatEUR(invoice.paid)}</span>
              </div>
              <div className="flex justify-between font-medium text-ink-900">
                <span>Υπόλοιπο</span>
                <span className="tabular-nums">
                  {formatEUR(invoice.total - invoice.paid)}
                </span>
              </div>
            </>
          ) : null}
        </div>
      );
    case "notes":
      if (!invoice.notes) return null;
      return (
        <p className="text-sm text-slate-500">
          <span className="font-medium text-ink-800">Σημειώσεις: </span>
          {invoice.notes}
        </p>
      );
    case "footer":
      return (
        <p className="text-xs text-slate-400">{block.text || "SoftifyOS"}</p>
      );
    case "text":
      return (
        <p className="whitespace-pre-wrap text-sm text-slate-600">{block.text}</p>
      );
    case "spacer":
      return <div className="h-6" aria-hidden />;
    default:
      return null;
  }
}

function HtmlPrintArticle({
  invoice,
  html,
  css,
}: {
  invoice: InvoicePrintModel;
  html: string;
  css: string;
}) {
  const rendered = renderPrintTemplate(html, invoiceToTemplateContext(invoice));
  const safeHtml = sanitizePrintHtml(rendered);
  const safeCss = sanitizePrintCss(css);
  return (
    <div className="mx-auto max-w-4xl bg-white px-6 py-8 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
      <style dangerouslySetInnerHTML={{ __html: safeCss }} />
      <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
      <p className="mt-8 text-xs text-slate-400 print:hidden">
        <Link href={`/invoices/${invoice.id}`} className="text-teal-700">
          Επιστροφή στην καρτέλα
        </Link>
      </p>
    </div>
  );
}

export function InvoicePrintArticle({
  invoice,
  body,
}: {
  invoice: InvoicePrintModel;
  body: PrintFormBody;
}) {
  if (isHtmlBody(body)) {
    return (
      <HtmlPrintArticle invoice={invoice} html={body.html} css={body.css} />
    );
  }

  let blocks: PrintBlock[] = [];
  if (body.version === 1) {
    blocks = body.blocks;
  } else if (body.blocks && body.blocks.length > 0) {
    blocks = body.blocks;
  }
  const hasParties = blocks.some((b: PrintBlock) => b.type === "parties");
  const hasMeta = blocks.some((b: PrintBlock) => b.type === "meta");

  return (
    <article className="mx-auto max-w-3xl bg-white px-8 py-10 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
      <div className="space-y-6">
        {blocks.map((block: PrintBlock) => {
          if (block.type === "parties" && hasMeta) {
            const meta = blocks.find((b: PrintBlock) => b.type === "meta");
            if (!meta) {
              return <BlockView key={block.id} block={block} invoice={invoice} />;
            }
            const partiesIndex = blocks.findIndex(
              (b: PrintBlock) => b.type === "parties",
            );
            const metaIndex = blocks.findIndex(
              (b: PrintBlock) => b.type === "meta",
            );
            if (partiesIndex < metaIndex && block.type === "parties") {
              return (
                <div
                  key={`${block.id}-pair`}
                  className="grid gap-6 sm:grid-cols-2"
                >
                  <BlockView block={block} invoice={invoice} />
                  <BlockView block={meta} invoice={invoice} />
                </div>
              );
            }
            return null;
          }
          if (block.type === "meta" && hasParties) {
            const partiesIndex = blocks.findIndex(
              (b: PrintBlock) => b.type === "parties",
            );
            const metaIndex = blocks.findIndex(
              (b: PrintBlock) => b.type === "meta",
            );
            if (partiesIndex < metaIndex) return null;
          }
          return <BlockView key={block.id} block={block} invoice={invoice} />;
        })}
      </div>

      <p className="mt-10 text-xs text-slate-400 print:hidden">
        <Link href={`/invoices/${invoice.id}`} className="text-teal-700">
          Επιστροφή στην καρτέλα
        </Link>
      </p>
    </article>
  );
}
