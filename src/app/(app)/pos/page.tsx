import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { toNumber } from "@/modules/sales/invoice-utils";
import { listPaymentMethods } from "@/modules/payments/service";
import { PosClient } from "./pos-client";

export const metadata = { title: "POS Λιανικής" };
export const dynamic = "force-dynamic";

export default async function PosPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [sites, customers, products, terminals, paymentMethods, retailSeries] =
    await Promise.all([
      prisma.site.findMany({
        where: { tenantId: session.tenantId, isActive: true },
        orderBy: [{ kind: "asc" }, { code: "asc" }],
        select: { id: true, code: true, name: true, kind: true },
      }),
      prisma.customer.findMany({
        where: { tenantId: session.tenantId, status: "ACTIVE" },
        orderBy: { name: "asc" },
        take: 100,
        select: { id: true, code: true, name: true },
      }),
      prisma.product.findMany({
        where: { tenantId: session.tenantId, status: "ACTIVE" },
        orderBy: { name: "asc" },
        take: 200,
        select: {
          id: true,
          sku: true,
          barcode: true,
          name: true,
          price: true,
          vatRate: true,
        },
      }),
      prisma.posTerminal.findMany({
        where: { tenantId: session.tenantId, isActive: true },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          provider: true,
          siteId: true,
        },
      }),
      listPaymentMethods(prisma, session.tenantId, { posOnly: true }),
      prisma.documentSeries.findMany({
        where: {
          tenantId: session.tenantId,
          kind: "RETAIL_RECEIPT",
          isActive: true,
        },
        select: {
          id: true,
          paymentMethods: {
            select: { paymentMethodId: true, isDefault: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      }),
    ]);

  return (
    <PosClient
      sites={sites}
      customers={customers}
      products={products.map((p) => ({
        ...p,
        price: toNumber(p.price),
        vatRate: toNumber(p.vatRate),
      }))}
      terminals={terminals.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        provider: t.provider,
      }))}
      paymentMethods={paymentMethods.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        kind: m.kind,
        allowsChange: m.allowsChange,
        requiresExternalRef: m.requiresExternalRef,
      }))}
      seriesPaymentRules={retailSeries.map((s) => ({
        seriesId: s.id,
        allowedPaymentMethodIds: s.paymentMethods.map((p) => p.paymentMethodId),
        defaultPaymentMethodId:
          s.paymentMethods.find((p) => p.isDefault)?.paymentMethodId ??
          s.paymentMethods[0]?.paymentMethodId ??
          null,
      }))}
    />
  );
}
