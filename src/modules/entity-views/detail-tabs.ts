import { z } from "zod";
import type { EntityModule, Prisma, PrismaClient } from "@/generated/prisma/client";

export type DetailTabKey =
  | "invoices"
  | "orders"
  | "profile"
  | "branches"
  | "activity";

export type DetailTabDef = {
  key: DetailTabKey;
  label: string;
  visible: boolean;
};

export type DetailLayoutConfig = {
  tabs: DetailTabDef[];
  defaultTab?: DetailTabKey;
};

export const CUSTOMER_DETAIL_TABS: DetailTabDef[] = [
  { key: "invoices", label: "Παραστατικά", visible: true },
  { key: "orders", label: "Παραγγελίες", visible: true },
  { key: "profile", label: "Στοιχεία", visible: true },
  { key: "branches", label: "Υποκαταστήματα", visible: true },
  { key: "activity", label: "Δραστηριότητα", visible: true },
];

const DETAIL_TAB_KEYS = CUSTOMER_DETAIL_TABS.map((t) => t.key);

const TAB_CATALOG: Partial<Record<EntityModule, DetailTabDef[]>> = {
  CUSTOMERS: CUSTOMER_DETAIL_TABS,
};

export function getDefaultDetailTabs(entity: EntityModule): DetailTabDef[] {
  return (TAB_CATALOG[entity] ?? []).map((t) => ({ ...t }));
}

export function entitySupportsDetailTabs(entity: EntityModule) {
  return Boolean(TAB_CATALOG[entity]?.length);
}

const detailTabSchema = z.object({
  key: z.enum([
    "invoices",
    "orders",
    "profile",
    "branches",
    "activity",
  ]),
  label: z.string().trim().min(1).max(80).optional(),
  visible: z.boolean(),
});

export const detailLayoutConfigSchema = z.object({
  tabs: z.array(detailTabSchema).min(1).max(20),
  defaultTab: z
    .enum(["invoices", "orders", "profile", "branches", "activity"])
    .optional(),
});

type Db = PrismaClient | Prisma.TransactionClient;

function normalizeConfig(
  entity: EntityModule,
  raw: unknown,
): DetailLayoutConfig {
  const defaults = getDefaultDetailTabs(entity);
  if (!defaults.length) return { tabs: [] };

  const parsed = detailLayoutConfigSchema.safeParse(raw);
  const incoming = parsed.success ? parsed.data.tabs : [];

  const byKey = new Map(incoming.map((t) => [t.key, t]));
  const ordered: DetailTabDef[] = [];

  // Keep configured order first
  for (const t of incoming) {
    const def = defaults.find((d) => d.key === t.key);
    if (!def) continue;
    ordered.push({
      key: t.key,
      label: t.label?.trim() || def.label,
      visible: t.visible,
    });
  }
  // Append any missing defaults
  for (const def of defaults) {
    if (byKey.has(def.key)) continue;
    ordered.push({ ...def });
  }

  const defaultTab =
    parsed.success &&
    parsed.data.defaultTab &&
    ordered.some((t) => t.key === parsed.data.defaultTab && t.visible)
      ? parsed.data.defaultTab
      : (ordered.find((t) => t.visible)?.key ?? ordered[0]?.key);

  return { tabs: ordered, defaultTab };
}

export async function getEntityDetailLayout(
  db: Db,
  tenantId: string,
  entity: EntityModule,
): Promise<DetailLayoutConfig> {
  const defaults = getDefaultDetailTabs(entity);
  if (!defaults.length) return { tabs: [] };

  const row = await db.entityDetailLayout.findUnique({
    where: { tenantId_entity: { tenantId, entity } },
  });
  if (!row) {
    return {
      tabs: defaults,
      defaultTab: defaults.find((t) => t.visible)?.key ?? defaults[0]?.key,
    };
  }
  return normalizeConfig(entity, row.configJson);
}

export async function upsertEntityDetailLayout(
  db: Db,
  tenantId: string,
  entity: EntityModule,
  config: z.infer<typeof detailLayoutConfigSchema> | DetailLayoutConfig,
) {
  if (!entitySupportsDetailTabs(entity)) {
    throw new Error("Η οντότητα δεν υποστηρίζει detail tabs");
  }
  const normalized = normalizeConfig(entity, config);
  // Ensure at least one visible tab
  if (!normalized.tabs.some((t) => t.visible)) {
    normalized.tabs[0]!.visible = true;
  }
  const row = await db.entityDetailLayout.upsert({
    where: { tenantId_entity: { tenantId, entity } },
    create: {
      tenantId,
      entity,
      configJson: normalized,
    },
    update: {
      configJson: normalized,
    },
  });
  return normalizeConfig(entity, row.configJson);
}

export { DETAIL_TAB_KEYS };
