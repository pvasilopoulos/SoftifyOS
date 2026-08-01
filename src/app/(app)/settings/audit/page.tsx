import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { encodeCursor } from "@/shared/lib/cursor";
import { AuditEventsClient } from "./audit-events-client";

export const metadata = { title: "Καταγραφή ενεργειών" };
export const dynamic = "force-dynamic";

async function loadFirstPage(tenantId: string) {
  const started = Date.now();
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60_000);
  const dayAgo = new Date(now - 24 * 60 * 60_000);

  const [rows, total, lastHour, last24h, auth24h, risk24h] = await Promise.all([
    prisma.auditEvent.findMany({
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
        meta: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.auditEvent.count({ where: { tenantId } }),
    prisma.auditEvent.count({
      where: { tenantId, createdAt: { gte: hourAgo } },
    }),
    prisma.auditEvent.count({
      where: { tenantId, createdAt: { gte: dayAgo } },
    }),
    prisma.auditEvent.count({
      where: {
        tenantId,
        createdAt: { gte: dayAgo },
        action: { startsWith: "auth." },
      },
    }),
    prisma.auditEvent.count({
      where: {
        tenantId,
        createdAt: { gte: dayAgo },
        OR: [
          { action: { contains: "delete" } },
          { action: { contains: "fail" } },
          { action: { contains: "cancel" } },
        ],
      },
    }),
  ]);

  const ms = Date.now() - started;
  const hasMore = rows.length > 50;
  const page = hasMore ? rows.slice(0, 50) : rows;
  const items = page.map((row) => ({
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
    userId: row.userId,
    meta: row.meta,
    user: row.user,
  }));
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;

  return {
    items,
    nextCursor,
    ms,
    total,
    summary: { lastHour, last24h, auth24h, risk24h },
  };
}

export default async function SettingsAuditPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    redirect("/settings");
  }

  const first = await loadFirstPage(session.tenantId);

  return (
    <div className="space-y-4">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} /> Ρυθμίσεις
      </Link>
      <AuditEventsClient
        initialItems={first.items}
        initialNextCursor={first.nextCursor}
        initialMs={first.ms}
        initialTotal={first.total}
        initialSummary={first.summary}
      />
    </div>
  );
}
