import { z } from "zod";

export const reportPeriodSchema = z.enum(["mtd", "qtd", "ytd", "12m"]);

export const reportRunSchema = z.object({
  reportId: z.string().trim().min(1).max(80).optional(),
  /** Builder mode */
  metrics: z
    .array(z.enum(["revenue", "invoices", "orders", "cash", "stock", "vat"]))
    .min(1)
    .max(6)
    .optional(),
  groupBy: z.enum(["month", "customer", "product", "site"]).optional(),
  period: reportPeriodSchema.optional().default("ytd"),
  chartType: z
    .enum(["line", "area", "bar", "donut", "radialBar", "table"])
    .optional(),
  /** Builder presentation: chart-only, table grid, or both */
  viewMode: z.enum(["chart", "table", "both"]).optional().default("both"),
  includeTotals: z.boolean().optional().default(true),
  limit: z.coerce.number().int().min(3).max(500).optional().default(12),
});

export type ReportRunInput = z.infer<typeof reportRunSchema>;
