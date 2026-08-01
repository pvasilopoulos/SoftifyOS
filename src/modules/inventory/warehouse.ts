import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyStockDelta, InventoryError, resolveStockSiteId } from "./service";

type Db = PrismaClient | Prisma.TransactionClient;

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function nextDocNumber(
  db: Db,
  tenantId: string,
  prefix: string,
  table: "stockTransfer" | "stockCount",
) {
  const year = new Date().getFullYear();
  const full = `${prefix}-${year}-`;
  const last =
    table === "stockTransfer"
      ? await db.stockTransfer.findFirst({
          where: { tenantId, number: { startsWith: full } },
          orderBy: { number: "desc" },
          select: { number: true },
        })
      : await db.stockCount.findFirst({
          where: { tenantId, number: { startsWith: full } },
          orderBy: { number: "desc" },
          select: { number: true },
        });
  const seq = last ? Number(last.number.slice(full.length)) + 1 || 1 : 1;
  return `${full}${String(seq).padStart(5, "0")}`;
}

export async function loadWarehouseDashboard(db: Db, tenantId: string) {
  const [
    balanceAgg,
    lowStock,
    expiringLots,
    openTransfers,
    openCounts,
    activeReservations,
    movementToday,
    sites,
    openWaves,
    availableSerials,
    inTransitTransfers,
  ] = await Promise.all([
    db.stockBalance.findMany({
      where: { tenantId },
      select: {
        qtyOnHand: true,
        qtyReserved: true,
        product: { select: { averageCost: true, reorderPoint: true } },
      },
    }),
    db.stockBalance.findMany({
      where: {
        tenantId,
        product: { trackInventory: true, reorderPoint: { not: null } },
      },
      take: 200,
      include: {
        product: { select: { sku: true, name: true, reorderPoint: true } },
        site: { select: { code: true } },
      },
    }),
    db.stockLot.findMany({
      where: {
        tenantId,
        qtyOnHand: { gt: 0 },
        expiresAt: {
          lte: new Date(Date.now() + 30 * 86_400_000),
          gte: new Date(),
        },
      },
      take: 50,
      orderBy: { expiresAt: "asc" },
      include: {
        product: { select: { sku: true, name: true } },
        site: { select: { code: true } },
      },
    }),
    db.stockTransfer.count({
      where: {
        tenantId,
        status: { in: ["DRAFT", "IN_TRANSIT"] },
      },
    }),
    db.stockCount.count({
      where: {
        tenantId,
        status: { in: ["DRAFT", "IN_PROGRESS", "COUNTED"] },
      },
    }),
    db.stockReservation.count({
      where: { tenantId, status: "ACTIVE" },
    }),
    db.stockMovement.count({
      where: {
        tenantId,
        createdAt: { gte: new Date(new Date().toDateString()) },
      },
    }),
    db.site.count({
      where: {
        tenantId,
        isActive: true,
        kind: { in: ["WAREHOUSE", "BRANCH"] },
      },
    }),
    db.pickWave.count({
      where: {
        tenantId,
        status: { in: ["DRAFT", "RELEASED", "PICKING"] },
      },
    }),
    db.stockSerial.count({
      where: { tenantId, status: "AVAILABLE" },
    }),
    db.stockTransfer.findMany({
      where: { tenantId, status: "IN_TRANSIT" },
      include: {
        lines: {
          include: {
            product: { select: { averageCost: true } },
          },
        },
      },
    }),
  ]);

  let stockValue = 0;
  let qtyTotal = 0;
  let reservedTotal = 0;
  for (const b of balanceAgg) {
    const qty = Number(b.qtyOnHand);
    const reserved = Number(b.qtyReserved);
    qtyTotal += qty;
    reservedTotal += reserved;
    const cost = Number(b.product.averageCost ?? 0);
    stockValue += qty * cost;
  }

  let inTransitValue = 0;
  let inTransitQty = 0;
  for (const t of inTransitTransfers) {
    for (const l of t.lines) {
      const qty = Number(l.qty);
      inTransitQty += qty;
      inTransitValue += qty * Number(l.product.averageCost ?? 0);
    }
  }

  const low = lowStock
    .filter((b) => {
      const rp = Number(b.product.reorderPoint ?? 0);
      return rp > 0 && Number(b.qtyOnHand) <= rp;
    })
    .slice(0, 20)
    .map((b) => ({
      productId: b.productId,
      sku: b.product.sku,
      name: b.product.name,
      siteCode: b.site.code,
      qtyOnHand: Number(b.qtyOnHand),
      reorderPoint: Number(b.product.reorderPoint ?? 0),
    }));

  return {
    kpis: {
      sites,
      skuPositions: balanceAgg.length,
      qtyTotal: round3(qtyTotal),
      qtyAvailable: round3(qtyTotal - reservedTotal),
      qtyReserved: round3(reservedTotal),
      stockValue: round2(stockValue),
      lowStockCount: low.length,
      expiringLots: expiringLots.length,
      openTransfers,
      openCounts,
      activeReservations,
      movementsToday: movementToday,
      openWaves,
      availableSerials,
      inTransitValue: round2(inTransitValue),
      inTransitQty: round3(inTransitQty),
    },
    lowStock: low,
    expiringLots: expiringLots.map((l) => ({
      id: l.id,
      lotCode: l.lotCode,
      sku: l.product.sku,
      name: l.product.name,
      siteCode: l.site.code,
      qtyOnHand: Number(l.qtyOnHand),
      expiresAt: l.expiresAt?.toISOString() ?? null,
    })),
  };
}

