import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import {
  asIntegrationsConfig,
  maskSecret,
} from "@/modules/integrations/types";
import {
  normalizeWebhookEvents,
  publicTokenView,
} from "@/modules/integrations/service";
import { INTEGRATION_API_CATALOG } from "@/modules/integrations/api-catalog";
import { IntegrationsHubClient } from "./integrations-client";

export const metadata = { title: "API & Integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await prisma.tenantSettings.upsert({
    where: { tenantId: session.tenantId },
    create: { tenantId: session.tenantId },
    update: {},
  });
  const raw = asIntegrationsConfig(settings.integrationsJson);

  const [myDataCounts, recentLogs, pendingMyData] = await Promise.all([
    prisma.myDataSubmission.groupBy({
      by: ["status"],
      where: { tenantId: session.tenantId },
      _count: { _all: true },
    }),
    prisma.auditEvent.findMany({
      where: {
        tenantId: session.tenantId,
        OR: [
          { action: { startsWith: "integrations." } },
          { action: { startsWith: "mydata." } },
          { action: { startsWith: "ergani." } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.myDataSubmission.count({
      where: {
        tenantId: session.tenantId,
        status: { in: ["PENDING", "SENT", "REJECTED"] },
      },
    }),
  ]);

  const statusMap = Object.fromEntries(
    myDataCounts.map((r) => [r.status, r._count._all]),
  ) as Record<string, number>;

  return (
    <IntegrationsHubClient
      canWrite={session.role === "OWNER" || session.role === "ADMIN"}
      initial={{
        webhookUrl: raw.webhookUrl ?? "",
        webhookSecretHint: raw.webhookSecretHint ?? "",
        webhookEnabled: raw.webhookEnabled !== false,
        webhookEvents: normalizeWebhookEvents(raw.webhookEvents),
        hasWebhookSecret: Boolean(raw.webhookSecret),
        skroutzEnabled: Boolean(raw.skroutzEnabled),
        skroutzShopId: raw.skroutzShopId ?? "",
        marketplaceNotes: raw.marketplaceNotes ?? "",
        myDataEnv: raw.myDataEnv ?? "simulator",
        myDataUserId: raw.myDataUserId ?? "",
        myDataSubscriptionKey: "",
        hasMyDataSubscriptionKey: Boolean(raw.myDataSubscriptionKey),
        myDataSubscriptionKeyHint: maskSecret(raw.myDataSubscriptionKey),
        notes: raw.notes ?? "",
        erganiEnv: raw.erganiEnv ?? "simulator",
        lastWebhookTest: raw.lastWebhookTest ?? null,
        lastMyDataTest: raw.lastMyDataTest ?? null,
      }}
      tokens={(raw.apiTokens ?? []).map(publicTokenView)}
      status={{
        pendingMyData,
        myDataAccepted: statusMap.ACCEPTED ?? 0,
        myDataRejected: statusMap.REJECTED ?? 0,
        myDataTotal: Object.values(statusMap).reduce((a, b) => a + b, 0),
        activeTokens: (raw.apiTokens ?? []).filter((t) => !t.revokedAt).length,
      }}
      logs={recentLogs.map((l) => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        createdAt: l.createdAt.toISOString(),
        message:
          l.meta && typeof l.meta === "object" && !Array.isArray(l.meta)
            ? String(
                (l.meta as Record<string, unknown>).message ??
                  (l.meta as Record<string, unknown>).ok ??
                  "",
              )
            : "",
        userName: l.user?.name ?? l.user?.email ?? null,
        ok:
          l.meta &&
          typeof l.meta === "object" &&
          !Array.isArray(l.meta) &&
          typeof (l.meta as Record<string, unknown>).ok === "boolean"
            ? Boolean((l.meta as Record<string, unknown>).ok)
            : null,
      }))}
      endpoints={INTEGRATION_API_CATALOG}
    />
  );
}
