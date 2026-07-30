import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { previewNextNumber } from "@/modules/documents/series";
import { SeriesSettingsClient } from "./series-settings-client";

export const metadata = { title: "Σειρές & Τύποι" };
export const dynamic = "force-dynamic";

export default async function SeriesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [sites, series] = await Promise.all([
    prisma.site.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
    }),
    prisma.documentSeries.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      include: {
        site: { select: { id: true, code: true, name: true, kind: true } },
      },
    }),
  ]);

  return (
    <SeriesSettingsClient
      initialSites={sites.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        kind: s.kind,
        parentId: s.parentId,
      }))}
      initialSeries={series.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        kind: s.kind,
        prefix: s.prefix,
        previewNumber: previewNextNumber(s),
        siteId: s.siteId,
        site: s.site,
        affectsCustomer: s.affectsCustomer,
        affectsInventory: s.affectsInventory,
        allowPartial: s.allowPartial,
        myDataEnabled: s.myDataEnabled,
        myDataInvoiceType: s.myDataInvoiceType,
        glDebitAccount: s.glDebitAccount,
        glCreditAccount: s.glCreditAccount,
        glVatAccount: s.glVatAccount,
        isDefault: s.isDefault,
        isActive: s.isActive,
      }))}
    />
  );
}
