import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { CustomerHierarchyClient } from "./customer-hierarchy-client";

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
  const customer = await prisma.customer.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      branches: {
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        include: {
          spaces: { orderBy: [{ type: "asc" }, { name: "asc" }] },
        },
      },
    },
  });

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

      <div className="grid gap-3 sm:grid-cols-3">
        <Info label="Email" value={customer.email || "—"} />
        <Info label="Τηλέφωνο" value={customer.phone || "—"} />
        <Info
          label="Υποκαταστήματα"
          value={String(customer.branches.length)}
        />
      </div>

      <CustomerHierarchyClient
        customerId={customer.id}
        initialBranches={payload.branches}
        canEdit={session.role !== "VIEWER"}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="soft-panel px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink-900">{value}</p>
    </div>
  );
}
