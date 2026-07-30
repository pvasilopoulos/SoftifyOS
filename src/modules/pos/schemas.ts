import { z } from "zod";

export const tenderMethodSchema = z.enum([
  "CASH",
  "CARD",
  "TRANSFER",
  "GIFT_CARD",
  "LOYALTY",
  "OTHER",
]);

/** @deprecated prefer catalog codes — kept for invoice collect */

export const posLineSchema = z.object({
  productId: z.string().trim().min(1).optional().nullable(),
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPrice: z.coerce.number().nonnegative().max(10_000_000),
  vatRate: z.coerce.number().min(0).max(100).default(24),
});

export const posTenderSchema = z.object({
  method: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((v) => v.toUpperCase()),
  amount: z.coerce.number().positive().max(10_000_000),
  giftCardCode: z.string().trim().min(1).max(64).optional().nullable(),
  loyaltyPoints: z.coerce.number().int().positive().optional().nullable(),
  externalRef: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const posCheckoutSchema = z.object({
  siteId: z.string().trim().min(1),
  seriesId: z.string().trim().min(1).optional().nullable(),
  sessionId: z.string().trim().min(1).optional().nullable(),
  terminalId: z.string().trim().min(1).optional().nullable(),
  customerId: z.string().trim().min(1),
  discount: z.coerce.number().min(0).max(10_000_000).optional().default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(posLineSchema).min(1).max(100),
  tenders: z.array(posTenderSchema).min(1).max(20),
});

export const posSessionOpenSchema = z.object({
  siteId: z.string().trim().min(1),
  openingFloat: z.coerce.number().min(0).max(1_000_000).optional().default(0),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const posSessionCloseSchema = z.object({
  closingCash: z.coerce.number().min(0).max(1_000_000),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type PosCheckoutInput = z.infer<typeof posCheckoutSchema>;
