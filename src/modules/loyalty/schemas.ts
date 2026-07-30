import { z } from "zod";

export const loyaltyTierSchema = z.enum(["STANDARD", "SILVER", "GOLD", "PLATINUM"]);

export const upsertLoyaltyProgramSchema = z.object({
  name: z.string().min(2).max(80),
  earnPointsPerEur: z.number().int().min(0).max(1000),
  redeemPointsPerEur: z.number().int().min(1).max(100_000),
  isActive: z.boolean().optional(),
});

export const openLoyaltyAccountSchema = z.object({
  customerId: z.string().min(1),
  tier: loyaltyTierSchema.optional().default("STANDARD"),
  openingPoints: z.number().int().min(0).max(1_000_000).optional().default(0),
  note: z.string().max(300).optional().nullable(),
});

export const adjustLoyaltySchema = z.object({
  points: z
    .number()
    .int()
    .refine((n) => n !== 0, "Οι πόντοι δεν μπορούν να είναι 0"),
  note: z.string().min(2).max(300),
});

export const patchLoyaltyAccountSchema = z.object({
  tier: loyaltyTierSchema.optional(),
  isActive: z.boolean().optional(),
});

export type UpsertLoyaltyProgramInput = z.infer<typeof upsertLoyaltyProgramSchema>;
export type OpenLoyaltyAccountInput = z.infer<typeof openLoyaltyAccountSchema>;
export type AdjustLoyaltyInput = z.infer<typeof adjustLoyaltySchema>;