export async function listBins(db: Db, tenantId: string, siteId?: string) {
  return db.stockBin.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(siteId ? { siteId } : {}),
    },
    orderBy: [{ siteId: "asc" }, { code: "asc" }],
    include: { site: { select: { code: true, name: true } } },
  });
}

export async function upsertBin(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    code: string;
    name: string;
    zone?: string | null;
  },
) {
  return db.stockBin.upsert({
    where: {
      tenantId_siteId_code: {
        tenantId: input.tenantId,
        siteId: input.siteId,
        code: input.code,
      },
    },
    create: {
      tenantId: input.tenantId,
      siteId: input.siteId,
      code: input.code,
      name: input.name,
      zone: input.zone ?? null,
      isActive: true,
    },
    update: {
      name: input.name,
      zone: input.zone ?? undefined,
      isActive: true,
    },
  });
}

export async function createTransfer(
  db: Db,
  input: {
    tenantId: string;
    fromSiteId: string;
    toSiteId: string;
    note?: string | null;
    userId?: string | null;
    ship?: boolean;
    lines: Array<{ productId: string; qty: number; lotCode?: string | null }>;
  },
) {
  if (input.fromSiteId === input.toSiteId) {
    throw new InventoryError("Η προέλευση και ο προορισμός πρέπει να διαφέρουν");
  }
  if (!input.lines.length) throw new InventoryError("Απαιτούνται γραμμές");

  const number = await nextDocNumber(db, input.tenantId, "TR", "stockTransfer");
  const transfer = await db.stockTransfer.create({
    data: {
      tenantId: input.tenantId,
      number,
      status: "DRAFT",
      fromSiteId: input.fromSiteId,
      toSiteId: input.toSiteId,
      note: input.note ?? null,
      createdByUserId: input.userId ?? null,
      lines: {
        create: input.lines.map((l, i) => ({
          tenantId: input.tenantId,
          productId: l.productId,
          qty: l.qty,
          lotCode: l.lotCode ?? null,
          lineNo: i + 1,
        })),
      },
    },
    include: {
      lines: true,
      fromSite: { select: { code: true, name: true } },
      toSite: { select: { code: true, name: true } },
    },
  });

  if (input.ship) {
    return shipTransfer(db, {
      tenantId: input.tenantId,
      transferId: transfer.id,
      userId: input.userId,
    });
  }
  return transfer;
}

