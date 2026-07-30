import { z } from "zod";

export const paymentMethodKindSchema = z.enum([
  "CASH",
  "CARD",
  "TRANSFER",
  "GIFT_CARD",
  "LOYALTY",
  "OTHER",
]);

export const paymentMethodUpsertSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .transform((v) => v.trim().toUpperCase())
    .refine((v) => /^[A-Z0-9_]+$/.test(v), "Μόνο A-Z, 0-9, _"),
  name: z.string().min(2).max(80),
  kind: paymentMethodKindSchema,
  description: z.string().max(300).optional().nullable(),
  glAccount: z.string().max(40).optional().nullable(),
  glContraAccount: z.string().max(40).optional().nullable(),
  glClearingAccount: z.string().max(40).optional().nullable(),
  costCenter: z.string().max(40).optional().nullable(),
  accountingCode: z.string().max(40).optional().nullable(),
  bankIban: z.string().max(40).optional().nullable(),
  bankName: z.string().max(80).optional().nullable(),
  myDataPaymentType: z.string().max(20).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional().default(100),
  isActive: z.boolean().optional().default(true),
  showInPos: z.boolean().optional().default(true),
  showInCollect: z.boolean().optional().default(true),
  requiresExternalRef: z.boolean().optional().default(false),
  allowsChange: z.boolean().optional().default(false),
  affectsCashDrawer: z.boolean().optional().default(false),
});

export const paymentMethodPatchSchema = paymentMethodUpsertSchema
  .partial()
  .omit({ code: true })
  .extend({
    code: z
      .string()
      .min(2)
      .max(40)
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => /^[A-Z0-9_]+$/.test(v), "Μόνο A-Z, 0-9, _")
      .optional(),
  });

export type PaymentMethodUpsertInput = z.infer<typeof paymentMethodUpsertSchema>;
