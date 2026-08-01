import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

export async function resolveStockSiteId(
  db: Db,
  tenantId: string,
  preferredSiteId?: string | null,
): Promise<string> {
  if (preferredSiteId) {
    const site = await db.site.findFirst({
      where: { id: preferredSiteId, tenantId, isActive: true },
      select: { id: true },
    });
    if (site) return site.id;
  }

  const branch = await db.site.findFirst({
    where: { tenantId, isActive: true, kind: "BRANCH" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (branch) return branch.id;

  const any = await db.site.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (any) return any.id;

  // Auto-create default warehouse site
  const created = await db.site.create({
    data: {
      tenantId,
      code: "MAIN",
      name: "Κεντρική αποθήκη",
      kind: "BRANCH",
      isActive: true,
    },
    select: { id: true },
  });
  return created.id;
}

export async function applyStockDelta(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    /** Signed delta: +IN, -OUT. For ADJUST set type ADJUST and pass absolute target via adjustTo */
    delta?: number;
    adjustTo?: number;
    type: "IN" | "OUT" | "ADJUST";
    source:
      | "MANUAL"
      | "INVOICE"
      | "CREDIT"
      | "ADJUSTMENT"
      | "OPENING"
      | "PURCHASE"
      | "RECEIPT"
      | "DELIVERY"
      | "TRANSFER"
      | "COUNT"
      | "RESERVE";
    lotCode?: string | null;
    serial?: string | null;
    unitCost?: number | null;
    uomId?: string | null;
    qtyInUom?: number | null;
    note?: string | null;
    refType?: string | null;
    refId?: string | null;
    userId?: string | null;
    allowNegative?: boolean;
  },
) {
  const product = await db.product.findFirst({
    where: { id: input.productId, tenantId: input.tenantId },
    select: {
      id: true,
      trackInventory: true,
      trackSerials: true,
      sku: true,
      name: true,
      averageCost: true,
    },
  });
  if (!product) throw new InventoryError("Το προϊόν δεν βρέθηκε");
  if (!product.trackInventory) {
    return { skipped: true as const, productId: product.id };
  }
  if (product.trackSerials && !input.serial?.trim()) {
    throw new InventoryError(
      `Το προϊόν ${product.sku} απαιτεί serial number`,
    );
  }

  const existing = await db.stockBalance.findUnique({
    where: {
      tenantId_siteId_productId: {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: input.productId,
      },
    },
  });

  const before = existing ? Number(existing.qtyOnHand) : 0;
  let after: number;
  let qty: number;
  let type = input.type;

  if (input.type === "ADJUST" && input.adjustTo != null) {
    after = input.adjustTo;
    qty = Math.abs(after - before);
    if (after > before) type = "IN";
    else if (after < before) type = "OUT";
    else {
      // no-op
      return {
        skipped: false as const,
        movementId: null,
        qtyBefore: before,
        qtyAfter: after,
      };
    }
  } else {
    let delta = Number(input.delta ?? 0);
    if (!Number.isFinite(delta) || delta === 0) {
      throw new InventoryError("Μη έγκυρη ποσότητα κίνησης");
    }
    if (input.type === "OUT") delta = -Math.abs(delta);
    if (input.type === "IN") delta = Math.abs(delta);
    after = before + delta;
    qty = Math.abs(delta);
  }

  after = Math.round(after * 1000) / 1000;
  qty = Math.round(qty * 1000) / 1000;

  if (!input.allowNegative && after < -0.0005) {
    throw new InventoryError(
      `Ανεπαρκές απόθεμα για ${product.sku} (διαθέσιμο ${before})`,
    );
  }

  if (existing) {
    await db.stockBalance.update({
      where: { id: existing.id },
      data: { qtyOnHand: new Prisma.Decimal(after) },
    });
  } else {
    await db.stockBalance.create({
      data: {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: input.productId,
        qtyOnHand: new Prisma.Decimal(after),
      },
    });
  }

  const unitCost =
    input.unitCost != null
      ? input.unitCost
      : product.averageCost != null
        ? Number(product.averageCost)
        : null;

  const movement = await db.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      type: type === "ADJUST" ? (after >= before ? "IN" : "OUT") : type,
      source: input.source,
      qty: new Prisma.Decimal(qty),
      qtyBefore: new Prisma.Decimal(before),
      qtyAfter: new Prisma.Decimal(after),
      unitCost:
        unitCost == null ? null : new Prisma.Decimal(Math.round(unitCost * 10000) / 10000),
      note: input.note ?? null,
      lotCode: input.lotCode ?? null,
      serial: input.serial?.trim() || null,
      uomId: input.uomId ?? null,
      qtyInUom:
        input.qtyInUom == null
          ? null
          : new Prisma.Decimal(Math.round(input.qtyInUom * 1000) / 1000),
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      userId: input.userId ?? null,
    },
  });

  return {
    skipped: false as const,
    movementId: movement.id,
    qtyBefore: before,
    qtyAfter: after,
  };
}

/** Apply series inventory effect for invoice lines */
export async function applyInvoiceInventoryEffect(
  db: Db,
  input: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    siteId: string | null | undefined;
    effect: "NONE" | "OUT" | "IN";
    lines: Array<{ productId: string | null; quantity: number; description: string }>;
    userId?: string | null;
    allowNegative?: boolean;
  },
) {
  if (input.effect === "NONE") {
    return { applied: 0, skipped: 0, movements: [] as string[] };
  }

  const siteId = await resolveStockSiteId(
    db,
    input.tenantId,
    input.siteId,
  );

  let applied = 0;
  let skipped = 0;
  const movements: string[] = [];

  for (const line of input.lines) {
    if (!line.productId) {
      skipped += 1;
      continue;
    }
    const qty = Math.abs(Number(line.quantity));
    if (!qty) {
      skipped += 1;
      continue;
    }

    const delta = input.effect === "OUT" ? -qty : qty;
    const result = await applyStockDelta(db, {
      tenantId: input.tenantId,
      siteId,
      productId: line.productId,
      delta,
      type: input.effect === "OUT" ? "OUT" : "IN",
      source: input.effect === "OUT" ? "INVOICE" : "CREDIT",
      note: `Παραστατικό ${input.invoiceNumber}`,
      refType: "invoice",
      refId: input.invoiceId,
      userId: input.userId,
      allowNegative: input.allowNegative ?? true,
    });

    if (result.skipped) skipped += 1;
    else {
      applied += 1;
      if (result.movementId) movements.push(result.movementId);
    }
  }

  return { applied, skipped, movements, siteId };
}