export async function shipTransfer(
  db: Db,
  input: { tenantId: string; transferId: string; userId?: string | null },
) {
  const transfer = await db.stockTransfer.findFirst({
    where: { id: input.transferId, tenantId: input.tenantId },
    include: { lines: true },
  });
  if (!transfer) throw new InventoryError("Η μεταφορά δεν βρέθηκε");
  if (transfer.status !== "DRAFT" && transfer.status !== "IN_TRANSIT") {
    throw new InventoryError("Η μεταφορά δεν μπορεί να αποσταλεί");
  }
  if (transfer.status === "DRAFT") {
    for (const line of transfer.lines) {
      await applyStockDelta(db, {
        tenantId: input.tenantId,
        siteId: transfer.fromSiteId,
        productId: line.productId,
        delta: -Number(line.qty),
        type: "OUT",
        source: "TRANSFER",
        note: `Μεταφορά ${transfer.number} (έξοδος)`,
        lotCode: line.lotCode,
        refType: "stock_transfer",
        refId: transfer.id,
        userId: input.userId,
        allowNegative: false,
      });
      if (line.lotCode) {
        await adjustLot(db, {
          tenantId: input.tenantId,
          siteId: transfer.fromSiteId,
          productId: line.productId,
          lotCode: line.lotCode,
          delta: -Number(line.qty),
        });
      }
    }
  }
  return db.stockTransfer.update({
    where: { id: transfer.id },
    data: {
      status: "IN_TRANSIT",
      shippedAt: transfer.shippedAt ?? new Date(),
    },
    include: {
      lines: true,
      fromSite: { select: { code: true, name: true } },
      toSite: { select: { code: true, name: true } },
    },
  });
}

export async function receiveTransfer(
  db: Db,
  input: { tenantId: string; transferId: string; userId?: string | null },
) {
  const transfer = await db.stockTransfer.findFirst({
    where: { id: input.transferId, tenantId: input.tenantId },
    include: { lines: true },
  });
  if (!transfer) throw new InventoryError("Η μεταφορά δεν βρέθηκε");
  if (transfer.status !== "IN_TRANSIT") {
    throw new InventoryError("Η μεταφορά πρέπει να είναι σε διαδρομή");
  }
  for (const line of transfer.lines) {
    await applyStockDelta(db, {
      tenantId: input.tenantId,
      siteId: transfer.toSiteId,
      productId: line.productId,
      delta: Number(line.qty),
      type: "IN",
      source: "TRANSFER",
      note: `Μεταφορά ${transfer.number} (είσοδος)`,
      lotCode: line.lotCode,
      refType: "stock_transfer",
      refId: transfer.id,
      userId: input.userId,
      allowNegative: true,
    });
    if (line.lotCode) {
      await adjustLot(db, {
        tenantId: input.tenantId,
        siteId: transfer.toSiteId,
        productId: line.productId,
        lotCode: line.lotCode,
        delta: Number(line.qty),
      });
    }
  }
  return db.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "COMPLETED", receivedAt: new Date() },
    include: {
      lines: true,
      fromSite: { select: { code: true, name: true } },
      toSite: { select: { code: true, name: true } },
    },
  });
}

async function adjustLot(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    lotCode: string;
    delta: number;
  },
) {
  const existing = await db.stockLot.findUnique({
    where: {
      tenantId_siteId_productId_lotCode: {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: input.productId,
        lotCode: input.lotCode,
      },
    },
  });
  const before = existing ? Number(existing.qtyOnHand) : 0;
  const after = round3(before + input.delta);
  if (after < -0.0005) {
    throw new InventoryError(`Ανεπαρκές lot ${input.lotCode}`);
  }
  if (existing) {
    await db.stockLot.update({
      where: { id: existing.id },
      data: { qtyOnHand: new Prisma.Decimal(after) },
    });
  } else if (after > 0) {
    await db.stockLot.create({
      data: {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: input.productId,
        lotCode: input.lotCode,
        qtyOnHand: new Prisma.Decimal(after),
      },
    });
  }
}

export async function createCountSession(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    note?: string | null;
    userId?: string | null;
    productIds?: string[];
  },
) {
  const siteId = await resolveStockSiteId(db, input.tenantId, input.siteId);
  const balances = await db.stockBalance.findMany({
    where: {
      tenantId: input.tenantId,
      siteId,
      ...(input.productIds?.length
        ? { productId: { in: input.productIds } }
        : {}),
      product: { trackInventory: true },
    },
    take: 500,
    orderBy: { updatedAt: "desc" },
  });
  if (!balances.length) {
    throw new InventoryError("Δεν υπάρχουν υπόλοιπα για απογραφή σε αυτή την αποθήκη");
  }
  const number = await nextDocNumber(db, input.tenantId, "CNT", "stockCount");
  return db.stockCount.create({
    data: {
      tenantId: input.tenantId,
      number,
      siteId,
      status: "IN_PROGRESS",
      note: input.note ?? null,
      createdByUserId: input.userId ?? null,
      lines: {
        create: balances.map((b, i) => ({
          tenantId: input.tenantId,
          productId: b.productId,
          systemQty: b.qtyOnHand,
          lineNo: i + 1,
        })),
      },
    },
    include: {
      site: { select: { code: true, name: true } },
      lines: {
        include: {
          product: { select: { sku: true, name: true, unit: true } },
        },
        orderBy: { lineNo: "asc" },
      },
    },
  });
}

