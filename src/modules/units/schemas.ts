import { z } from "zod";

export const unitOfMeasureKindSchema = z.enum([
  "COUNT",
  "WEIGHT",
  "VOLUME",
  "LENGTH",
  "AREA",
  "TIME",
  "OTHER",
]);

export const unitOfMeasureUpsertSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9_]+$/.test(v), "Μόνο A-Z, 0-9, _"),
  name: z.string().trim().min(1).max(80),
  symbol: z.string().trim().min(1).max(20),
  kind: unitOfMeasureKindSchema.default("COUNT"),
  decimals: z.number().int().min(0).max(6).optional().default(0),
  description: z.string().trim().max(300).optional().nullable(),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(100),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});

export type UnitOfMeasureUpsertInput = z.infer<typeof unitOfMeasureUpsertSchema>;
