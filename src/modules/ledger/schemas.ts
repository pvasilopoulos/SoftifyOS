import { z } from "zod";

export const glAccountUpsertSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  parentId: z.string().min(1).nullable().optional(),
  reportGroup: z.string().trim().max(40).nullable().optional(),
  isPostable: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
});

export const glAccountPatchSchema = glAccountUpsertSchema.partial();

export const journalLineSchema = z.object({
  glAccountId: z.string().min(1),
  debit: z.coerce.number().min(0).max(100_000_000).optional().default(0),
  credit: z.coerce.number().min(0).max(100_000_000).optional().default(0),
  memo: z.string().trim().max(300).nullable().optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  legalEntityId: z.string().min(1).nullable().optional(),
});

export const journalCreateSchema = z.object({
  description: z.string().trim().max(300).nullable().optional(),
  entryDate: z.coerce.date().optional(),
  isOpening: z.boolean().optional().default(false),
  lines: z.array(journalLineSchema).min(2).max(100),
  post: z.boolean().optional().default(true),
});

export const periodActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["close", "reopen"]),
    periodId: z.string().min(1),
  }),
  z.object({
    action: z.literal("close-year"),
    year: z.coerce.number().int().min(2000).max(2100),
    createOpenings: z.boolean().optional().default(true),
  }),
]);

export const costAllocationSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  method: z.enum(["EQUAL", "PERCENT", "DRIVER"]).optional().default("PERCENT"),
  sourceCostCenterId: z.string().min(1),
  glAccountId: z.string().min(1),
  amount: z.coerce.number().positive().max(100_000_000),
  targets: z
    .array(
      z.object({
        costCenterId: z.string().min(1),
        weight: z.coerce.number().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(50),
});

export const intercompanyMatchSchema = z.object({
  code: z.string().trim().min(1).max(40),
  legalEntityAId: z.string().min(1),
  legalEntityBId: z.string().min(1),
  amount: z.coerce.number().positive().max(100_000_000),
  lineAId: z.string().min(1).nullable().optional(),
  lineBId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  eliminate: z.boolean().optional().default(false),
});

export const parallelLedgerSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  kind: z
    .enum(["STATUTORY", "IFRS", "MANAGEMENT", "TAX"])
    .optional()
    .default("MANAGEMENT"),
  isDefault: z.boolean().optional(),
});

export const legalEntitySchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  vatNumber: z.string().trim().max(32).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const costCenterSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  parentId: z.string().min(1).nullable().optional(),
});

export const fixedAssetCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  acquisitionDate: z.coerce.date(),
  acquisitionCost: z.coerce.number().positive().max(100_000_000),
  residualValue: z.coerce.number().min(0).max(100_000_000).optional(),
  usefulLifeMonths: z.coerce.number().int().min(1).max(600).optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  legalEntityId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  postAcquisition: z.boolean().optional().default(true),
});

export const purchaseInvoiceCreateSchema = z.object({
  number: z.string().trim().min(1).max(40),
  supplierId: z.string().min(1),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  legalEntityId: z.string().min(1).nullable().optional(),
  post: z.boolean().optional().default(true),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        qty: z.coerce.number().positive().max(1_000_000),
        unitPrice: z.coerce.number().min(0).max(100_000_000),
        vatRate: z.coerce.number().min(0).max(100).optional().default(24),
        glAccountId: z.string().min(1).nullable().optional(),
        costCenterId: z.string().min(1).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});
