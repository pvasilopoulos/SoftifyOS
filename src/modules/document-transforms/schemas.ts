import { z } from "zod";

export const DOCUMENT_KINDS = [
  "SALES_QUOTE",
  "SALES_ORDER",
  "SALES_INVOICE",
  "RETAIL_RECEIPT",
  "SALES_CREDIT",
  "DELIVERY_NOTE",
  "CUSTOMER_RECEIPT",
  "PURCHASE_ORDER",
  "GOODS_RECEIPT",
  "PURCHASE_INVOICE",
  "PURCHASE_CREDIT",
  "SUPPLIER_PAYMENT",
  "STOCK_TRANSFER",
  "STOCK_RECEIPT",
  "STOCK_ISSUE",
  "CANCELLATION",
] as const;

export const HANDLER_KEYS = [
  "quote_to_order",
  "order_to_invoice",
  "order_to_delivery",
  "invoice_to_credit",
  "invoice_to_delivery",
  "delivery_to_invoice",
] as const;

export type HandlerKey = (typeof HANDLER_KEYS)[number];

export const transformRuleCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sourceKind: z.enum(DOCUMENT_KINDS),
  targetKind: z.enum(DOCUMENT_KINDS),
  handlerKey: z.enum(HANDLER_KEYS),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  allowPartial: z.boolean().optional(),
  coverageMode: z.enum(["FULL_COPY", "QUANTITY"]).optional(),
  issueMode: z.enum(["DRAFT", "ISSUE_NOW"]).optional(),
  copyNotes: z.boolean().optional(),
  defaultSeriesId: z.string().min(1).optional().nullable(),
});

export const transformRuleUpdateSchema = transformRuleCreateSchema
  .partial()
  .extend({
    code: z.string().trim().min(1).max(40).optional(),
  });

export const transformLineSelectionSchema = z.object({
  sourceLineId: z.string().min(1),
  quantity: z.number().positive().max(1_000_000),
});

export const transformPreviewSchema = z.object({
  ruleId: z.string().min(1),
  sourceId: z.string().min(1),
  lines: z.array(transformLineSelectionSchema).optional(),
});

export const transformExecuteSchema = z.object({
  ruleId: z.string().min(1),
  sourceId: z.string().min(1),
  seriesId: z.string().min(1).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(transformLineSelectionSchema).optional(),
  /// Override issue mode for this run
  issueMode: z.enum(["DRAFT", "ISSUE_NOW"]).optional(),
});
