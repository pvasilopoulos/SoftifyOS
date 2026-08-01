import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { ensureDefaultLegalEntity } from "@/modules/ledger/controlling";
import { listUserTenants } from "@/modules/org/service";
import { OrgStructureClient } from "./org-structure-client";

export const metadata = { title: "Οργανωτική δομή" };
export const dynamic = "force-dynamic";

export default async function OrgStructurePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  await ensureDefaultLegalEntity(
    prisma,
    session.tenantId,
    session.tenantName,
  );

  const [tenants, companies, sites, bins] = await Promise.all([
    listUserTenants(prisma, session.sub),
    prisma.legalEntity.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    }),
    prisma.site.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, stockBins: true } },
      },
    }),
    prisma.stockBin.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ code: "asc" }],
      include: { site: { select: { id: true, code: true, name: true } } },
    }),
  ]);

  return (
    <OrgStructureClient
      canWrite={session.role === "OWNER" || session.role === "ADMIN"}
      currentTenantId={session.tenantId}
      currentRole={session.role}
      tenants={tenants}
      companies={companies.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        vatNumber: c.vatNumber,
        isDefault: c.isDefault,
        isActive: c.isActive,
      }))}
      sites={sites.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        kind: s.kind as "BRANCH" | "WAREHOUSE" | "TILL",
        isActive: s.isActive,
        parentId: s.parentId,
        parent: s.parent,
        childCount: s._count.children,
        binCount: s._count.stockBins,
      }))}
      bins={bins.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        zone: b.zone,
        isActive: b.isActive,
        siteId: b.siteId,
        siteCode: b.site.code,
        siteName: b.site.name,
      }))}
    />
  );
}
