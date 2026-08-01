import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { toNumber } from "@/modules/sales/invoice-utils";
import { resolveStockSiteId } from "@/modules/inventory/service";
import { InventoryClient } from "./inventory-client";

export const metadata = { title: "Αποθήκη" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  await resolveStockSiteId(prisma, session.tenantId);

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
            barcode: true,
            reorderPoint: true,
            averageCost: true,
          },
        },
        site: { select: { id: true, code: true, name: true } },
        bin: { select: { code: true } },
      },
    }),
    prisma.site.findMany({
      where: {
        tenantId: session.tenantId,
        isActive: true,
        kind: { in: ["WAREHOUSE", "BRANCH"] },
      },
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
      initialBalances={rows.map((r) => {
        const qtyOnHand = toNumber(r.qtyOnHand);
        const qtyReserved = toNumber(r.qtyReserved);
        const reorderPoint =
          r.product.reorderPoint == null
            ? null
            : toNumber(r.product.reorderPoint);
        return {
          id: r.id,
          productId: r.productId,
          sku: r.product.sku,
          name: r.product.name,
          unit: r.product.unit,
          barcode: r.product.barcode,
          siteId: r.siteId,
          siteCode: r.site.code,
          siteName: r.site.name,
          binCode: r.bin?.code ?? null,
          qtyOnHand,
          qtyReserved,
          qtyAvailable: Math.round((qtyOnHand - qtyReserved) * 1000) / 1000,
          reorderPoint,
          averageCost:
            r.product.averageCost == null
              ? null
              : toNumber(r.product.averageCost),
          isLow:
            reorderPoint != null &&
            reorderPoint > 0 &&
            qtyOnHand <= reorderPoint,
          updatedAt: r.updatedAt.toISOString(),
        };
      })}
      initialSites={sites}
      initialMeta={{
        balanceRows: rows.length,
        trackedProducts: productCount,
        movements: movementCount,
      }}
    />
  );
}
