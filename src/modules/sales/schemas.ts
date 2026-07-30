import { z } from "zod";

export const invoiceLineCreateSchema = z.object({
  productId: z.string().trim().min(1).optional().nullable(),
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPrice: z.coerce.number().nonnegative().max(10_000_000),
  vatRate: z.coerce.number().min(0).max(100).default(24),
});

const dueAtSchema = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.string().datetime({ offset: true }),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .nullable();

export const invoiceCreateSchema = z.object({
  customerId: z.string().trim().min(1),
  branchId: z.string().trim().min(1).optional().nullable(),
  spaceId: z.string().trim().min(1).optional().nullable(),
  seriesId: z.string().trim().min(1).optional().nullable(),
  number: z.string().trim().min(1).max(40).optional().nullable(),
  status: z.enum(["DRAFT", "ISSUED"]).optional().default("DRAFT"),
  dueAt: dueAtSchema,
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(invoiceLineCreateSchema).min(1).max(100),
});

export const invoiceUpdateSchema = z.object({
  branchId: z.string().trim().min(1).optional().nullable(),
  spaceId: z.string().trim().min(1).optional().nullable(),
  dueAt: dueAtSchema,
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(invoiceLineCreateSchema).min(1).max(100).optional(),
});

export const invoiceCollectSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000),
  method: z
    .enum(["CASH", "TRANSFER", "CARD", "OTHER"])
    .optional()
    .default("OTHER"),
  note: z.string().trim().max(500).optional().nullable(),
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceCollectInput = z.infer<typeof invoiceCollectSchema>;
