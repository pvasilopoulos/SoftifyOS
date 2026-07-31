import { z } from "zod";

export const entityModuleSchema = z.enum([
  "CUSTOMERS",
  "PRODUCTS",
  "INVOICES",
  "ORDERS",
  "QUOTES",
  "GIFT_CARDS",
]);

export const customFieldTypeSchema = z.enum([
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTI_SELECT",
]);

export const customFieldUpsertSchema = z.object({
  entity: entityModuleSchema,
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "Κωδικός: λατινικά μικρά, αριθμοί, _"),
  label: z.string().trim().min(1).max(120),
  type: customFieldTypeSchema.default("TEXT"),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  required: z.boolean().optional().default(false),
  filterable: z.boolean().optional().default(false),
  showInList: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const customFieldPatchSchema = customFieldUpsertSchema
  .omit({ entity: true, code: true })
  .partial();

const fieldRefSchema = z.object({
  key: z.string().min(1).max(60),
  source: z.enum(["system", "custom"]),
  required: z.boolean().optional(),
});

export const listViewConfigSchema = z.object({
  columns: z.array(fieldRefSchema).min(1).max(30),
  filters: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        source: z.enum(["system", "custom"]),
        op: z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte"]).default("eq"),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      }),
    )
    .max(20)
    .default([]),
  sort: z
    .object({
      key: z.string().min(1),
      source: z.enum(["system", "custom"]).default("system"),
      dir: z.enum(["asc", "desc"]).default("desc"),
    })
    .optional(),
  pageSize: z.coerce.number().int().min(10).max(100).optional().default(50),
});

export const formViewConfigSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        title: z.string().trim().min(1).max(120),
        fields: z.array(fieldRefSchema).max(40),
      }),
    )
    .min(1)
    .max(20),
});

export const listViewUpsertSchema = z.object({
  entity: entityModuleSchema,
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional().nullable(),
  configJson: listViewConfigSchema,
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0),
});

export const listViewPatchSchema = listViewUpsertSchema
  .omit({ entity: true, code: true })
  .partial();

export const formViewUpsertSchema = z.object({
  entity: entityModuleSchema,
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional().nullable(),
  configJson: formViewConfigSchema,
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0),
});

export const formViewPatchSchema = formViewUpsertSchema
  .omit({ entity: true, code: true })
  .partial();

export const customFieldsValueSchema = z
  .record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.string()),
    ]),
  )
  .optional()
  .default({});
