import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { previewNextNumber } from "@/modules/documents/series";
import { mapSeriesPaymentLinks } from "@/modules/documents/series-payments";
import { ensurePaymentMethods, listPaymentMethods } from "@/modules/payments/service";
import { SeriesSettingsClient } from "./series-settings-client";

export const metadata = { title: "Σειρές & Τύποι" };
export const dynamic = "force-dynamic";

export default async function SeriesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  await ensurePaymentMethods(prisma, session.tenantId);

  const [sites, series, paymentMethods] = await Promise.all([
    prisma.site.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
    }),
    prisma.documentSeries.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      include: {
        site: { select: { id: true, code: true, name: true, kind: true } },
        paymentMethods: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            paymentMethod: {
              select: {
                id: true,
                code: true,
                name: true,
                kind: true,
                isActive: true,
              },
            },
          },
        },
      },
    }),
    listPaymentMethods(prisma, session.tenantId, { activeOnly: true }),
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
      initialPaymentMethods={paymentMethods.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        kind: m.kind,
        showInPos: m.showInPos,
        showInCollect: m.showInCollect,
      }))}
      initialSeries={series.map((s) => {
        const pay = mapSeriesPaymentLinks(s.paymentMethods);
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          kind: s.kind,
          prefix: s.prefix,
          nextNumber: s.nextNumber,
          padLength: s.padLength,
          resetPolicy: s.resetPolicy,
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
          allowedPaymentMethodIds: pay.allowedPaymentMethodIds,
          defaultPaymentMethodId: pay.defaultPaymentMethodId,
          paymentMethods: pay.paymentMethods,
        };
      })}
    />
  );
}
