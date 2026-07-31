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

const pageSchema = z.object({
  widthMm: z.number().min(40).max(2000),
  heightMm: z.number().min(40).max(2000),
  marginTopMm: z.number().min(0).max(80),
  marginRightMm: z.number().min(0).max(80),
  marginBottomMm: z.number().min(0).max(80),
  marginLeftMm: z.number().min(0).max(80),
});

const bodyV1Schema = z.object({
  version: z.literal(1),
  blocks: z.array(blockSchema).min(1).max(40),
});

const bodyV2Schema = z.object({
  version: z.literal(2),
  engine: z.enum(["html", "blocks"]),
  html: z.string().max(200_000),
  css: z.string().max(80_000),
  page: pageSchema.optional(),
  blocks: z.array(blockSchema).max(40).optional(),
});

export const printFormBodySchema = z.union([bodyV1Schema, bodyV2Schema]);

export const PRINT_PAPER_SIZES = [
  "A4",
  "A5",
  "A3",
  "LETTER",
  "RECEIPT_80",
  "CUSTOM",
] as const;

export const printFormUpsertSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  documentKind: z.enum(DOCUMENT_KINDS),
  paper: z.enum(PRINT_PAPER_SIZES).optional().default("A4"),
  orientation: z.enum(["PORTRAIT", "LANDSCAPE"]).optional().default("PORTRAIT"),
  bodyJson: printFormBodySchema,
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

export const printFormPatchSchema = printFormUpsertSchema.partial();
