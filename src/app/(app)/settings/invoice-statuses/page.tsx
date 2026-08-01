import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { listInvoiceStatusOptions } from "@/modules/sales/invoice-status-options";
import { InvoiceStatusesClient } from "./invoice-statuses-client";

export const metadata = { title: "Καταστάσεις τιμολογίου" };
export const dynamic = "force-dynamic";

export default async function InvoiceStatusesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");

  const items = await listInvoiceStatusOptions(prisma, session.tenantId);

  return (
    <InvoiceStatusesClient
      initialItems={items.map((i: (typeof items)[number]) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        workflow: i.workflow,
        sortOrder: i.sortOrder,
        isActive: i.isActive,
        isSystem: i.isSystem,
        selectableOnCreate: i.selectableOnCreate,
        tone: i.tone,
      }))}
    />
  );
}
