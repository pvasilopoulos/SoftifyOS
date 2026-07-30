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

export const invoiceKindSchema = z.enum([
  "SALES_INVOICE",
  "SALES_CREDIT",
  "RETAIL_RECEIPT",
]);

export const invoiceCreateSchema = z.object({
  customerId: z.string().trim().min(1),
  branchId: z.string().trim().min(1).optional().nullable(),
  spaceId: z.string().trim().min(1).optional().nullable(),
  seriesId: z.string().trim().min(1).optional().nullable(),
  relatedInvoiceId: z.string().trim().min(1).optional().nullable(),
  kind: invoiceKindSchema.optional().default("SALES_INVOICE"),
  number: z.string().trim().min(1).max(40).optional().nullable(),
  status: z.enum(["DRAFT", "ISSUED"]).optional().default("DRAFT"),
  dueAt: dueAtSchema,
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(invoiceLineCreateSchema).min(1).max(100),
});

export const creditFromInvoiceSchema = z.object({
  seriesId: z.string().trim().min(1).optional().nullable(),
  status: z.enum(["DRAFT", "ISSUED"]).optional().default("DRAFT"),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** If omitted, copy all source lines */
  lines: z
    .array(
      z.object({
        sourceLineId: z.string().trim().min(1),
        quantity: z.coerce.number().positive().max(1_000_000).optional(),
      }),
    )
    .min(1)
    .max(100)
    .optional(),
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
  /** Catalog code preferred; legacy enum still accepted */
  method: z.string().trim().min(1).max(40).optional(),
  paymentMethodId: z.string().trim().min(1).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceCollectInput = z.infer<typeof invoiceCollectSchema>;
