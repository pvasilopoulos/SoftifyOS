import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { listPaymentMethods } from "@/modules/payments/service";

type Db = PrismaClient | Prisma.TransactionClient;

export type SeriesPaymentMethodView = {
  id: string;
  code: string;
  name: string;
  kind: string;
  isDefault: boolean;
  sortOrder: number;
  showInPos: boolean;
  showInCollect: boolean;
  isActive: boolean;
};

/** Sync allow-list for a series. Empty ids = clear links (all methods allowed). */
export async function syncSeriesPaymentMethods(
  db: Db,
  input: {
    tenantId: string;
    seriesId: string;
    paymentMethodIds: string[];
    defaultPaymentMethodId?: string | null;
  },
) {
  const uniqueIds = [...new Set(input.paymentMethodIds.filter(Boolean))];

  if (uniqueIds.length > 0) {
    const found = await db.paymentMethod.findMany({
      where: { tenantId: input.tenantId, id: { in: uniqueIds } },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      throw new Error("Μη έγκυρος τρόπος πληρωμής στη σειρά");
    }
  }

  const defaultId =
    input.defaultPaymentMethodId &&
    uniqueIds.includes(input.defaultPaymentMethodId)
      ? input.defaultPaymentMethodId
      : (uniqueIds[0] ?? null);

  await db.documentSeriesPaymentMethod.deleteMany({
    where: { tenantId: input.tenantId, seriesId: input.seriesId },
  });

  if (uniqueIds.length === 0) return;

  await db.documentSeriesPaymentMethod.createMany({
    data: uniqueIds.map((paymentMethodId, index) => ({
      tenantId: input.tenantId,
      seriesId: input.seriesId,
      paymentMethodId,
      isDefault: paymentMethodId === defaultId,
      sortOrder: index,
    })),
  });
}

/**
 * Resolve tenders for a series.
 * No links configured → full catalog (filtered by pos/collect flags).
 * Links configured → only those methods (still respecting pos/collect when requested).
 */
export async function resolveSeriesPaymentMethods(
  db: Db,
  input: {
    tenantId: string;
    seriesId?: string | null;
    posOnly?: boolean;
    collectOnly?: boolean;
    activeOnly?: boolean;
  },
): Promise<SeriesPaymentMethodView[]> {
  const catalog = await listPaymentMethods(db, input.tenantId, {
    activeOnly: input.activeOnly ?? true,
    posOnly: input.posOnly,
    collectOnly: input.collectOnly,
  });

  if (!input.seriesId) {
    return catalog.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      kind: m.kind,
      isDefault: false,
      sortOrder: m.sortOrder,
      showInPos: m.showInPos,
      showInCollect: m.showInCollect,
      isActive: m.isActive,
    }));
  }

  const links = await db.documentSeriesPaymentMethod.findMany({
    where: { tenantId: input.tenantId, seriesId: input.seriesId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  if (links.length === 0) {
    return catalog.map((m, i) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      kind: m.kind,
      isDefault: i === 0,
      sortOrder: m.sortOrder,
      showInPos: m.showInPos,
      showInCollect: m.showInCollect,
      isActive: m.isActive,
    }));
  }

  const byId = new Map(catalog.map((m) => [m.id, m]));
  const ordered: SeriesPaymentMethodView[] = [];
  for (const link of links) {
    const m = byId.get(link.paymentMethodId);
    if (!m) continue;
    ordered.push({
      id: m.id,
      code: m.code,
      name: m.name,
      kind: m.kind,
      isDefault: link.isDefault,
      sortOrder: link.sortOrder,
      showInPos: m.showInPos,
      showInCollect: m.showInCollect,
      isActive: m.isActive,
    });
  }

  if (ordered.length > 0 && !ordered.some((m) => m.isDefault)) {
    ordered[0]!.isDefault = true;
  }

  return ordered;
}

export function mapSeriesPaymentLinks(
  links: {
    paymentMethodId: string;
    isDefault: boolean;
    sortOrder: number;
    paymentMethod: {
      id: string;
      code: string;
      name: string;
      kind: string;
      isActive: boolean;
    };
  }[],
) {
  return {
    allowedPaymentMethodIds: links.map((l) => l.paymentMethodId),
    defaultPaymentMethodId:
      links.find((l) => l.isDefault)?.paymentMethodId ??
      links[0]?.paymentMethodId ??
      null,
    paymentMethods: links.map((l) => ({
      id: l.paymentMethod.id,
      code: l.paymentMethod.code,
      name: l.paymentMethod.name,
      kind: l.paymentMethod.kind,
      isActive: l.paymentMethod.isActive,
      isDefault: l.isDefault,
    })),
  };
}
