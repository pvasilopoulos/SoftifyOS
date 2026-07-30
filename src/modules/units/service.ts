import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_UNITS_OF_MEASURE } from "./labels";
import type { UnitOfMeasureUpsertInput } from "./schemas";

type Db = PrismaClient | Prisma.TransactionClient;

export class UnitOfMeasureError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function ensureUnitsOfMeasure(db: Db, tenantId: string) {
  for (const row of DEFAULT_UNITS_OF_MEASURE) {
    await db.unitOfMeasure.upsert({
      where: { tenantId_code: { tenantId, code: row.code } },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        symbol: row.symbol,
        kind: row.kind,
        decimals: row.decimals,
        description: row.description,
        sortOrder: row.sortOrder,
        isDefault: row.isDefault,
        isSystem: true,
        isActive: true,
      },
      update: {},
    });
  }

  const hasDefault = await db.unitOfMeasure.findFirst({
    where: { tenantId, isDefault: true, isActive: true },
    select: { id: true },
  });
  if (!hasDefault) {
    await db.unitOfMeasure.updateMany({
      where: { tenantId, code: "PCS" },
      data: { isDefault: true, isActive: true },
    });
  }
}

export async function listUnitsOfMeasure(
  db: Db,
  tenantId: string,
  opts?: { activeOnly?: boolean },
) {
  await ensureUnitsOfMeasure(db, tenantId);
  return db.unitOfMeasure.findMany({
    where: {
      tenantId,
      ...(opts?.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function resolveProductUnit(
  db: Db,
  input: {
    tenantId: string;
    unitId?: string | null;
    unit?: string | null;
  },
) {
  await ensureUnitsOfMeasure(db, input.tenantId);

  if (input.unitId) {
    const byId = await db.unitOfMeasure.findFirst({
      where: {
        id: input.unitId,
        tenantId: input.tenantId,
        isActive: true,
      },
    });
    if (!byId) throw new UnitOfMeasureError("Η μονάδα μέτρησης δεν βρέθηκε", 404);
    return byId;
  }

  const symbol = (input.unit || "").trim();
  if (symbol) {
    const bySymbol = await db.unitOfMeasure.findFirst({
      where: {
        tenantId: input.tenantId,
        isActive: true,
        OR: [
          { symbol: { equals: symbol, mode: "insensitive" } },
          { code: { equals: symbol.toUpperCase(), mode: "insensitive" } },
        ],
      },
    });
    if (bySymbol) return bySymbol;
  }

  const fallback = await db.unitOfMeasure.findFirst({
    where: { tenantId: input.tenantId, isDefault: true, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  if (fallback) return fallback;

  const pcs = await db.unitOfMeasure.findFirst({
    where: { tenantId: input.tenantId, code: "PCS" },
  });
  if (!pcs) throw new UnitOfMeasureError("Δεν υπάρχουν μονάδες μέτρησης");
  return pcs;
}

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function createUnitOfMeasure(
  db: Db,
  input: { tenantId: string; data: UnitOfMeasureUpsertInput },
) {
  const clashCode = await db.unitOfMeasure.findUnique({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.data.code },
    },
  });
  if (clashCode) {
    throw new UnitOfMeasureError(`Υπάρχει ήδη κωδικός ${input.data.code}`, 409);
  }
  const clashSymbol = await db.unitOfMeasure.findUnique({
    where: {
      tenantId_symbol: {
        tenantId: input.tenantId,
        symbol: input.data.symbol,
      },
    },
  });
  if (clashSymbol) {
    throw new UnitOfMeasureError(
      `Υπάρχει ήδη σύμβολο «${input.data.symbol}»`,
      409,
    );
  }

  if (input.data.isDefault) {
    await db.unitOfMeasure.updateMany({
      where: { tenantId: input.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  return db.unitOfMeasure.create({
    data: {
      tenantId: input.tenantId,
      code: input.data.code,
      name: input.data.name,
      symbol: input.data.symbol,
      kind: input.data.kind,
      decimals: input.data.decimals ?? 0,
      description: emptyToNull(input.data.description),
      sortOrder: input.data.sortOrder ?? 100,
      isActive: input.data.isActive ?? true,
      isDefault: input.data.isDefault ?? false,
      isSystem: false,
    },
  });
}

export async function updateUnitOfMeasure(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    data: Partial<UnitOfMeasureUpsertInput>;
  },
) {
  const row = await db.unitOfMeasure.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new UnitOfMeasureError("Η μονάδα δεν βρέθηκε", 404);

  if (input.data.code && input.data.code !== row.code) {
    if (row.isSystem) {
      throw new UnitOfMeasureError("Οι system κωδικοί δεν αλλάζουν");
    }
    const clash = await db.unitOfMeasure.findUnique({
      where: {
        tenantId_code: { tenantId: input.tenantId, code: input.data.code },
      },
    });
    if (clash) {
      throw new UnitOfMeasureError(`Υπάρχει ήδη κωδικός ${input.data.code}`, 409);
    }
  }

  if (input.data.symbol && input.data.symbol !== row.symbol) {
    const clash = await db.unitOfMeasure.findUnique({
      where: {
        tenantId_symbol: {
          tenantId: input.tenantId,
          symbol: input.data.symbol,
        },
      },
    });
    if (clash) {
      throw new UnitOfMeasureError(
        `Υπάρχει ήδη σύμβολο «${input.data.symbol}»`,
        409,
      );
    }
  }

  if (input.data.isDefault) {
    await db.unitOfMeasure.updateMany({
      where: {
        tenantId: input.tenantId,
        isDefault: true,
        NOT: { id: row.id },
      },
      data: { isDefault: false },
    });
  }

  const updated = await db.unitOfMeasure.update({
    where: { id: row.id },
    data: {
      ...(input.data.code ? { code: input.data.code } : {}),
      ...(input.data.name ? { name: input.data.name } : {}),
      ...(input.data.symbol ? { symbol: input.data.symbol } : {}),
      ...(input.data.kind ? { kind: input.data.kind } : {}),
      ...(input.data.decimals !== undefined
        ? { decimals: input.data.decimals }
        : {}),
      ...(input.data.description !== undefined
        ? { description: emptyToNull(input.data.description) }
        : {}),
      ...(input.data.sortOrder !== undefined
        ? { sortOrder: input.data.sortOrder }
        : {}),
      ...(input.data.isActive !== undefined
        ? { isActive: input.data.isActive }
        : {}),
      ...(input.data.isDefault !== undefined
        ? { isDefault: input.data.isDefault }
        : {}),
    },
  });

  // Keep denormalized product.unit in sync when symbol changes
  if (input.data.symbol && input.data.symbol !== row.symbol) {
    await db.product.updateMany({
      where: { tenantId: input.tenantId, unitId: row.id },
      data: { unit: updated.symbol },
    });
  }

  return updated;
}

export async function deleteUnitOfMeasure(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const row = await db.unitOfMeasure.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
    include: { _count: { select: { products: true } } },
  });
  if (!row) throw new UnitOfMeasureError("Η μονάδα δεν βρέθηκε", 404);
  if (row.isSystem) {
    throw new UnitOfMeasureError("Οι system μονάδες δεν διαγράφονται");
  }
  if (row._count.products > 0) {
    throw new UnitOfMeasureError(
      `Χρησιμοποιείται από ${row._count.products} προϊόντα — απενεργοποιήστε την`,
    );
  }
  if (row.isDefault) {
    throw new UnitOfMeasureError("Ορίστε άλλη προεπιλογή πριν τη διαγραφή");
  }
  await db.unitOfMeasure.delete({ where: { id: row.id } });
}
