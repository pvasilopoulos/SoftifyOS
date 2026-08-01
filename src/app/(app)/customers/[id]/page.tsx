import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import {
  listCustomFields,
  listEntityFormViews,
  serializeFormView,
} from "@/modules/entity-views/service";
import { parseCustomFields } from "@/modules/entity-views/types";
import { Customer360 } from "./customer-360";
import { toNumber } from "@/modules/sales/invoice-utils";
import { getEntityDetailLayout } from "@/modules/entity-views/detail-tabs";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await prisma.customer.findFirst({
    where: { id },
    select: { name: true },
  });
  return { title: customer?.name ?? "Πελάτης" };
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const [
    customer,
    formViews,
    customFields,
    invoices,
    orders,
    activities,
    detailLayout,
  ] = await Promise.all([
    prisma.customer.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        branches: {
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
          include: {
            spaces: { orderBy: [{ type: "asc" }, { name: "asc" }] },
          },
        },
      },
    }),
    listEntityFormViews(prisma, session.tenantId, "CUSTOMERS", true),
    listCustomFields(prisma, session.tenantId, "CUSTOMERS", true),
    prisma.invoice.findMany({
      where: { tenantId: session.tenantId, customerId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        paidAmount: true,
        issuedAt: true,
      },
    }),
    prisma.order.findMany({
      where: { tenantId: session.tenantId, customerId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        number: true,
        status: true,
        kind: true,
        total: true,
      },
    }),
    prisma.crmActivity.findMany({
      where: { tenantId: session.tenantId, customerId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    getEntityDetailLayout(prisma, session.tenantId, "CUSTOMERS"),
  ]);

  if (!customer) notFound();

  const openInvoices = invoices.filter((i) =>
    ["ISSUED", "PARTIAL", "OVERDUE"].includes(i.status),
  );
  const openBalance = openInvoices.reduce(
    (s, i) => s + Math.max(0, toNumber(i.total) - toNumber(i.paidAmount)),
    0,
  );

  const fieldDefs = customFields.map((f) => ({
    code: f.code,
    label: f.label,
    type: f.type,
    optionsJson: f.optionsJson,
    required: f.required,
  }));

  const branches = customer.branches.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    address: b.address,
    city: b.city,
    postalCode: b.postalCode,
    phone: b.phone,
    isPrimary: b.isPrimary,
    spaces: b.spaces.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      type: s.type,
      floorLabel: s.floorLabel,
      areaSqm: s.areaSqm == null ? null : Number(s.areaSqm),
      notes: s.notes,
    })),
  }));

  return (
    <div className="space-y-5">
      {/* Region: header */}
      <div>
        <Link
          href="/customers"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Πελάτες
        </Link>
        <PageHeader
          title={customer.name}
          description={`${customer.code}${customer.vatNumber ? ` · ΑΦΜ ${customer.vatNumber}` : ""}`}
          actions={
            <Badge tone={customer.status === "ACTIVE" ? "emerald" : "slate"}>
              {customer.status === "ACTIVE" ? "Ενεργός" : "Ανενεργός"}
            </Badge>
          }
        />
      </div>

      <Customer360
        customerId={customer.id}
        canWrite={session.role !== "VIEWER"}
        openBalance={openBalance}
        openInvoices={openInvoices.length}
        detailLayout={detailLayout}
        customer={{
          code: customer.code,
          name: customer.name,
          vatNumber: customer.vatNumber,
          email: customer.email,
          phone: customer.phone,
          notes: customer.notes,
          status: customer.status,
          customFields: parseCustomFields(customer.customFields),
        }}
        formViews={formViews.map(serializeFormView)}
        customFields={fieldDefs}
        branches={branches}
        invoices={invoices.map((i) => ({
          id: i.id,
          number: i.number,
          status: i.status,
          total: toNumber(i.total),
          balance: Math.max(0, toNumber(i.total) - toNumber(i.paidAmount)),
          issuedAt: i.issuedAt?.toISOString() ?? null,
        }))}
        orders={orders.map((o) => ({
          id: o.id,
          number: o.number,
          status: o.status,
          kind: o.kind,
          total: toNumber(o.total),
        }))}
        activities={activities.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          dueAt: a.dueAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
