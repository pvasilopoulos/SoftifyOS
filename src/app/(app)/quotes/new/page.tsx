import { NewOrderForm } from "@/app/(app)/orders/new/new-order-form";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";

export const metadata = { title: "Νέα προσφορά" };
export const dynamic = "force-dynamic";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string; customerId?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  let initialCustomerId = sp.customerId || "";
  let leadNote: string | null = null;

  if (session && sp.leadId) {
    const lead = await prisma.crmLead.findFirst({
      where: { id: sp.leadId, tenantId: session.tenantId },
      select: {
        id: true,
        title: true,
        company: true,
        contactName: true,
        customerId: true,
        notes: true,
        value: true,
      },
    });
    if (lead) {
      if (!initialCustomerId && lead.customerId) {
        initialCustomerId = lead.customerId;
      }
      leadNote = [
        `CRM lead: ${lead.title}`,
        lead.company ? `Εταιρεία: ${lead.company}` : null,
        lead.contactName ? `Επαφή: ${lead.contactName}` : null,
        lead.notes,
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  return (
    <NewOrderForm
      kind="SALES_QUOTE"
      initialCustomerId={initialCustomerId || undefined}
      initialNotes={leadNote || undefined}
    />
  );
}
