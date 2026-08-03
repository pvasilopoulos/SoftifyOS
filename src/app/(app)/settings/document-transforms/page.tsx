import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { requireCompanyIdForPage } from "@/platform/tenancy/company-scope";
import { prisma } from "@/server/db";
import { listTransformRules } from "@/modules/document-transforms";
import { documentKindLabel } from "@/modules/documents/series";
import { TransformsSettingsClient } from "./transforms-client";

export const metadata = { title: "Μετασχηματισμοί παραστατικών" };
export const dynamic = "force-dynamic";

export default async function DocumentTransformsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");
  const legalEntityId = requireCompanyIdForPage(session);

  const [items, series] = await Promise.all([
    listTransformRules(prisma, session.tenantId),
    prisma.documentSeries.findMany({
      where: { tenantId: session.tenantId, legalEntityId, isActive: true },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, kind: true },
    }),
  ]);

  return (
    <TransformsSettingsClient
      initialItems={items.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        description: i.description,
        sourceKind: i.sourceKind,
        targetKind: i.targetKind,
        handlerKey: i.handlerKey,
        isActive: i.isActive,
        isSystem: i.isSystem,
        sortOrder: i.sortOrder,
        allowPartial: i.allowPartial,
        coverageMode: i.coverageMode,
        issueMode: i.issueMode,
        copyNotes: i.copyNotes,
        defaultSeriesId: i.defaultSeriesId,
        sourceLabel: documentKindLabel[i.sourceKind] ?? i.sourceKind,
        targetLabel: documentKindLabel[i.targetKind] ?? i.targetKind,
      }))}
      series={series.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        kind: s.kind,
        label: `${s.code} · ${documentKindLabel[s.kind] ?? s.kind}`,
      }))}
    />
  );
}
