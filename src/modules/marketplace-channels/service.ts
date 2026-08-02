import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { asIntegrationsConfig } from "@/modules/integrations/types";
import type {
  MarketplaceChannelCreateInput,
  MarketplaceChannelPatchInput,
} from "./schemas";

type Db = PrismaClient | Prisma.TransactionClient;

export class MarketplaceChannelError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "MarketplaceChannelError";
  }
}

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function serializeMarketplaceChannel(row: {
  id: string;
  code: string;
  name: string;
  provider: string;
  status: string;
  merchantId: string | null;
  externalShopId: string | null;
  credentialsSecretKey: string | null;
  apiBaseHost: string | null;
  apiBaseUrl: string | null;
  syncCatalog: boolean;
  syncOrders: boolean;
  syncStock: boolean;
  syncPrices: boolean;
  autoImportOrders: boolean;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  metaJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    provider: row.provider,
    status: row.status,
    merchantId: row.merchantId,
    externalShopId: row.externalShopId,
    credentialsSecretKey: row.credentialsSecretKey,
    apiBaseHost: row.apiBaseHost,
    apiBaseUrl: row.apiBaseUrl,
    syncCatalog: row.syncCatalog,
    syncOrders: row.syncOrders,
    syncStock: row.syncStock,
    syncPrices: row.syncPrices,
    autoImportOrders: row.autoImportOrders,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    notes: row.notes,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
    metaJson:
      row.metaJson && typeof row.metaJson === "object"
        ? (row.metaJson as Record<string, unknown>)
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One-time import of legacy Skroutz JSON flags if no channels exist yet. */
export async function migrateLegacyMarketplaceConfig(
  db: Db,
  tenantId: string,
) {
  const count = await db.marketplaceChannel.count({ where: { tenantId } });
  if (count > 0) return;

  const settings = await db.tenantSettings.findUnique({
    where: { tenantId },
    select: { integrationsJson: true },
  });
  const cfg = asIntegrationsConfig(settings?.integrationsJson);
  if (
    !cfg.skroutzEnabled &&
    !cfg.skroutzShopId &&
    !cfg.marketplaceNotes
  ) {
    return;
  }

  await db.marketplaceChannel.create({
    data: {
      tenantId,
      code: "SKROUTZ",
      name: "Skroutz Marketplace",
      provider: "SKROUTZ",
      status: cfg.skroutzEnabled ? "ACTIVE" : "DRAFT",
      merchantId: emptyToNull(cfg.skroutzShopId),
      notes: emptyToNull(cfg.marketplaceNotes),
      credentialsSecretKey: "MARKETPLACE_TOKEN",
      apiBaseHost: "api.skroutz.gr",
      syncCatalog: true,
      syncOrders: true,
      syncStock: true,
      syncPrices: true,
      isActive: true,
      sortOrder: 10,
    },
  });
}

export async function listMarketplaceChannels(db: Db, tenantId: string) {
  await migrateLegacyMarketplaceConfig(db, tenantId);
  return db.marketplaceChannel.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getMarketplaceChannel(
  db: Db,
  tenantId: string,
  id: string,
) {
  return db.marketplaceChannel.findFirst({
    where: { id, tenantId },
  });
}

export async function createMarketplaceChannel(
  db: Db,
  input: { tenantId: string; data: MarketplaceChannelCreateInput },
) {
  const existing = await db.marketplaceChannel.findUnique({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.data.code },
    },
  });
  if (existing) {
    throw new MarketplaceChannelError(
      `Υπάρχει ήδη κανάλι με κωδικό ${input.data.code}`,
      409,
    );
  }

  return db.marketplaceChannel.create({
    data: {
      tenantId: input.tenantId,
      code: input.data.code,
      name: input.data.name,
      provider: input.data.provider,
      status: input.data.status ?? "DRAFT",
      merchantId: emptyToNull(input.data.merchantId),
      externalShopId: emptyToNull(input.data.externalShopId),
      credentialsSecretKey: emptyToNull(input.data.credentialsSecretKey),
      apiBaseHost: emptyToNull(input.data.apiBaseHost),
      apiBaseUrl: emptyToNull(input.data.apiBaseUrl),
      syncCatalog: input.data.syncCatalog ?? true,
      syncOrders: input.data.syncOrders ?? true,
      syncStock: input.data.syncStock ?? false,
      syncPrices: input.data.syncPrices ?? false,
      autoImportOrders: input.data.autoImportOrders ?? false,
      isActive: input.data.isActive ?? true,
      sortOrder: input.data.sortOrder ?? 100,
      notes: emptyToNull(input.data.notes),
      metaJson: (input.data.metaJson ??
        undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function updateMarketplaceChannel(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    data: MarketplaceChannelPatchInput;
  },
) {
  const row = await getMarketplaceChannel(db, input.tenantId, input.id);
  if (!row) {
    throw new MarketplaceChannelError("Το κανάλι δεν βρέθηκε", 404);
  }

  if (input.data.code && input.data.code !== row.code) {
    const clash = await db.marketplaceChannel.findUnique({
      where: {
        tenantId_code: {
          tenantId: input.tenantId,
          code: input.data.code,
        },
      },
    });
    if (clash) {
      throw new MarketplaceChannelError(
        `Υπάρχει ήδη κανάλι με κωδικό ${input.data.code}`,
        409,
      );
    }
  }

  const d = input.data;
  return db.marketplaceChannel.update({
    where: { id: row.id },
    data: {
      ...(d.code !== undefined ? { code: d.code } : {}),
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.provider !== undefined ? { provider: d.provider } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.merchantId !== undefined
        ? { merchantId: emptyToNull(d.merchantId) }
        : {}),
      ...(d.externalShopId !== undefined
        ? { externalShopId: emptyToNull(d.externalShopId) }
        : {}),
      ...(d.credentialsSecretKey !== undefined
        ? { credentialsSecretKey: emptyToNull(d.credentialsSecretKey) }
        : {}),
      ...(d.apiBaseHost !== undefined
        ? { apiBaseHost: emptyToNull(d.apiBaseHost) }
        : {}),
      ...(d.apiBaseUrl !== undefined
        ? { apiBaseUrl: emptyToNull(d.apiBaseUrl) }
        : {}),
      ...(d.syncCatalog !== undefined ? { syncCatalog: d.syncCatalog } : {}),
      ...(d.syncOrders !== undefined ? { syncOrders: d.syncOrders } : {}),
      ...(d.syncStock !== undefined ? { syncStock: d.syncStock } : {}),
      ...(d.syncPrices !== undefined ? { syncPrices: d.syncPrices } : {}),
      ...(d.autoImportOrders !== undefined
        ? { autoImportOrders: d.autoImportOrders }
        : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
      ...(d.notes !== undefined ? { notes: emptyToNull(d.notes) } : {}),
      ...(d.metaJson !== undefined
        ? {
            metaJson:
              d.metaJson === null
                ? Prisma.JsonNull
                : (d.metaJson as Prisma.InputJsonValue),
          }
        : {}),
    },
  });
}

export async function deleteMarketplaceChannel(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const row = await getMarketplaceChannel(db, input.tenantId, input.id);
  if (!row) {
    throw new MarketplaceChannelError("Το κανάλι δεν βρέθηκε", 404);
  }
  await db.marketplaceChannel.delete({ where: { id: row.id } });
  return { id: row.id };
}

/** Marks a successful sync ping (Script Hooks can call the same fields). */
export async function pingMarketplaceChannelSync(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    ok?: boolean;
    message?: string | null;
  },
) {
  const row = await getMarketplaceChannel(db, input.tenantId, input.id);
  if (!row) {
    throw new MarketplaceChannelError("Το κανάλι δεν βρέθηκε", 404);
  }
  const ok = input.ok !== false;
  return db.marketplaceChannel.update({
    where: { id: row.id },
    data: ok
      ? {
          lastSyncAt: new Date(),
          lastError: null,
          status: row.status === "ERROR" ? "ACTIVE" : row.status,
        }
      : {
          lastError: emptyToNull(input.message) ?? "Sync failed",
          status: "ERROR",
        },
  });
}
