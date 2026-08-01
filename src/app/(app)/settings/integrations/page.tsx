import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { IntegrationsClient } from "./integrations-client";

export const metadata = { title: "API & Integrations" };
export const dynamic = "force-dynamic";

type IntegrationsJson = {
  webhookUrl?: string | null;
  webhookSecretHint?: string | null;
  skroutzEnabled?: boolean;
  myDataEnv?: "simulator" | "test" | "prod";
  myDataUserId?: string | null;
  myDataSubscriptionKey?: string | null;
  notes?: string | null;
};

export default async function IntegrationsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await prisma.tenantSettings.upsert({
    where: { tenantId: session.tenantId },
    create: { tenantId: session.tenantId },
    update: {},
  });
  const raw = (settings.integrationsJson as IntegrationsJson | null) ?? {};

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="API & Integrations"
        description="Webhooks, live myDATA/ΑΑΔΕ credentials και εξωτερικές υπηρεσίες."
      />
      <IntegrationsClient
        canWrite={session.role === "OWNER" || session.role === "ADMIN"}
        initial={{
          webhookUrl: raw.webhookUrl ?? "",
          webhookSecretHint: raw.webhookSecretHint ?? "",
          skroutzEnabled: Boolean(raw.skroutzEnabled),
          myDataEnv: raw.myDataEnv ?? "simulator",
          myDataUserId: raw.myDataUserId ?? "",
          myDataSubscriptionKey: "",
          hasMyDataSubscriptionKey: Boolean(raw.myDataSubscriptionKey),
          notes: raw.notes ?? "",
        }}
        endpoints={{
          health: "/api/health",
          scriptsUiEvent: "/api/scripts/ui-event",
          myDataQueue: "/api/mydata/submissions",
          configExport: "/api/settings/export",
        }}
      />
    </div>
  );
}
