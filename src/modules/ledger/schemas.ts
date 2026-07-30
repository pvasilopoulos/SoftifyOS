import { z } from "zod";

export const glAccountUpsertSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  parentId: z.string().min(1).nullable().optional(),
  isPostable: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
});

export const glAccountPatchSchema = glAccountUpsertSchema.partial();

export const journalLineSchema = z.object({
  glAccountId: z.string().min(1),
  debit: z.coerce.number().min(0).max(100_000_000).optional().default(0),
  credit: z.coerce.number().min(0).max(100_000_000).optional().default(0),
  memo: z.string().trim().max(300).nullable().optional(),
});

export const journalCreateSchema = z.object({
  description: z.string().trim().max(300).nullable().optional(),
  lines: z.array(journalLineSchema).min(2).max(100),
  post: z.boolean().optional().default(true),
});
