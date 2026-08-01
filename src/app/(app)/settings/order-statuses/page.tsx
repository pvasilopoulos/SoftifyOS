import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { listOrderStatusOptions } from "@/modules/sales/order-status-options";
import { OrderStatusesClient } from "./order-statuses-client";

export const metadata = { title: "Καταστάσεις παραγγελίας" };
export const dynamic = "force-dynamic";

export default async function OrderStatusesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");

  const items = await listOrderStatusOptions(prisma, session.tenantId);

  return (
    <OrderStatusesClient
      initialItems={items.map((i) => ({
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
