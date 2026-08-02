import { notFound, redirect } from "next/navigation";
import type { DocumentKind } from "@/generated/prisma/client";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { toNumber, type InvoiceStatusKey } from "@/modules/sales/invoice-utils";
import { documentKindLabel } from "@/modules/documents/series";
import {
  parseBodyJson,
  resolvePrintFormForSeries,
} from "@/modules/print-forms/service";
import { InvoicePrintArticle } from "@/modules/print-forms/invoice-print-view";
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
  const companyFilter = session.legalEntityId
    ? { legalEntityId: session.legalEntityId }
    : {};
  const [invoice, company] = await Promise.all([
    prisma.invoice.findFirst({
      where: { id, tenantId: session.tenantId, ...companyFilter },
      include: {
        customer: true,
        branch: true,
        space: true,
        lines: { orderBy: { position: "asc" } },
        tenant: true,
        series: { select: { id: true, kind: true } },
      },
    }),
    prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: {
        legalName: true,
        vatNumber: true,
        address: true,
        city: true,
        postalCode: true,
        phone: true,
        email: true,
        integrationsJson: true,
      },
    }),
  ]);
  if (!invoice) notFound();

  const documentKind = (invoice.series?.kind ??
    invoice.kind) as DocumentKind;

  const printForm = await resolvePrintFormForSeries(prisma, {
    tenantId: session.tenantId,
    seriesId: invoice.seriesId,
    documentKind,
  });

  const body = parseBodyJson(printForm?.bodyJson);
  const status = invoice.status as InvoiceStatusKey;
  const kindLabel =
    documentKindLabel[documentKind as keyof typeof documentKindLabel] ??
    documentKind;

  const integrations =
    company?.integrationsJson &&
    typeof company.integrationsJson === "object" &&
    !Array.isArray(company.integrationsJson)
      ? (company.integrationsJson as Record<string, unknown>)
      : {};
  const bank =
    integrations.bank && typeof integrations.bank === "object"
      ? (integrations.bank as Record<string, unknown>)
      : {};

  const addressParts = [
    company?.address,
    company?.postalCode,
    company?.city,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-100 text-ink-950 print:bg-white">
      <PrintControls invoiceNumber={invoice.number} />

      <InvoicePrintArticle
        body={body}
        paper={printForm?.paper ?? "A4"}
        orientation={printForm?.orientation ?? "PORTRAIT"}
        invoice={{
          id: invoice.id,
          number: invoice.number,
          status,
          kindLabel,
          currency: invoice.currency,
          notes: invoice.notes,
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt,
          subtotal: toNumber(invoice.subtotal),
          vatAmount: toNumber(invoice.vatAmount),
          total: toNumber(invoice.total),
          paid: toNumber(invoice.paidAmount),
          tenantName: company?.legalName || invoice.tenant.name,
          tenantCode: invoice.tenant.slug ?? invoice.tenant.id,
          formName: printForm?.name ?? "Τιμολόγιο πώλησης",
          company: {
            vatNumber: company?.vatNumber ?? null,
            address: addressParts.join(", ") || null,
            phone: company?.phone ?? null,
            email: company?.email ?? null,
            bankName: typeof bank.name === "string" ? bank.name : null,
            iban: typeof bank.iban === "string" ? bank.iban : null,
            bic: typeof bank.bic === "string" ? bank.bic : null,
          },
          paymentTerms:
            typeof integrations.paymentTerms === "string"
              ? integrations.paymentTerms
              : "Καθαρό 30 ημέρες",
          shippingAddress: [
            invoice.branch?.address,
            invoice.branch?.city,
            invoice.branch?.postalCode,
          ]
            .filter(Boolean)
            .join(", ") || null,
          customer: {
            name: invoice.customer.name,
            code: invoice.customer.code,
            vatNumber: invoice.customer.vatNumber,
            email: invoice.customer.email,
            phone: invoice.customer.phone,
          },
          branchName: invoice.branch?.name ?? null,
          spaceName: invoice.space?.name ?? null,
          lines: invoice.lines.map((line) => ({
            id: line.id,
            description: line.description,
            quantity: toNumber(line.quantity),
            unitPrice: toNumber(line.unitPrice),
            vatRate: toNumber(line.vatRate),
            lineTotal: toNumber(line.lineTotal),
          })),
        }}
      />
    </div>
  );
}
