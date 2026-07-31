import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import {
  SCRIPT_EVENTS_BY_MODULE,
  SCRIPT_TEMPLATE,
} from "@/modules/scripts/events";
import { ScriptsSettingsClient } from "./scripts-client";

export const metadata = { title: "Scripts" };
export const dynamic = "force-dynamic";

export default async function ScriptsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    redirect("/settings");
  }

  const [scripts, secrets, allowlist, settings, recentLogs] = await Promise.all([
    prisma.scriptDefinition.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [
        { module: "asc" },
        { eventKey: "asc" },
        { sortOrder: "asc" },
        { code: "asc" },
      ],
    }),
    prisma.scriptSecret.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { key: "asc" },
      select: { id: true, key: true, updatedAt: true, createdAt: true },
    }),
    prisma.scriptHttpAllowlist.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { host: "asc" },
    }),
    prisma.scriptSettings.upsert({
      where: { tenantId: session.tenantId },
      create: { tenantId: session.tenantId },
      update: {},
    }),
    prisma.scriptRunLog.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        scriptId: true,
        module: true,
        eventKey: true,
        success: true,
        durationMs: true,
        error: true,
        httpCalls: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <ScriptsSettingsClient
      initialScripts={scripts.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }))}
      initialSecrets={secrets.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }))}
      initialAllowlist={allowlist.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      }))}
      initialSettings={{
        scriptsEnabled: settings.scriptsEnabled,
        maxTimeoutMs: settings.maxTimeoutMs,
        maxHttpCalls: settings.maxHttpCalls,
      }}
      initialLogs={recentLogs.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      }))}
      template={SCRIPT_TEMPLATE}
      eventsByModule={SCRIPT_EVENTS_BY_MODULE}
    />
  );
}
