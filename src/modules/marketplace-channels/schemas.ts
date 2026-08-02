import { z } from "zod";
import {
  MARKETPLACE_PROVIDERS,
  MARKETPLACE_STATUSES,
} from "./labels";

const codeSchema = z
  .string()
  .min(2)
  .max(40)
  .transform((v) => v.trim().toUpperCase())
  .refine((v) => /^[A-Z0-9_]+$/.test(v), "Μόνο A-Z, 0-9, _");

export const marketplaceChannelCreateSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(120),
  provider: z.enum(MARKETPLACE_PROVIDERS),
  status: z.enum(MARKETPLACE_STATUSES).optional().default("DRAFT"),
  merchantId: z.string().trim().max(120).optional().nullable(),
  externalShopId: z.string().trim().max(120).optional().nullable(),
  credentialsSecretKey: z.string().trim().max(80).optional().nullable(),
  apiBaseHost: z.string().trim().max(200).optional().nullable(),
  apiBaseUrl: z.string().trim().max(400).optional().nullable(),
  syncCatalog: z.boolean().optional().default(true),
  syncOrders: z.boolean().optional().default(true),
  syncStock: z.boolean().optional().default(false),
  syncPrices: z.boolean().optional().default(false),
  autoImportOrders: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(9999).optional().default(100),
  notes: z.string().trim().max(2000).optional().nullable(),
  metaJson: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const marketplaceChannelPatchSchema = marketplaceChannelCreateSchema
  .partial()
  .omit({ code: true })
  .extend({
    code: codeSchema.optional(),
  });

export type MarketplaceChannelCreateInput = z.infer<
  typeof marketplaceChannelCreateSchema
>;
export type MarketplaceChannelPatchInput = z.infer<
  typeof marketplaceChannelPatchSchema
>;