export async function submitCountLines(
  db: Db,
  input: {
    tenantId: string;
    countId: string;
    lines: Array<{ lineId: string; countedQty: number }>;
  },
) {
  const count = await db.stockCount.findFirst({
    where: { id: input.countId, tenantId: input.tenantId },
  });
  if (!count) throw new InventoryError("Η απογραφή δεν βρέθηκε");
  if (count.status !== "IN_PROGRESS" && count.status !== "DRAFT") {
    throw new InventoryError("Η απογραφή δεν δέχεται καταμέτρηση");
  }
  for (const line of input.lines) {
    const existing = await db.stockCountLine.findFirst({
      where: { id: line.lineId, countId: count.id, tenantId: input.tenantId },
    });
    if (!existing) continue;
    const system = Number(existing.systemQty);
    const counted = round3(line.countedQty);
    await db.stockCountLine.update({
      where: { id: existing.id },
      data: {
        countedQty: counted,
        varianceQty: round3(counted - system),
      },
    });
  }
  return db.stockCount.update({
    where: { id: count.id },
    data: { status: "COUNTED", countedAt: new Date() },
    include: {
      site: { select: { code: true, name: true } },
      lines: {
        include: {
          product: { select: { sku: true, name: true, unit: true } },
        },
        orderBy: { lineNo: "asc" },
      },
    },
  });
}

export async function postCount(
  db: Db,
  input: { tenantId: string; countId: string; userId?: string | null },
) {
  const count = await db.stockCount.findFirst({
    where: { id: input.countId, tenantId: input.tenantId },
    include: { lines: true },
  });
  if (!count) throw new InventoryError("Η απογραφή δεν βρέθηκε");
  if (count.status !== "COUNTED") {
    throw new InventoryError("Καταχωρήστε πρώτα τις μετρήσεις");
  }
  for (const line of count.lines) {
    if (line.countedQty == null) continue;
    const target = Number(line.countedQty);
    await applyStockDelta(db, {
      tenantId: input.tenantId,
      siteId: count.siteId,
      productId: line.productId,
      type: "ADJUST",
      adjustTo: target,
      source: "COUNT",
      note: `Απογραφή ${count.number}`,
      refType: "stock_count",
      refId: count.id,
      userId: input.userId,
      allowNegative: true,
    });
  }
  return db.stockCount.update({
    where: { id: count.id },
    data: { status: "POSTED", postedAt: new Date() },
    include: {
      site: { select: { code: true, name: true } },
      lines: {
        include: {
          product: { select: { sku: true, name: true, unit: true } },
        },
      },
    },
  });
}

export async function createReservation(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    qty: number;
    refType?: string | null;
    refId?: string | null;
    note?: string | null;
    userId?: string | null;
    expiresAt?: Date | null;
  },
) {
  const qty = round3(Math.abs(input.qty));
  if (!qty) throw new InventoryError("Μη έγκυρη ποσότητα κράτησης");
  const siteId = await resolveStockSiteId(db, input.tenantId, input.siteId);
  const balance = await db.stockBalance.findUnique({
    where: {
      tenantId_siteId_productId: {
        tenantId: input.tenantId,
        siteId,
        productId: input.productId,
      },
    },
  });
  const onHand = balance ? Number(balance.qtyOnHand) : 0;
  const reserved = balance ? Number(balance.qtyReserved) : 0;
  const available = round3(onHand - reserved);
  if (qty > available + 0.0005) {
    throw new InventoryError(
      `Ανεπαρκές διαθέσιμο απόθεμα (διαθέσιμο ${available})`,
    );
  }
  if (balance) {
    await db.stockBalance.update({
      where: { id: balance.id },
      data: { qtyReserved: new Prisma.Decimal(round3(reserved + qty)) },
    });
  } else {
    throw new InventoryError("Δεν υπάρχει υπόλοιπο για κράτηση");
  }
  return db.stockReservation.create({
    data: {
      tenantId: input.tenantId,
      siteId,
      productId: input.productId,
      qty,
      status: "ACTIVE",
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      note: input.note ?? null,
      expiresAt: input.expiresAt ?? null,
      createdByUserId: input.userId ?? null,
    },
    include: {
      product: { select: { sku: true, name: true } },
      site: { select: { code: true, name: true } },
    },
  });
}

