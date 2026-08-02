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

export async function allocateDeliveryNoteNumber(
  db: Db,
  tenantId: string,
  siteId?: string | null,
  legalEntityId?: string | null,
) {
  const series = await resolveDefaultSeries(
    db,
    tenantId,
    "DELIVERY_NOTE",
    siteId,
    legalEntityId,
  );
  if (series) {
    return allocateFromSeries(db, {
      tenantId,
      seriesId: series.id,
      kind: "DELIVERY_NOTE",
      legalEntityId,
    });
  }
  const year = new Date().getFullYear();
  const count = await db.deliveryNote.count({
    where: {
      tenantId,
      ...(legalEntityId ? { legalEntityId } : {}),
    },
  });
  return {
    number: `ΔΑ-${year}-${String(count + 1).padStart(5, "0")}`,
    seriesId: null as string | null,
    siteId: siteId ?? null,
  };
}

export async function issueDeliveryNote(
  db: Db,
  input: {
    tenantId: string;
    deliveryNoteId: string;
    userId?: string | null;
    allowNegative?: boolean;
  },
) {
  const note = await db.deliveryNote.findFirst({
    where: { id: input.deliveryNoteId, tenantId: input.tenantId },
    include: {
      lines: { orderBy: { position: "asc" } },
      series: { select: { affectsInventory: true, siteId: true } },
    },
  });
  if (!note) throw new Error("Το δελτίο δεν βρέθηκε");
  if (note.status !== "DRAFT") {
    throw new Error("Μόνο πρόχειρα δελτία εκδίδονται");
  }
  if (note.lines.length === 0) {
    throw new Error("Το δελτίο δεν έχει γραμμές");
  }

  const effect = note.series?.affectsInventory ?? "OUT";
  const siteId = await resolveStockSiteId(
    db,
    input.tenantId,
    note.siteId ?? note.series?.siteId,
  );

  const movements: string[] = [];
  if (effect === "OUT" || effect === "IN") {
    for (const line of note.lines) {
      if (!line.productId) continue;
      const qty = Math.abs(Number(line.quantity));
      if (!qty) continue;
      const result = await applyStockDelta(db, {
        tenantId: input.tenantId,
        siteId,
        productId: line.productId,
        type: effect === "OUT" ? "OUT" : "IN",
        source: "DELIVERY",
        delta: effect === "OUT" ? -qty : qty,
        note: `Δελτίο αποστολής ${note.number}`,
        refType: "delivery_note",
        refId: note.id,
        userId: input.userId,
        allowNegative: input.allowNegative ?? true,
      });
      if (!result.skipped && result.movementId) {
        movements.push(result.movementId);
      }
    }
  }

  const updated = await db.deliveryNote.update({
    where: { id: note.id },
    data: {
      status: "ISSUED",
      issuedAt: note.issuedAt ?? new Date(),
      siteId: note.siteId ?? siteId,
    },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      site: { select: { id: true, code: true, name: true } },
      lines: {
        orderBy: { position: "asc" },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
    },
  });

  return { note: updated, movements, siteId, effect };
}
