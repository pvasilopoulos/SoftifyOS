import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { AuditEventsClient } from "./audit-events-client";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

async function loadFirstPage(tenantId: string) {
  const started = Date.now();
  const rows = await prisma.auditEvent.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      createdAt: true,
      userId: true,
    },
  });
  const ms = Date.now() - started;
  const hasMore = rows.length > 50;
  const items = (hasMore ? rows.slice(0, 50) : rows).map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;
  return { items, nextCursor, ms };
}

export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const first = await loadFirstPage(session.tenantId);

  return (
    <AuditEventsClient
      initialItems={first.items}
      initialNextCursor={first.nextCursor}
      initialMs={first.ms}
    />
  );
}
