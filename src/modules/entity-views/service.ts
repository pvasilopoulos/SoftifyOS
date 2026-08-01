import type {
  EntityModule,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { ENTITY_MODULES } from "./registry";
import { defaultViewsSeed } from "./defaults";
import {
  parseCustomFields,
  parseFormConfig,
  parseListConfig,
  type CustomFieldsMap,
} from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

export async function ensureEntityViewDefaults(db: Db, tenantId: string) {
  for (const entity of ENTITY_MODULES) {
    const seed = defaultViewsSeed(entity);
    // Refresh system CUSTOMERS views so ERP field expansions land in existing tenants
    const refreshSystem = entity === "CUSTOMERS";
    for (const row of seed.list) {
      const existing = await db.entityListView.findUnique({
        where: {
          tenantId_entity_code: { tenantId, entity, code: row.code },
        },
      });
      if (!existing) {
        await db.entityListView.create({
          data: {
            tenantId,
            entity,
            code: row.code,
            name: row.name,
            description: row.description,
            configJson: row.config,
            isDefault: row.isDefault,
            isSystem: row.isSystem,
            isActive: true,
          },
        });
      } else if (refreshSystem && row.isSystem && existing.isSystem) {
        await db.entityListView.update({
          where: { id: existing.id },
          data: {
            name: row.name,
            description: row.description,
            configJson: row.config,
          },
        });
      }
    }
    for (const row of seed.form) {
      const existing = await db.entityFormView.findUnique({
        where: {
          tenantId_entity_code: { tenantId, entity, code: row.code },
        },
      });
      if (!existing) {
        await db.entityFormView.create({
          data: {
            tenantId,
            entity,
            code: row.code,
            name: row.name,
            description: row.description,
            configJson: row.config,
            isDefault: row.isDefault,
            isSystem: row.isSystem,
            isActive: true,
          },
        });
      } else if (refreshSystem && row.isSystem && existing.isSystem) {
        await db.entityFormView.update({
          where: { id: existing.id },
          data: {
            name: row.name,
            description: row.description,
            configJson: row.config,
          },
        });
      }
    }
  }
}

export async function listCustomFields(
  db: Db,
  tenantId: string,
  entity?: EntityModule,
  activeOnly = false,
) {
  return db.customFieldDefinition.findMany({
    where: {
      tenantId,
      ...(entity ? { entity } : {}),
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ entity: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
  });
}

export async function listEntityListViews(
  db: Db,
  tenantId: string,
  entity: EntityModule,
  activeOnly = true,
) {
  await ensureEntityViewDefaults(db, tenantId);
  return db.entityListView.findMany({
    where: {
      tenantId,
      entity,
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listEntityFormViews(
  db: Db,
  tenantId: string,
  entity: EntityModule,
  activeOnly = true,
) {
  await ensureEntityViewDefaults(db, tenantId);
  return db.entityFormView.findMany({
    where: {
      tenantId,
      entity,
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function resolveListView(
  db: Db,
  tenantId: string,
  entity: EntityModule,
  viewIdOrCode?: string | null,
) {
  const views = await listEntityListViews(db, tenantId, entity, true);
  if (viewIdOrCode) {
    const found =
      views.find((v) => v.id === viewIdOrCode || v.code === viewIdOrCode) ??
      null;
    if (found) return found;
  }
  return views.find((v) => v.isDefault) ?? views[0] ?? null;
}

export async function resolveFormView(
  db: Db,
  tenantId: string,
  entity: EntityModule,
  viewIdOrCode?: string | null,
) {
  const views = await listEntityFormViews(db, tenantId, entity, true);
  if (viewIdOrCode) {
    const found =
      views.find((v) => v.id === viewIdOrCode || v.code === viewIdOrCode) ??
      null;
    if (found) return found;
  }
  return views.find((v) => v.isDefault) ?? views[0] ?? null;
}

export function serializeListView(view: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  configJson: unknown;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  entity: EntityModule;
}) {
  return {
    id: view.id,
    entity: view.entity,
    code: view.code,
    name: view.name,
    description: view.description,
    config: parseListConfig(view.configJson),
    isDefault: view.isDefault,
    isSystem: view.isSystem,
    isActive: view.isActive,
    sortOrder: view.sortOrder,
  };
}

export function serializeFormView(view: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  configJson: unknown;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  entity: EntityModule;
}) {
  return {
    id: view.id,
    entity: view.entity,
    code: view.code,
    name: view.name,
    description: view.description,
    config: parseFormConfig(view.configJson),
    isDefault: view.isDefault,
    isSystem: view.isSystem,
    isActive: view.isActive,
    sortOrder: view.sortOrder,
  };
}

export async function normalizeCustomFieldsInput(
  db: Db,
  tenantId: string,
  entity: EntityModule,
  input: unknown,
): Promise<CustomFieldsMap> {
  const defs = await listCustomFields(db, tenantId, entity, true);
  const incoming = parseCustomFields(input);
  const out: CustomFieldsMap = {};
  for (const def of defs) {
    if (!(def.code in incoming)) continue;
    const v = incoming[def.code];
    if (v == null || v === "") {
      continue;
    }
    if (def.type === "NUMBER") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isNaN(n)) out[def.code] = n;
      continue;
    }
    if (def.type === "BOOLEAN") {
      out[def.code] = Boolean(v);
      continue;
    }
    if (def.type === "MULTI_SELECT") {
      out[def.code] = Array.isArray(v)
        ? v.map(String)
        : String(v)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      continue;
    }
    out[def.code] = String(v);
  }
  return out;
}

export async function mergeCustomFields(
  db: Db,
  tenantId: string,
  entity: EntityModule,
  existing: unknown,
  patch: unknown,
): Promise<Prisma.InputJsonValue> {
  const current = parseCustomFields(existing);
  const next = await normalizeCustomFieldsInput(db, tenantId, entity, patch);
  return { ...current, ...next } as Prisma.InputJsonValue;
}
