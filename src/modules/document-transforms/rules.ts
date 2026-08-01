import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { HANDLER_CATALOG } from "./handlers";

type Db = PrismaClient | Prisma.TransactionClient;

const SYSTEM_SEED = HANDLER_CATALOG.map((h, idx) => ({
  code: h.key.toUpperCase(),
  name: h.label,
  description: h.description,
  sourceKind: h.sourceKind,
  targetKind: h.targetKind,
  handlerKey: h.key,
  sortOrder: (idx + 1) * 10,
  allowPartial: h.defaultAllowPartial,
  coverageMode: h.defaultCoverage as "FULL_COPY" | "QUANTITY",
  issueMode: "ISSUE_NOW" as const,
  copyNotes: true,
}));

export async function ensureTransformRules(db: Db, tenantId: string) {
  for (const seed of SYSTEM_SEED) {
    await db.documentTransformRule.upsert({
      where: {
        tenantId_code: { tenantId, code: seed.code },
      },
      create: {
        tenantId,
        ...seed,
        isSystem: true,
        isActive: true,
      },
      update: {
        // Keep user edits to name/flags; refresh system metadata lightly
        sourceKind: seed.sourceKind,
        targetKind: seed.targetKind,
        handlerKey: seed.handlerKey,
        isSystem: true,
      },
    });
  }
}

export async function listTransformRules(
  db: Db,
  tenantId: string,
  opts?: { sourceKind?: string; activeOnly?: boolean },
) {
  await ensureTransformRules(db, tenantId);
  return db.documentTransformRule.findMany({
    where: {
      tenantId,
      ...(opts?.sourceKind ? { sourceKind: opts.sourceKind as never } : {}),
      ...(opts?.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      defaultSeries: {
        select: { id: true, code: true, name: true, kind: true, allowPartial: true },
      },
    },
  });
}

export async function getTransformRule(
  db: Db,
  tenantId: string,
  ruleId: string,
) {
  return db.documentTransformRule.findFirst({
    where: { id: ruleId, tenantId },
    include: {
      defaultSeries: {
        select: { id: true, code: true, name: true, kind: true, allowPartial: true },
      },
    },
  });
}
