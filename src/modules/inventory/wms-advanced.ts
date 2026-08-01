import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyStockDelta, InventoryError } from "./service";
import { allocateLotsFefo, createReservation } from "./warehouse";

type Db = PrismaClient | Prisma.TransactionClient;

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

async function nextWaveNumber(db: Db, tenantId: string) {
  const year = new Date().getFullYear();
  const full = `WV-${year}-`;
  const last = await db.pickWave.findFirst({
    where: { tenantId, number: { startsWith: full } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const seq = last ? Number(last.number.slice(full.length)) + 1 || 1 : 1;
  return `${full}${String(seq).padStart(5, "0")}`;
}

/** Convert qty from alt/base UoM into base stock units */
export async function toBaseQty(
  db: Db,
  input: {
    tenantId: string;
    productId: string;
    qty: number;
    useAltUnit?: boolean;
    fromUnitId?: string | null;
  },
) {
  const product = await db.product.findFirst({
    where: { id: input.productId, tenantId: input.tenantId },
    select: {
      unitId: true,
      altUnitId: true,
      altToBaseFactor: true,
    },
  });
  if (!product) throw new InventoryError("Προϊόν δεν βρέθηκε");

  if (input.useAltUnit || (input.fromUnitId && input.fromUnitId === product.altUnitId)) {
    const factor = Number(product.altToBaseFactor ?? 0);
    if (!(factor > 0)) {
      throw new InventoryError("Λείπει συντελεστής dual UoM (alt→base)");
    }
    return {
      baseQty: round3(input.qty * factor),
      qtyInUom: input.qty,
      uomId: product.altUnitId,
      factor,
    };
  }

  if (input.fromUnitId && product.unitId && input.fromUnitId !== product.unitId) {
    const conv = await db.unitConversion.findFirst({
      where: {
        tenantId: input.tenantId,
        fromUnitId: input.fromUnitId,
        toUnitId: product.unitId,
        OR: [{ productId: input.productId }, { productId: null }],
      },
      orderBy: { productId: "desc" },
    });
    if (!conv) {
      throw new InventoryError("Δεν υπάρχει μετατροπή μονάδων");
    }
    const factor = Number(conv.factor);
    return {
      baseQty: round3(input.qty * factor),
      qtyInUom: input.qty,
      uomId: input.fromUnitId,
      factor,
    };
  }

  return {
    baseQty: round3(input.qty),
    qtyInUom: input.qty,
    uomId: product.unitId,
    factor: 1,
  };
}

export async function upsertProductDualUom(
  db: Db,
  input: {
    tenantId: string;
    productId: string;
    altUnitId: string | null;
    altToBaseFactor: number | null;
  },
) {
  const product = await db.product.findFirst({
    where: { id: input.productId, tenantId: input.tenantId },
  });
  if (!product) throw new InventoryError("Προϊόν δεν βρέθηκε");
  if (input.altUnitId) {
    const unit = await db.unitOfMeasure.findFirst({
      where: { id: input.altUnitId, tenantId: input.tenantId },
    });
    if (!unit) throw new InventoryError("Εναλλακτική μονάδα δεν βρέθηκε");
  }
  if (input.altUnitId && !(Number(input.altToBaseFactor) > 0)) {
    throw new InventoryError("Ο συντελεστής alt→base πρέπει να είναι > 0");
  }
  return db.product.update({
    where: { id: product.id },
    data: {
      altUnitId: input.altUnitId,
      altToBaseFactor:
        input.altToBaseFactor == null
          ? null
          : new Prisma.Decimal(round6(input.altToBaseFactor)),
    },
    select: {
      id: true,
      sku: true,
      altUnitId: true,
      altToBaseFactor: true,
      unitId: true,
      unit: true,
    },
  });
}

// ─── Serials ───────────────────────────────────────────────────────────────

export async function registerSerial(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    serial: string;
    binId?: string | null;
    lotCode?: string | null;
    note?: string | null;
    receiveStock?: boolean;
    userId?: string | null;
  },
) {
  const serial = input.serial.trim();
  if (!serial) throw new InventoryError("Serial υποχρεωτικό");
  const product = await db.product.findFirst({
    where: { id: input.productId, tenantId: input.tenantId },
    select: { id: true, trackSerials: true, sku: true },
  });
  if (!product) throw new InventoryError("Προϊόν δεν βρέθηκε");

  const existing = await db.stockSerial.findUnique({
    where: {
      tenantId_productId_serial: {
        tenantId: input.tenantId,
        productId: input.productId,
        serial,
      },
    },
  });
  if (existing && existing.status !== "SHIPPED" && existing.status !== "SCRAPPED") {
    throw new InventoryError(`Το serial ${serial} υπάρχει ήδη (${existing.status})`);
  }

  const row = existing
    ? await db.stockSerial.update({
        where: { id: existing.id },
        data: {
          siteId: input.siteId,
          status: "AVAILABLE",
          binId: input.binId ?? null,
          lotCode: input.lotCode ?? null,
          note: input.note ?? null,
        },
      })
    : await db.stockSerial.create({
        data: {
          tenantId: input.tenantId,
          siteId: input.siteId,
          productId: input.productId,
          serial,
          status: "AVAILABLE",
          binId: input.binId ?? null,
          lotCode: input.lotCode ?? null,
          note: input.note ?? null,
        },
      });

  if (input.receiveStock !== false) {
    await applyStockDelta(db, {
      tenantId: input.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      delta: 1,
      type: "IN",
      source: "RECEIPT",
      serial,
      lotCode: input.lotCode,
      note: input.note || `Serial ${serial}`,
      refType: "stock_serial",
      refId: row.id,
      userId: input.userId,
    });
    if (!product.trackSerials) {
      await db.product.update({
        where: { id: product.id },
        data: { trackSerials: true },
      });
    }
  }

  return row;
}

export async function listSerials(
  db: Db,
  tenantId: string,
  opts?: { siteId?: string; status?: string; q?: string },
) {
  return db.stockSerial.findMany({
    where: {
      tenantId,
      ...(opts?.siteId ? { siteId: opts.siteId } : {}),
      ...(opts?.status
        ? { status: opts.status as "AVAILABLE" | "RESERVED" | "IN_TRANSIT" | "SHIPPED" | "SCRAPPED" }
        : {}),
      ...(opts?.q
        ? {
            OR: [
              { serial: { contains: opts.q, mode: "insensitive" } },
              { product: { sku: { contains: opts.q, mode: "insensitive" } } },
              { product: { barcode: { contains: opts.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      product: { select: { sku: true, name: true, barcode: true } },
      site: { select: { code: true, name: true } },
      bin: { select: { code: true } },
    },
  });
}

export async function shipSerial(
  db: Db,
  input: {
    tenantId: string;
    serialId: string;
    userId?: string | null;
  },
) {
  const row = await db.stockSerial.findFirst({
    where: { id: input.serialId, tenantId: input.tenantId },
  });
  if (!row) throw new InventoryError("Serial δεν βρέθηκε");
  if (row.status !== "AVAILABLE" && row.status !== "RESERVED") {
    throw new InventoryError("Το serial δεν είναι διαθέσιμο για έξοδο");
  }
  await applyStockDelta(db, {
    tenantId: input.tenantId,
    siteId: row.siteId,
    productId: row.productId,
    delta: -1,
    type: "OUT",
    source: "DELIVERY",
    serial: row.serial,
    lotCode: row.lotCode,
    note: `Serial ship ${row.serial}`,
    refType: "stock_serial",
    refId: row.id,
    userId: input.userId,
    allowNegative: false,
  });
  return db.stockSerial.update({
    where: { id: row.id },
    data: { status: "SHIPPED" },
  });
}

// ─── Putaway ───────────────────────────────────────────────────────────────

export async function upsertPutawayRule(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    code: string;
    name: string;
    targetBinId: string;
    priority?: number;
    strategy?: "FIXED" | "ZONE" | "EMPTY_BIN";
    productId?: string | null;
    zone?: string | null;
  },
) {
  const bin = await db.stockBin.findFirst({
    where: {
      id: input.targetBinId,
      tenantId: input.tenantId,
      siteId: input.siteId,
    },
  });
  if (!bin) throw new InventoryError("Target bin δεν βρέθηκε στο site");

  return db.putawayRule.upsert({
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
      targetBinId: input.targetBinId,
      priority: input.priority ?? 100,
      strategy: input.strategy ?? "FIXED",
      productId: input.productId ?? null,
      zone: input.zone ?? null,
      isActive: true,
    },
    update: {
      name: input.name,
      targetBinId: input.targetBinId,
      priority: input.priority ?? undefined,
      strategy: input.strategy ?? undefined,
      productId: input.productId ?? undefined,
      zone: input.zone ?? undefined,
      isActive: true,
    },
    include: {
      targetBin: { select: { code: true, name: true, zone: true } },
      product: { select: { sku: true, name: true } },
    },
  });
}

export async function listPutawayRules(db: Db, tenantId: string, siteId?: string) {
  return db.putawayRule.findMany({
    where: {
      tenantId,
      ...(siteId ? { siteId } : {}),
      isActive: true,
    },
    orderBy: [{ priority: "asc" }, { code: "asc" }],
    include: {
      targetBin: { select: { code: true, name: true, zone: true } },
      product: { select: { sku: true, name: true } },
      site: { select: { code: true, name: true } },
    },
  });
}

export async function suggestPutaway(
  db: Db,
  input: { tenantId: string; siteId: string; productId: string },
) {
  const rules = await db.putawayRule.findMany({
    where: {
      tenantId: input.tenantId,
      siteId: input.siteId,
      isActive: true,
      OR: [{ productId: input.productId }, { productId: null }],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    include: {
      targetBin: true,
    },
  });

  for (const rule of rules) {
    if (rule.strategy === "FIXED" || rule.strategy === "ZONE") {
      return {
        rule,
        bin: rule.targetBin,
        reason:
          rule.productId
            ? "Product-specific rule"
            : rule.zone
              ? `Zone ${rule.zone}`
              : "Default fixed bin",
      };
    }
    if (rule.strategy === "EMPTY_BIN") {
      const occupied = await db.stockBalance.findFirst({
        where: {
          tenantId: input.tenantId,
          siteId: input.siteId,
          binId: rule.targetBinId,
          qtyOnHand: { gt: 0 },
          NOT: { productId: input.productId },
        },
      });
      if (!occupied) {
        return {
          rule,
          bin: rule.targetBin,
          reason: "Empty bin strategy",
        };
      }
    }
  }

  const anyBin = await db.stockBin.findFirst({
    where: { tenantId: input.tenantId, siteId: input.siteId, isActive: true },
    orderBy: { code: "asc" },
  });
  return { rule: null, bin: anyBin, reason: anyBin ? "Fallback first bin" : "No bins" };
}

export async function applyPutaway(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    binId?: string | null;
  },
) {
  let binId = input.binId;
  if (!binId) {
    const suggestion = await suggestPutaway(db, input);
    binId = suggestion.bin?.id ?? null;
  }
  if (!binId) throw new InventoryError("Δεν υπάρχει διαθέσιμο bin για putaway");

  const balance = await db.stockBalance.findUnique({
    where: {
      tenantId_siteId_productId: {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: input.productId,
      },
    },
  });
  if (!balance) throw new InventoryError("Δεν υπάρχει υπόλοιπο για putaway");

  return db.stockBalance.update({
    where: { id: balance.id },
    data: { binId },
    include: {
      bin: { select: { code: true, name: true, zone: true } },
      product: { select: { sku: true, name: true } },
    },
  });
}

// ─── Wave picking ──────────────────────────────────────────────────────────

export async function createPickWave(
  db: Db,
  input: {
    tenantId: string;
    siteId: string;
    note?: string | null;
    userId?: string | null;
    lines: Array<{
      productId: string;
      qty: number;
      refType?: string | null;
      refId?: string | null;
    }>;
    autoReserve?: boolean;
    useFefo?: boolean;
  },
) {
  if (!input.lines.length) throw new InventoryError("Απαιτούνται γραμμές wave");
  const number = await nextWaveNumber(db, input.tenantId);

  const lineCreates = [];
  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i]!;
    const qty = round3(Math.abs(line.qty));
    let lotCode: string | null = null;
    let fromBinId: string | null = null;
    let reservationId: string | null = null;

    if (input.useFefo !== false) {
      const fefo = await allocateLotsFefo(db, {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: line.productId,
        qty,
      });
      lotCode = fefo.picks[0]?.lotCode ?? null;
    }

    const bal = await db.stockBalance.findUnique({
      where: {
        tenantId_siteId_productId: {
          tenantId: input.tenantId,
          siteId: input.siteId,
          productId: line.productId,
        },
      },
      select: { binId: true },
    });
    fromBinId = bal?.binId ?? null;

    if (input.autoReserve !== false) {
      try {
        const res = await createReservation(db, {
          tenantId: input.tenantId,
          siteId: input.siteId,
          productId: line.productId,
          qty,
          note: `Wave ${number}`,
          userId: input.userId,
          refType: "pick_wave",
          refId: number,
        });
        reservationId = res.id;
      } catch {
        reservationId = null;
      }
    }

    lineCreates.push({
      tenantId: input.tenantId,
      productId: line.productId,
      qty,
      qtyPicked: 0,
      status: "OPEN" as const,
      lotCode,
      fromBinId,
      reservationId,
      refType: line.refType ?? null,
      refId: line.refId ?? null,
      lineNo: i + 1,
    });
  }

  return db.pickWave.create({
    data: {
      tenantId: input.tenantId,
      number,
      siteId: input.siteId,
      status: "DRAFT",
      note: input.note ?? null,
      createdByUserId: input.userId ?? null,
      lines: { create: lineCreates },
    },
    include: waveInclude,
  });
}

const waveInclude = {
  site: { select: { code: true, name: true } },
  lines: {
    orderBy: { lineNo: "asc" as const },
    include: {
      product: {
        select: { sku: true, name: true, barcode: true, unit: true },
      },
      fromBin: { select: { code: true, name: true } },
    },
  },
};

export async function listPickWaves(db: Db, tenantId: string) {
  return db.pickWave.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: waveInclude,
  });
}

export async function releasePickWave(
  db: Db,
  input: { tenantId: string; waveId: string },
) {
  const wave = await db.pickWave.findFirst({
    where: { id: input.waveId, tenantId: input.tenantId },
  });
  if (!wave) throw new InventoryError("Wave δεν βρέθηκε");
  if (wave.status !== "DRAFT") {
    throw new InventoryError("Μόνο DRAFT waves απελευθερώνονται");
  }
  return db.pickWave.update({
    where: { id: wave.id },
    data: { status: "RELEASED", releasedAt: new Date() },
    include: waveInclude,
  });
}

export async function pickWaveLine(
  db: Db,
  input: {
    tenantId: string;
    waveId: string;
    lineId: string;
    qty?: number;
    serial?: string | null;
    userId?: string | null;
  },
) {
  const wave = await db.pickWave.findFirst({
    where: { id: input.waveId, tenantId: input.tenantId },
    include: { lines: true },
  });
  if (!wave) throw new InventoryError("Wave δεν βρέθηκε");
  if (wave.status === "DONE" || wave.status === "CANCELLED") {
    throw new InventoryError("Το wave είναι κλειστό");
  }
  if (wave.status === "DRAFT") {
    await db.pickWave.update({
      where: { id: wave.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
  }

  const line = wave.lines.find((l) => l.id === input.lineId);
  if (!line) throw new InventoryError("Γραμμή wave δεν βρέθηκε");
  if (line.status === "PICKED" || line.status === "CANCELLED") {
    throw new InventoryError("Η γραμμή έχει ήδη ολοκληρωθεί");
  }

  const need = round3(Number(line.qty) - Number(line.qtyPicked));
  const pickQty = round3(Math.min(need, Math.abs(input.qty ?? need)));
  if (!(pickQty > 0)) throw new InventoryError("Μηδενική ποσότητα pick");

  await applyStockDelta(db, {
    tenantId: input.tenantId,
    siteId: wave.siteId,
    productId: line.productId,
    delta: -pickQty,
    type: "OUT",
    source: "DELIVERY",
    lotCode: line.lotCode,
    serial: input.serial,
    note: `Wave pick ${wave.number}`,
    refType: "pick_wave",
    refId: wave.id,
    userId: input.userId,
    allowNegative: false,
  });

  if (input.serial) {
    await db.stockSerial.updateMany({
      where: {
        tenantId: input.tenantId,
        productId: line.productId,
        serial: input.serial.trim(),
        status: { in: ["AVAILABLE", "RESERVED"] },
      },
      data: { status: "SHIPPED" },
    });
  }

  const qtyPicked = round3(Number(line.qtyPicked) + pickQty);
  const done = qtyPicked + 0.0005 >= Number(line.qty);
  await db.pickWaveLine.update({
    where: { id: line.id },
    data: {
      qtyPicked,
      status: done ? "PICKED" : "OPEN",
      serial: input.serial?.trim() || line.serial,
    },
  });

  await db.pickWave.update({
    where: { id: wave.id },
    data: { status: "PICKING" },
  });

  const refreshed = await db.pickWave.findUniqueOrThrow({
    where: { id: wave.id },
    include: waveInclude,
  });
  const allDone = refreshed.lines.every(
    (l) => l.status === "PICKED" || l.status === "CANCELLED",
  );
  if (allDone) {
    return db.pickWave.update({
      where: { id: wave.id },
      data: { status: "DONE", completedAt: new Date() },
      include: waveInclude,
    });
  }
  return refreshed;
}

/** Resolve product by barcode / sku / serial for scanner UX */
export async function resolveScanCode(
  db: Db,
  tenantId: string,
  code: string,
) {
  const q = code.trim();
  if (!q) throw new InventoryError("Κενό scan");

  const serial = await db.stockSerial.findFirst({
    where: {
      tenantId,
      serial: { equals: q, mode: "insensitive" },
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          barcode: true,
          unit: true,
          altUnitId: true,
          altToBaseFactor: true,
          trackSerials: true,
        },
      },
      site: { select: { id: true, code: true, name: true } },
      bin: { select: { code: true } },
    },
  });
  if (serial) {
    return { kind: "serial" as const, serial, product: serial.product };
  }

  const product = await db.product.findFirst({
    where: {
      tenantId,
      OR: [
        { barcode: { equals: q, mode: "insensitive" } },
        { sku: { equals: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      barcode: true,
      unit: true,
      altUnitId: true,
      altToBaseFactor: true,
      trackSerials: true,
      trackLots: true,
      averageCost: true,
    },
  });
  if (!product) throw new InventoryError(`Δεν βρέθηκε: ${q}`);
  return { kind: "product" as const, product, serial: null };
}

export async function loadInTransitValuation(db: Db, tenantId: string) {
  const transfers = await db.stockTransfer.findMany({
    where: { tenantId, status: "IN_TRANSIT" },
    include: {
      lines: {
        include: {
          product: {
            select: { sku: true, name: true, unit: true, averageCost: true },
          },
        },
      },
      fromSite: { select: { code: true, name: true } },
      toSite: { select: { code: true, name: true } },
    },
  });

  const items = [];
  let totalValue = 0;
  let totalQty = 0;
  for (const t of transfers) {
    for (const l of t.lines) {
      const qty = Number(l.qty);
      const cost = Number(l.product.averageCost ?? 0);
      const value = round2(qty * cost);
      totalValue = round2(totalValue + value);
      totalQty = round3(totalQty + qty);
      items.push({
        transferId: t.id,
        transferNumber: t.number,
        fromSite: t.fromSite.code,
        toSite: t.toSite.code,
        productId: l.productId,
        sku: l.product.sku,
        name: l.product.name,
        unit: l.product.unit,
        qty,
        averageCost: cost,
        inTransitValue: value,
        shippedAt: t.shippedAt,
      });
    }
  }
  return { items, totalValue, totalQty, transferCount: transfers.length };
}
