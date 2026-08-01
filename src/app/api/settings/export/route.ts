import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

/** Export tenant configuration snapshot (JSON) — χωρίς secrets/passwords. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [
      tenant,
      settings,
      series,
      paymentMethods,
      units,
      glAccounts,
      roles,
      groups,
      sites,
    ] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { slug: true, name: true },
      }),
      prisma.tenantSettings.findUnique({ where: { tenantId: session.tenantId } }),
      prisma.documentSeries.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { code: "asc" },
      }),
      prisma.paymentMethod.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { code: "asc" },
      }),
      prisma.unitOfMeasure.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { code: "asc" },
      }),
      prisma.glAccount.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { code: "asc" },
      }),
      prisma.appRole.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { code: "asc" },
        select: {
          code: true,
          name: true,
          description: true,
          permissions: true,
          isSystem: true,
        },
      }),
      prisma.userGroup.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { code: "asc" },
        select: { code: true, name: true, description: true },
      }),
      prisma.site.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { code: "asc" },
        select: { code: true, name: true, kind: true, isActive: true },
      }),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      format: "softifyos-config-v1",
      tenant,
      organization: settings
        ? {
            legalName: settings.legalName,
            tradeName: settings.tradeName,
            vatNumber: settings.vatNumber,
            taxOffice: settings.taxOffice,
            address: settings.address,
            city: settings.city,
            postalCode: settings.postalCode,
            country: settings.country,
            phone: settings.phone,
            email: settings.email,
            website: settings.website,
            currency: settings.currency,
            locale: settings.locale,
            timezone: settings.timezone,
            maintenanceMode: settings.maintenanceMode,
          }
        : null,
      sites,
      documentSeries: series.map((s) => ({
        code: s.code,
        name: s.name,
        kind: s.kind,
        prefix: s.prefix,
        padLength: s.padLength,
        isDefault: s.isDefault,
        isActive: s.isActive,
        myDataEnabled: s.myDataEnabled,
        myDataInvoiceType: s.myDataInvoiceType,
        affectsInventory: s.affectsInventory,
        affectsCustomer: s.affectsCustomer,
      })),
      paymentMethods: paymentMethods.map((m) => ({
        code: m.code,
        name: m.name,
        kind: m.kind,
        isActive: m.isActive,
        showInPos: m.showInPos,
        showInCollect: m.showInCollect,
      })),
      units: units.map((u) => ({
        code: u.code,
        name: u.name,
        symbol: u.symbol,
        kind: u.kind,
        isActive: u.isActive,
      })),
      glAccounts: glAccounts.map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        isActive: a.isActive,
        isPostable: a.isPostable,
      })),
      roles,
      groups,
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="softifyos-${tenant?.slug ?? "tenant"}-config.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Export failed") },
      { status: 500 },
    );
  }
}
