import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { toNumber } from "@/modules/sales/invoice-utils";
import { InventoryClient } from "./inventory-client";

export const metadata = { title: "Αποθήκη" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rows, sites, productCount, movementCount] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { tenantId: session.tenantId },
      take: 100,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
            status: true,
            trackInventory: true,
          },
        },
        site: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.site.findMany({
      where: { tenantId: session.tenantId, isActive: true, kind: "BRANCH" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.product.count({
      where: { tenantId: session.tenantId, trackInventory: true },
    }),
    prisma.stockMovement.count({ where: { tenantId: session.tenantId } }),
  ]);

  return (
    <InventoryClient
      initialBalances={rows.map((r) => ({
        id: r.id,
        productId: r.productId,
        sku: r.product.sku,
        name: r.product.name,
        unit: r.product.unit,
        siteId: r.siteId,
        siteCode: r.site.code,
        siteName: r.site.name,
        qtyOnHand: toNumber(r.qtyOnHand),
        updatedAt: r.updatedAt.toISOString(),
      }))}
      initialSites={sites}
      initialMeta={{
        balanceRows: rows.length,
        trackedProducts: productCount,
        movements: movementCount,
      }}
    />
  );
}
