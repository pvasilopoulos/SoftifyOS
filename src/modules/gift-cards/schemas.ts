import { z } from "zod";

export const giftCardStatusSchema = z.enum([
  "ACTIVE",
  "DEPLETED",
  "VOID",
  "EXPIRED",
]);

const optionalAccount = z
  .string()
  .max(40)
  .optional()
  .nullable()
  .transform((v) => {
    if (v == null) return null;
    const t = v.trim();
    return t.length ? t : null;
  });

export const giftCardAccountingSchema = z.object({
  glLiabilityAccount: optionalAccount,
  glCashAccount: optionalAccount,
  glRedeemContraAccount: optionalAccount,
  costCenter: optionalAccount,
  accountingCode: optionalAccount,
});

export const issueGiftCardSchema = z
  .object({
    code: z
      .string()
      .min(3)
      .max(40)
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => /^[A-Z0-9_-]+$/.test(v), "Μόνο A-Z, 0-9, _, -"),
    initialBalance: z.number().positive().max(100_000),
    customerId: z.string().min(1).optional().nullable(),
    expiresAt: z.string().datetime().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  })
  .merge(giftCardAccountingSchema);

export const adjustGiftCardSchema = z.object({
  amount: z.number().refine((n) => n !== 0, "Το ποσό δεν μπορεί να είναι 0"),
  note: z.string().min(2).max(300),
});

export const voidGiftCardSchema = z.object({
  note: z.string().min(2).max(300).optional().nullable(),
});

export const patchGiftCardAccountingSchema = giftCardAccountingSchema.partial();

export type IssueGiftCardInput = z.infer<typeof issueGiftCardSchema>;
export type AdjustGiftCardInput = z.infer<typeof adjustGiftCardSchema>;
export type PatchGiftCardAccountingInput = z.infer<
  typeof patchGiftCardAccountingSchema
>;
