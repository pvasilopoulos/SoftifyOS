import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { requireCompanyId } from "@/platform/tenancy/company-scope";
import { prisma } from "@/server/db";
import { previewNextNumber } from "@/modules/documents/series";
import { mapSeriesPaymentLinks } from "@/modules/documents/series-payments";
import { ensurePaymentMethods, listPaymentMethods } from "@/modules/payments/service";
import {
  ensureDefaultPrintForms,
  listPrintForms,
  mapSeriesPrintLinks,
} from "@/modules/print-forms/service";
import { SeriesSettingsClient } from "./series-settings-client";

export const metadata = { title: "Σειρές & Τύποι" };
export const dynamic = "force-dynamic";

export default async function SeriesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const legalEntityId = requireCompanyId(session);

  await Promise.all([
    ensurePaymentMethods(prisma, session.tenantId),
    ensureDefaultPrintForms(prisma, session.tenantId),
  ]);

  const [sites, series, paymentMethods, printForms] = await Promise.all([
    prisma.site.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
    }),
    prisma.documentSeries.findMany({
      where: { tenantId: session.tenantId, legalEntityId },
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
        printForms: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            printForm: {
              select: {
                id: true,
                code: true,
                name: true,
                documentKind: true,
                isActive: true,
              },
            },
          },
        },
      },
    }),
    listPaymentMethods(prisma, session.tenantId, { activeOnly: true }),
    listPrintForms(prisma, session.tenantId, { activeOnly: true }),
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
      initialPrintForms={printForms.map((f) => ({
        id: f.id,
        code: f.code,
        name: f.name,
        documentKind: f.documentKind,
      }))}
      initialSeries={series.map((s) => {
        const pay = mapSeriesPaymentLinks(s.paymentMethods);
        const forms = mapSeriesPrintLinks(s.printForms);
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
          allowedPrintFormIds: forms.allowedPrintFormIds,
          defaultPrintFormId: forms.defaultPrintFormId,
          printForms: forms.printForms,
        };
      })}
    />
  );
}
