import { z } from "zod";

export const orderKindSchema = z.enum(["SALES_ORDER", "SALES_QUOTE"]);

export const orderLineCreateSchema = z.object({
  productId: z.string().trim().min(1).optional().nullable(),
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPrice: z.coerce.number().nonnegative().max(10_000_000),
  vatRate: z.coerce.number().min(0).max(100).default(24),
});

export const orderCreateSchema = z.object({
  customerId: z.string().trim().min(1),
  branchId: z.string().trim().min(1).optional().nullable(),
  spaceId: z.string().trim().min(1).optional().nullable(),
  seriesId: z.string().trim().min(1).optional().nullable(),
  kind: orderKindSchema.optional().default("SALES_ORDER"),
  number: z.string().trim().min(1).max(40).optional().nullable(),
  status: z.enum(["DRAFT", "CONFIRMED"]).optional().default("DRAFT"),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(orderLineCreateSchema).min(1).max(100),
});

export const orderInvoiceSchema = z.object({
  seriesId: z.string().trim().min(1).optional().nullable(),
  lines: z
    .array(
      z.object({
        orderLineId: z.string().trim().min(1),
        quantity: z.coerce.number().positive().max(1_000_000),
      }),
    )
    .optional(),
});

export const quoteConvertSchema = z.object({
  seriesId: z.string().trim().min(1).optional().nullable(),
  status: z.enum(["DRAFT", "CONFIRMED"]).optional().default("CONFIRMED"),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
