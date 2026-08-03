import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { readMyDataConfig } from "@/modules/mydata/payload";
import { readEInvoicingProvider } from "@/modules/einvoicing/provider";
import { MyDataLiveClient } from "./mydata-live-client";

export const metadata = { title: "myDATA Live" };
export const dynamic = "force-dynamic";

export default async function MyDataLivePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [items, counts, settings] = await Promise.all([
    prisma.myDataSubmission.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.myDataSubmission.groupBy({
      by: ["status"],
      where: { tenantId: session.tenantId },
      _count: { _all: true },
    }),
    prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { integrationsJson: true },
    }),
  ]);

  const byStatus = Object.fromEntries(
    counts.map((c) => [c.status, c._count._all]),
  ) as Record<string, number>;
  const config = readMyDataConfig(settings?.integrationsJson);
  const provider = readEInvoicingProvider(settings?.integrationsJson);

  return (
    <MyDataLiveClient
      canWrite={session.role !== "VIEWER"}
      myDataEnv={config.myDataEnv}
      eInvoicingProvider={provider}
      hasCredentials={Boolean(
        config.myDataUserId && config.myDataSubscriptionKey,
      )}
      initialItems={items.map((s) => ({
        id: s.id,
        entityType: s.entityType,
        entityId: s.entityId,
        entityNumber: s.entityNumber,
        invoiceType: s.invoiceType,
        vatCategory: s.vatCategory,
        status: s.status,
        mark: s.mark,
        uid: s.uid,
        errorMessage: s.errorMessage,
        attempts: s.attempts,
        lastAttemptAt: s.lastAttemptAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        response: s.response,
      }))}
      initialCounts={{
        PENDING: byStatus.PENDING ?? 0,
        SENT: byStatus.SENT ?? 0,
        ACCEPTED: byStatus.ACCEPTED ?? 0,
        REJECTED: byStatus.REJECTED ?? 0,
        CANCELLED: byStatus.CANCELLED ?? 0,
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      }}
    />
  );
}
