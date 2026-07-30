import { z } from "zod";
import { DOCUMENT_KINDS } from "@/modules/documents/schemas";

const blockSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum([
    "header",
    "parties",
    "meta",
    "lines",
    "totals",
    "notes",
    "footer",
    "text",
    "spacer",
  ]),
  label: z.string().max(120).optional(),
  text: z.string().max(2000).optional(),
  showPaidBalance: z.boolean().optional(),
});

export const printFormBodySchema = z.object({
  version: z.literal(1),
  blocks: z.array(blockSchema).min(1).max(40),
});

export const printFormUpsertSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  documentKind: z.enum(DOCUMENT_KINDS),
  paper: z.enum(["A4", "A5", "RECEIPT_80"]).optional().default("A4"),
  orientation: z.enum(["PORTRAIT", "LANDSCAPE"]).optional().default("PORTRAIT"),
  bodyJson: printFormBodySchema,
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

export const printFormPatchSchema = printFormUpsertSchema.partial();
