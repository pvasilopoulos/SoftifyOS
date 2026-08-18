import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { listPaymentMethods } from "@/modules/payments/service";
import { PaymentMethodsClient } from "./payment-methods-client";

export const metadata = { title: "Τρόποι πληρωμής" };
export const dynamic = "force-dynamic";

export default async function PaymentMethodsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (
    session.role !== "SUPER_ADMIN" &&
    session.role !== "OWNER" &&
    session.role !== "ADMIN"
  ) {
    redirect("/settings");
  }

  const items = await listPaymentMethods(prisma, session.tenantId);

  return (
    <PaymentMethodsClient
      initialItems={items.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        kind: m.kind,
        description: m.description,
        glAccount: m.glAccount,
        glContraAccount: m.glContraAccount,
        glClearingAccount: m.glClearingAccount,
        costCenter: m.costCenter,
        accountingCode: m.accountingCode,
        bankIban: m.bankIban,
        bankName: m.bankName,
        myDataPaymentType: m.myDataPaymentType,
        sortOrder: m.sortOrder,
        isActive: m.isActive,
        showInPos: m.showInPos,
        showInCollect: m.showInCollect,
        requiresExternalRef: m.requiresExternalRef,
        allowsChange: m.allowsChange,
        affectsCashDrawer: m.affectsCashDrawer,
        isSystem: m.isSystem,
      }))}
    />
  );
}
