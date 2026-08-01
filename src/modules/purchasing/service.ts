import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  allocateFromSeries,
  resolveDefaultSeries,
} from "@/modules/documents/series";
import {
  applyStockDelta,
  resolveStockSiteId,
} from "@/modules/inventory/service";

type Db = PrismaClient | Prisma.TransactionClient;

export function calcPoLineTotal(
  quantity: number,
  unitPrice: number,
  vatRate: number,
) {
  const net = quantity * unitPrice;
  const vat = (net * vatRate) / 100;
  return {
    lineTotal: Math.round((net + vat) * 100) / 100,
    net: Math.round(net * 100) / 100,
    vat: Math.round(vat * 100) / 100,
  };
}

export function sumPoTotals(
  lines: Array<{ quantity: number; unitPrice: number; vatRate: number }>,
) {
  let subtotal = 0;
  let vatAmount = 0;
  for (const l of lines) {
    const { net, vat } = calcPoLineTotal(l.quantity, l.unitPrice, l.vatRate);
    subtotal += net;
    vatAmount += vat;
  }
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    vatAmount: Math.round(vatAmount * 100) / 100,
    total: Math.round((subtotal + vatAmount) * 100) / 100,
  };
}

export async function allocatePurchaseOrderNumber(
  db: Db,
  tenantId: string,
  siteId?: string | null,
) {
  const series = await resolveDefaultSeries(
    db,
    tenantId,
    "PURCHASE_ORDER",
    siteId,
  );
  if (series) {
    return allocateFromSeries(db, {
      tenantId,
      seriesId: series.id,
      kind: "PURCHASE_ORDER",
    });
  }
  // Fallback without series
  const year = new Date().getFullYear();
  const count = await db.purchaseOrder.count({ where: { tenantId } });
  const number = `PO-${year}-${String(count + 1).padStart(5, "0")}`;
  return { number, seriesId: null as string | null, siteId: siteId ?? null };
}

export function derivePoStatus(
  lines: Array<{ quantity: number; quantityReceived: number }>,
  current: string,
): "DRAFT" | "ORDERED" | "PARTIAL" | "RECEIVED" | "CANCELLED" {
  if (current === "CANCELLED" || current === "DRAFT") return current as "DRAFT" | "CANCELLED";
  const ordered = lines.reduce((s, l) => s + l.quantity, 0);
  const received = lines.reduce((s, l) => s + l.quantityReceived, 0);
  if (received <= 0) return "ORDERED";
  if (received + 0.0005 >= ordered) return "RECEIVED";
  return "PARTIAL";
}

export async function receivePurchaseOrderLines(
  db: Db,
  input: {
    tenantId: string;
    purchaseOrderId: string;
    userId?: string | null;
    items: Array<{ lineId: string; qty: number }>;
    note?: string | null;
  },
) {
  const po = await db.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, tenantId: input.tenantId },
    include: { lines: true },
  });
  if (!po) throw new Error("Η παραγγελία δεν βρέθηκε");
  if (po.status === "CANCELLED") {
    throw new Error("Ακυρωμένη παραγγελία");
  }
  if (po.status === "DRAFT") {
    throw new Error("Επιβεβαίωσε πρώτα την παραγγελία (ORDERED)");
  }

  const siteId = await resolveStockSiteId(db, input.tenantId, po.siteId);
  const movements: string[] = [];

  for (const item of input.items) {
    const qty = Math.abs(Number(item.qty));
    if (!qty) continue;
    const line = po.lines.find((l) => l.id === item.lineId);
    if (!line) throw new Error("Γραμμή δεν βρέθηκε");
    const remaining =
      Number(line.quantity) - Number(line.quantityReceived);
    if (qty > remaining + 0.0005) {
      throw new Error(
        `Υπερβολική παραλαβή στη γραμμή «${line.description}» (υπόλοιπο ${remaining})`,
      );
    }

    await db.purchaseOrderLine.update({
      where: { id: line.id },
      data: {
        quantityReceived: new Prisma.Decimal(
          Number(line.quantityReceived) + qty,
        ),
      },
    });

    if (line.productId) {
      const result = await applyStockDelta(db, {
        tenantId: input.tenantId,
        siteId,
        productId: line.productId,
        type: "IN",
        source: "RECEIPT",
        delta: qty,
        note: input.note || `Παραλαβή ${po.number}`,
        refType: "purchase_order",
        refId: po.id,
        userId: input.userId,
      });
      if (!result.skipped && result.movementId) {
        movements.push(result.movementId);
      }

      // Weighted average cost from PO unit price
      const product = await db.product.findFirst({
        where: { id: line.productId, tenantId: input.tenantId },
        select: { id: true, averageCost: true },
      });
      if (product) {
        const balances = await db.stockBalance.findMany({
          where: { tenantId: input.tenantId, productId: line.productId },
          select: { qtyOnHand: true },
        });
        const onHandAfter = balances.reduce(
          (s, b) => s + Number(b.qtyOnHand),
          0,
        );
        const onHandBefore = Math.max(0, onHandAfter - qty);
        const prevCost = Number(product.averageCost ?? 0);
        const unitPrice = Number(line.unitPrice);
        const newAvg =
          onHandAfter <= 0
            ? unitPrice
            : (onHandBefore * prevCost + qty * unitPrice) / onHandAfter;
        await db.product.update({
          where: { id: product.id },
          data: {
            averageCost: new Prisma.Decimal(
              Math.round(Math.max(0, newAvg) * 10_000) / 10_000,
            ),
          },
        });
      }
    }
  }

  const refreshed = await db.purchaseOrder.findFirst({
    where: { id: po.id },
    include: { lines: true },
  });
  if (!refreshed) throw new Error("PO missing after receive");

  const status = derivePoStatus(
    refreshed.lines.map((l) => ({
      quantity: Number(l.quantity),
      quantityReceived: Number(l.quantityReceived),
    })),
    refreshed.status === "DRAFT" ? "ORDERED" : refreshed.status,
  );

  const updated = await db.purchaseOrder.update({
    where: { id: po.id },
    data: { status },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      site: { select: { id: true, code: true, name: true } },
      lines: {
        orderBy: { position: "asc" },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
    },
  });

  return { order: updated, movements, siteId };
}
