import { Prisma } from "@/generated/prisma/client";
import type { DocumentKind, PrismaClient } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export const documentKindLabel = {
  SALES_ORDER: "Παραγγελία πώλησης",
  SALES_INVOICE: "Τιμολόγιο πώλησης",
  SALES_CREDIT: "Πιστωτικό",
  CUSTOMER_RECEIPT: "Είσπραξη πελάτη",
  DELIVERY_NOTE: "Δελτίο αποστολής",
} as const;

export const customerEffectLabel = {
  NONE: "Καμία",
  DEBIT: "Χρέωση",
  CREDIT: "Πίστωση",
} as const;

export const inventoryEffectLabel = {
  NONE: "Καμία",
  OUT: "Έξοδος",
  IN: "Είσοδος",
} as const;

/** ΤΙΜ-{YYYY}- + 5 → ΤΙΜ-2026-00042 */
export function formatDocumentNumber(
  prefix: string,
  seq: number,
  padLength: number,
  year = new Date().getFullYear(),
) {
  const rendered = prefix.replaceAll("{YYYY}", String(year)).replaceAll("{YY}", String(year).slice(-2));
  return `${rendered}${String(seq).padStart(padLength, "0")}`;
}

export function previewNextNumber(series: {
  prefix: string;
  nextNumber: number;
  padLength: number;
  resetPolicy: "NEVER" | "YEARLY";
  lastYear: number | null;
}) {
  const year = new Date().getFullYear();
  const seq =
    series.resetPolicy === "YEARLY" && series.lastYear !== year
      ? 1
      : series.nextNumber;
  return formatDocumentNumber(series.prefix, seq, series.padLength, year);
}

/**
 * Atomically allocates the next document number from a series.
 * Uses SELECT FOR UPDATE via interactive transaction + increment.
 */
export async function allocateFromSeries(
  db: Tx,
  input: {
    tenantId: string;
    seriesId: string;
    kind: DocumentKind;
  },
) {
  const series = await db.documentSeries.findFirst({
    where: {
      id: input.seriesId,
      tenantId: input.tenantId,
      kind: input.kind,
      isActive: true,
    },
  });
  if (!series) {
    throw new Error("Η σειρά δεν βρέθηκε ή είναι ανενεργή");
  }

  const year = new Date().getFullYear();
  const reset =
    series.resetPolicy === "YEARLY" && series.lastYear !== year;
  const seq = reset ? 1 : series.nextNumber;
  const number = formatDocumentNumber(series.prefix, seq, series.padLength, year);

  await db.documentSeries.update({
    where: { id: series.id },
    data: {
      nextNumber: seq + 1,
      lastYear: year,
    },
  });

  return {
    number,
    seriesId: series.id,
    siteId: series.siteId,
    series,
  };
}

export async function resolveDefaultSeries(
  db: Tx,
  tenantId: string,
  kind: DocumentKind,
  siteId?: string | null,
) {
  if (siteId) {
    const siteSeries = await db.documentSeries.findFirst({
      where: { tenantId, kind, siteId, isActive: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    });
    if (siteSeries) return siteSeries;
  }
  return db.documentSeries.findFirst({
    where: { tenantId, kind, isActive: true },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
  });
}
