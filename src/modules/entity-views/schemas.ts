import { z } from "zod";
import { normalizeFormConfig } from "./form-experience-types";
import { normalizeListConfig } from "./list-experience-types";

export const entityModuleSchema = z.enum([
  "CUSTOMERS",
  "PRODUCTS",
  "INVOICES",
  "ORDERS",
  "QUOTES",
  "GIFT_CARDS",
  "SUPPLIERS",
  "PURCHASE_ORDERS",
  "DELIVERY_NOTES",
  "CRM_LEADS",
  "EMPLOYEES",
  "LOYALTY",
  "SITES",
  "JOURNAL_ENTRIES",
  "MARKETPLACE_CHANNELS",
  "PAYMENT_METHODS",
  "DOCUMENT_SERIES",
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
  label: z.string().trim().max(120).optional(),
});

export const listViewConfigSchema = z.preprocess(
  (val) => normalizeListConfig(val),
  z.object({
    schemaVersion: z.literal(2),
    mode: z
      .enum(["browse", "select", "compact", "peek", "cards", "kanban", "map"])
      .optional()
      .default("browse"),
    lifecycle: z.enum(["draft", "published"]).optional().default("published"),
    page: z
      .object({
        density: z.enum(["compact", "comfortable", "detailed"]).optional(),
        peekFormCode: z.string().nullable().optional(),
        editFormCode: z.string().nullable().optional(),
        rowClick: z.enum(["navigate", "peek", "none"]).optional(),
        emptyTitle: z.string().optional(),
        emptyDescription: z.string().optional(),
        emptyCta: z.enum(["form_quick", "navigate_new", "none"]).optional(),
        showSearch: z.boolean().optional(),
        groupByKey: z.string().optional(),
        groupBySource: z.enum(["system", "custom"]).optional(),
      })
      .optional(),
    columns: z.array(z.record(z.string(), z.unknown())).min(1).max(30),
    filters: z.array(z.record(z.string(), z.unknown())).max(20).default([]),
    sort: z.record(z.string(), z.unknown()).optional(),
    sorts: z.array(z.record(z.string(), z.unknown())).max(5).optional(),
    pageSize: z.coerce.number().int().min(10).max(100).optional().default(50),
    rowActions: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
    bulkActions: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
    rules: z.array(z.record(z.string(), z.unknown())).max(80).optional(),
  }),
);

/** Accepts v1 sections or v2 page blocks; normalizes to Form Experience v2 */
export const formViewConfigSchema = z.preprocess(
  (val) => normalizeFormConfig(val),
  z.object({
    schemaVersion: z.literal(2),
    mode: z
      .enum(["create", "edit", "view", "quick", "wizard"])
      .optional()
      .default("edit"),
    lifecycle: z.enum(["draft", "published"]).optional().default("published"),
    page: z.object({
      title: z.string().trim().max(120).optional(),
      showHeader: z.boolean().optional(),
      showSide: z.boolean().optional(),
      sideContent: z.enum(["summary", "none"]).optional(),
      root: z.array(z.record(z.string(), z.unknown())).max(60),
    }),
    rules: z.array(z.record(z.string(), z.unknown())).max(80).optional().default([]),
  }),
);

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
