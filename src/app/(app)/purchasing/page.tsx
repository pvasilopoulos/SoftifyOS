import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { toNumber } from "@/modules/sales/invoice-utils";
import { PurchasingClient } from "./purchasing-client";

export const metadata = { title: "Αγορές" };
export const dynamic = "force-dynamic";

export default async function PurchasingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [suppliers, orders, sites, products] = await Promise.all([
    prisma.supplier.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { name: "asc" },
      include: { _count: { select: { purchaseOrders: true } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ orderedAt: "desc" }, { id: "desc" }],
      take: 100,
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        site: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { position: "asc" },
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true } },
          },
        },
      },
    }),
    prisma.site.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.product.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      orderBy: { sku: "asc" },
      take: 500,
      select: { id: true, sku: true, name: true, price: true, vatRate: true },
    }),
  ]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Αγορές</h1>
        <p className="mt-1 text-sm text-slate-600">
          Προμηθευτές, παραγγελίες αγοράς και παραλαβή με ενημέρωση αποθέματος.
        </p>
      </div>
      <PurchasingClient
        initialSuppliers={suppliers.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          vatNumber: s.vatNumber,
          email: s.email,
          phone: s.phone,
          status: s.status,
          purchaseOrderCount: s._count.purchaseOrders,
        }))}
        initialOrders={orders.map((o) => ({
          id: o.id,
          number: o.number,
          status: o.status,
          currency: o.currency,
          orderedAt: o.orderedAt.toISOString(),
          subtotal: toNumber(o.subtotal),
          vatAmount: toNumber(o.vatAmount),
          total: toNumber(o.total),
          notes: o.notes,
          supplier: o.supplier,
          site: o.site,
          lines: o.lines.map((l) => ({
            id: l.id,
            position: l.position,
            description: l.description,
            quantity: toNumber(l.quantity),
            quantityReceived: toNumber(l.quantityReceived),
            unitPrice: toNumber(l.unitPrice),
            vatRate: toNumber(l.vatRate),
            lineTotal: toNumber(l.lineTotal),
            product: l.product,
          })),
        }))}
        sites={sites}
        products={products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          price: toNumber(p.price),
          vatRate: toNumber(p.vatRate),
        }))}
      />
    </div>
  );
}
