import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { requireCompanyId } from "@/platform/tenancy/company-scope";
import { prisma } from "@/server/db";
import { toNumber } from "@/modules/sales/invoice-utils";
import { DeliveryNotesClient } from "./delivery-notes-client";

export const metadata = { title: "Δελτία αποστολής" };
export const dynamic = "force-dynamic";

export default async function DeliveryNotesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const legalEntityId = requireCompanyId(session);

  const [notes, customers, products, sites] = await Promise.all([
    prisma.deliveryNote.findMany({
      where: { tenantId: session.tenantId, legalEntityId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        site: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { position: "asc" },
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true } },
          },
        },
      },
    }),
    prisma.customer.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, code: true, name: true },
    }),
    prisma.product.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      orderBy: { sku: "asc" },
      take: 500,
      select: { id: true, sku: true, name: true, unit: true },
    }),
    prisma.site.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Δελτία αποστολής
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Έξοδος εμπορευμάτων προς πελάτη με ενημέρωση αποθέματος.
        </p>
      </div>
      <DeliveryNotesClient
        initialNotes={notes.map((n) => ({
          id: n.id,
          number: n.number,
          status: n.status,
          issuedAt: n.issuedAt?.toISOString() ?? null,
          shippingAddress: n.shippingAddress,
          notes: n.notes,
          customer: n.customer,
          site: n.site,
          lines: n.lines.map((l) => ({
            id: l.id,
            position: l.position,
            description: l.description,
            quantity: toNumber(l.quantity),
            unit: l.unit,
            product: l.product,
          })),
        }))}
        customers={customers}
        products={products}
        sites={sites}
      />
    </div>
  );
}
