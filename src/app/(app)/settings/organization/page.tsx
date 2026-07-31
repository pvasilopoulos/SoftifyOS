import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { OrganizationClient } from "./organization-client";

export const metadata = { title: "Στοιχεία εταιρείας" };
export const dynamic = "force-dynamic";

export default async function OrganizationSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [tenant, settings] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: session.tenantId },
      select: { slug: true, name: true },
    }),
    prisma.tenantSettings.upsert({
      where: { tenantId: session.tenantId },
      create: { tenantId: session.tenantId },
      update: {},
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Στοιχεία εταιρείας"
        description="Ταυτότητα tenant, επικοινωνία, νόμισμα και maintenance mode."
      />
      <OrganizationClient
        tenant={tenant}
        canWrite={session.role === "OWNER" || session.role === "ADMIN"}
        initial={{
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
          logoUrl: settings.logoUrl,
          currency: settings.currency,
          locale: settings.locale,
          timezone: settings.timezone,
          maintenanceMode: settings.maintenanceMode,
        }}
      />
    </div>
  );
}
