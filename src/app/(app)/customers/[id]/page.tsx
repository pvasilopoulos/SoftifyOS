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
import { CustomerHierarchyClient } from "./customer-hierarchy-client";
import { CustomerEditPanel } from "./customer-edit-panel";

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
  const [customer, formViews, customFields] = await Promise.all([
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
  ]);

  if (!customer) notFound();

  const payload = {
    ...customer,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
    branches: customer.branches.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      spaces: b.spaces.map((s) => ({
        ...s,
        areaSqm: s.areaSqm == null ? null : Number(s.areaSqm),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    })),
  };

  const fieldDefs = customFields.map((f) => ({
    code: f.code,
    label: f.label,
    type: f.type,
    optionsJson: f.optionsJson,
    required: f.required,
  }));

  return (
    <div className="space-y-5">
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

      <CustomerEditPanel
        customerId={customer.id}
        canEdit={session.role !== "VIEWER"}
        formViews={formViews.map(serializeFormView)}
        customFields={fieldDefs}
        initial={{
          code: customer.code,
          name: customer.name,
          vatNumber: customer.vatNumber,
          email: customer.email,
          phone: customer.phone,
          notes: customer.notes,
          status: customer.status,
          customFields: parseCustomFields(customer.customFields),
        }}
      />

      <CustomerHierarchyClient
        customerId={customer.id}
        initialBranches={payload.branches}
        canEdit={session.role !== "VIEWER"}
      />
    </div>
  );
}
