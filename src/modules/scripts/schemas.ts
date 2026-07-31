import { z } from "zod";
import { entityModuleSchema } from "@/modules/entity-views/schemas";

export const scriptRuntimeSchema = z.enum(["SERVER", "UI", "BOTH"]);
export const scriptLifecycleSchema = z.enum(["DRAFT", "PUBLISHED"]);

export const scriptUpsertSchema = z.object({
  module: entityModuleSchema,
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  eventKey: z.string().trim().min(1).max(80),
  runtime: scriptRuntimeSchema.default("SERVER"),
  source: z.string().min(1).max(100_000),
  lifecycle: scriptLifecycleSchema.optional().default("DRAFT"),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0),
  timeoutMs: z.coerce.number().int().min(100).max(10_000).optional().default(3000),
});

export const scriptPatchSchema = scriptUpsertSchema
  .omit({ code: true })
  .partial();

export const scriptSecretUpsertSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  value: z.string().min(1).max(4000),
});

export const scriptAllowlistUpsertSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9.-]+$/i, "Μη έγκυρο hostname"),
});

export const scriptTestSchema = z.object({
  module: entityModuleSchema,
  eventKey: z.string().min(1),
  source: z.string().min(1).max(100_000),
  timeoutMs: z.coerce.number().int().min(100).max(10_000).optional().default(3000),
  context: z.record(z.string(), z.unknown()).optional().default({}),
});

export const scriptSettingsPatchSchema = z.object({
  scriptsEnabled: z.boolean().optional(),
  maxTimeoutMs: z.coerce.number().int().min(500).max(10_000).optional(),
  maxHttpCalls: z.coerce.number().int().min(0).max(20).optional(),
});