export async function releaseReservation(
  db: Db,
  input: { tenantId: string; reservationId: string },
) {
  const resv = await db.stockReservation.findFirst({
    where: { id: input.reservationId, tenantId: input.tenantId },
  });
  if (!resv) throw new InventoryError("Η κράτηση δεν βρέθηκε");
  if (resv.status !== "ACTIVE") {
    throw new InventoryError("Η κράτηση δεν είναι ενεργή");
  }
  const balance = await db.stockBalance.findUnique({
    where: {
      tenantId_siteId_productId: {
        tenantId: input.tenantId,
        siteId: resv.siteId,
        productId: resv.productId,
      },
    },
  });
  if (balance) {
    const next = Math.max(0, round3(Number(balance.qtyReserved) - Number(resv.qty)));
    await db.stockBalance.update({
      where: { id: balance.id },
      data: { qtyReserved: new Prisma.Decimal(next) },
    });
  }
  return db.stockReservation.update({
    where: { id: resv.id },
    data: { status: "RELEASED" },
  });
}

/** FEFO: pick lots by earliest expiry for outbound */
export async function allocateLotsFefo(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    qty: number;
  },
) {
  const need = round3(Math.abs(input.qty));
  const lots = await db.stockLot.findMany({
    where: {
      tenantId: input.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      qtyOnHand: { gt: 0 },
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
  });
  const picks: Array<{ lotCode: string; qty: number; expiresAt: Date | null }> =
    [];
  let remaining = need;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const available = Number(lot.qtyOnHand);
    const take = Math.min(available, remaining);
    if (take > 0) {
      picks.push({
        lotCode: lot.lotCode,
        qty: round3(take),
        expiresAt: lot.expiresAt,
      });
      remaining = round3(remaining - take);
    }
  }
  return { picks, shortfall: remaining };
}

export async function loadValuation(db: Db, tenantId: string, siteId?: string) {
  const { loadInTransitValuation } = await import("./wms-advanced");
  const rows = await db.stockBalance.findMany({
    where: {
      tenantId,
      ...(siteId ? { siteId } : {}),
      qtyOnHand: { gt: 0 },
    },
    include: {
      product: {
        select: {
          sku: true,
          name: true,
          unit: true,
          averageCost: true,
          price: true,
          altUnitId: true,
          altToBaseFactor: true,
          altUnit: { select: { code: true, symbol: true } },
        },
      },
      site: { select: { code: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  const items = rows.map((r) => {
    const qty = Number(r.qtyOnHand);
    const cost = Number(r.product.averageCost ?? 0);
    const value = round2(qty * cost);
    const factor = Number(r.product.altToBaseFactor ?? 0);
    return {
      productId: r.productId,
      sku: r.product.sku,
      name: r.product.name,
      unit: r.product.unit,
      altUnit: r.product.altUnit?.symbol ?? null,
      qtyAlt:
        factor > 0 ? round3(qty / factor) : null,
      siteCode: r.site.code,
      siteName: r.site.name,
      qtyOnHand: qty,
      qtyReserved: Number(r.qtyReserved),
      qtyAvailable: round3(qty - Number(r.qtyReserved)),
      averageCost: cost,
      stockValue: value,
    };
  });
  const onHandValue = round2(items.reduce((s, i) => s + i.stockValue, 0));
  const inTransit = await loadInTransitValuation(db, tenantId);
  return {
    items,
    totalValue: onHandValue,
    onHandValue,
    inTransitValue: inTransit.totalValue,
    inTransitQty: inTransit.totalQty,
    inTransitItems: inTransit.items,
    combinedValue: round2(onHandValue + inTransit.totalValue),
  };
}
