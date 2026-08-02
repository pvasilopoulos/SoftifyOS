import { notFound, redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { requireCompanyId } from "@/platform/tenancy/company-scope";
import { prisma } from "@/server/db";
import { invoiceKindLabel } from "@/modules/documents/series";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  InvoiceDetailClient,
  type InvoiceDetailPayload,
} from "./invoice-detail-client";

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
  const legalEntityId = requireCompanyId(session);

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: session.tenantId, legalEntityId },
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
          myDataEnabled: true,
          myDataInvoiceType: true,
          affectsCustomer: true,
          affectsInventory: true,
          glDebitAccount: true,
          glCreditAccount: true,
          glVatAccount: true,
          editableAfterIssue: true,
        },
      },
      relatedInvoice: { select: { id: true, number: true, kind: true } },
      order: { select: { id: true, number: true } },
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
      deliveryNotes: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          number: true,
          status: true,
          issuedAt: true,
        },
      },
      payments: {
        orderBy: { paidAt: "desc" },
        select: {
          id: true,
          amount: true,
          method: true,
          note: true,
          paidAt: true,
          changeAmount: true,
        },
      },
      lines: {
        orderBy: { position: "asc" },
        include: {
          product: {
            select: { id: true, sku: true, name: true, unit: true },
          },
        },
      },
    },
  });
  if (!invoice) notFound();

  const deliveryIds = invoice.deliveryNotes.map((d) => d.id);

  const [audits, journals, stockMovements, myData] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        tenantId: session.tenantId,
        entity: "invoice",
        entityId: invoice.id,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.journalEntry.findMany({
      where: {
        tenantId: session.tenantId,
        sourceId: invoice.id,
        sourceType: { startsWith: "invoice" },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        number: true,
        sourceType: true,
        description: true,
        postedAt: true,
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        tenantId: session.tenantId,
        OR: [
          { refType: "invoice", refId: invoice.id },
          ...(deliveryIds.length
            ? [{ refType: "delivery_note", refId: { in: deliveryIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        product: { select: { sku: true, name: true } },
        site: { select: { code: true } },
      },
    }),
    prisma.myDataSubmission.findMany({
      where: {
        tenantId: session.tenantId,
        entityType: "invoice",
        entityId: invoice.id,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        mark: true,
        uid: true,
        invoiceType: true,
        createdAt: true,
      },
    }),
  ]);

  const payload: InvoiceDetailPayload = {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    kind: invoice.kind,
    kindLabel:
      invoiceKindLabel[invoice.kind as keyof typeof invoiceKindLabel] ??
      invoice.kind,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    dueAt: invoice.dueAt?.toISOString() ?? null,
    currency: invoice.currency,
    subtotal: toNumber(invoice.subtotal),
    vatAmount: toNumber(invoice.vatAmount),
    total: toNumber(invoice.total),
    paidAmount: toNumber(invoice.paidAmount),
    notes: invoice.notes,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    customer: {
      id: invoice.customer.id,
      code: invoice.customer.code,
      name: invoice.customer.name,
      vatNumber: invoice.customer.vatNumber,
      email: invoice.customer.email,
      phone: invoice.customer.phone,
    },
    branch: invoice.branch,
    space: invoice.space,
    site: invoice.site,
    series: invoice.series
      ? {
          id: invoice.series.id,
          code: invoice.series.code,
          name: invoice.series.name,
          myDataEnabled: invoice.series.myDataEnabled,
          myDataInvoiceType: invoice.series.myDataInvoiceType,
          affectsCustomer: invoice.series.affectsCustomer,
          affectsInventory: invoice.series.affectsInventory,
          glDebitAccount: invoice.series.glDebitAccount,
          glCreditAccount: invoice.series.glCreditAccount,
          glVatAccount: invoice.series.glVatAccount,
          editableAfterIssue: invoice.series.editableAfterIssue,
        }
      : null,
    relatedInvoice: invoice.relatedInvoice,
    order: invoice.order,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPrice),
      vatRate: toNumber(line.vatRate),
      lineTotal: toNumber(line.lineTotal),
      product: line.product
        ? {
            id: line.product.id,
            sku: line.product.sku,
            name: line.product.name,
            unit: line.product.unit,
          }
        : null,
    })),
    payments: invoice.payments.map((p) => ({
      id: p.id,
      amount: toNumber(p.amount),
      method: p.method,
      note: p.note,
      paidAt: p.paidAt.toISOString(),
      changeAmount: toNumber(p.changeAmount),
    })),
    creditNotes: invoice.creditNotes.map((c) => ({
      id: c.id,
      number: c.number,
      status: c.status,
      total: toNumber(c.total),
      createdAt: c.createdAt.toISOString(),
    })),
    deliveryNotes: invoice.deliveryNotes.map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      issuedAt: d.issuedAt?.toISOString() ?? null,
    })),
    myData: myData.map((m) => ({
      id: m.id,
      status: m.status,
      mark: m.mark,
      uid: m.uid,
      invoiceType: m.invoiceType,
      createdAt: m.createdAt.toISOString(),
    })),
    journals: journals.map((j) => ({
      id: j.id,
      number: j.number,
      sourceType: j.sourceType,
      description: j.description,
      postedAt: j.postedAt?.toISOString() ?? null,
    })),
    stockMovements: stockMovements.map((m) => ({
      id: m.id,
      type: m.type,
      qty: toNumber(m.qty),
      sku: m.product.sku,
      productName: m.product.name,
      siteCode: m.site.code,
      createdAt: m.createdAt.toISOString(),
    })),
    audits: audits.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
      userName: a.user?.name || a.user?.email || null,
      meta: a.meta,
    })),
    canWrite: session.role !== "VIEWER",
  };

  return <InvoiceDetailClient invoice={payload} />;
}
