import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { toNumber } from "@/modules/sales/invoice-utils";
import { CrmClient } from "./crm-client";

export const metadata = { title: "CRM" };
export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const leads = await prisma.crmLead.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { _count: { select: { activities: true } } },
  });

  return (
    <CrmClient
      initialLeads={leads.map((l) => ({
        id: l.id,
        title: l.title,
        company: l.company,
        contactName: l.contactName,
        email: l.email,
        phone: l.phone,
        status: l.status,
        value: toNumber(l.value),
        notes: l.notes,
        customerId: l.customerId,
        activityCount: l._count.activities,
      }))}
    />
  );
}
