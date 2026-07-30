import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { listUnitsOfMeasure } from "@/modules/units/service";
import { UnitsSettingsClient } from "./units-settings-client";

export const metadata = { title: "Μονάδες μέτρησης" };
export const dynamic = "force-dynamic";

export default async function UnitsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    redirect("/settings");
  }

  const items = await listUnitsOfMeasure(prisma, session.tenantId);
  const counts = await prisma.product.groupBy({
    by: ["unitId"],
    where: { tenantId: session.tenantId, unitId: { not: null } },
    _count: { _all: true },
  });
  const countByUnit = Object.fromEntries(
    counts.map((c) => [c.unitId!, c._count._all]),
  );

  return (
    <UnitsSettingsClient
      initialItems={items.map((u) => ({
        id: u.id,
        code: u.code,
        name: u.name,
        symbol: u.symbol,
        kind: u.kind,
        decimals: u.decimals,
        description: u.description,
        sortOrder: u.sortOrder,
        isActive: u.isActive,
        isDefault: u.isDefault,
        isSystem: u.isSystem,
        productCount: countByUnit[u.id] ?? 0,
      }))}
    />
  );
}
