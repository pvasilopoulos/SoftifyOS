import { z } from "zod";

export const siteCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["BRANCH", "TILL"]).default("BRANCH"),
  parentId: z.string().trim().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const seriesCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  kind: z.enum([
    "SALES_ORDER",
    "SALES_INVOICE",
    "SALES_CREDIT",
    "CUSTOMER_RECEIPT",
    "DELIVERY_NOTE",
  ]),
  prefix: z.string().trim().min(1).max(40),
  padLength: z.coerce.number().int().min(3).max(10).optional().default(5),
  nextNumber: z.coerce.number().int().min(1).optional().default(1),
  resetPolicy: z.enum(["NEVER", "YEARLY"]).optional().default("YEARLY"),
  siteId: z.string().trim().min(1).optional().nullable(),
  affectsCustomer: z.enum(["NONE", "DEBIT", "CREDIT"]).optional().default("NONE"),
  affectsInventory: z.enum(["NONE", "OUT", "IN"]).optional().default("NONE"),
  allowPartial: z.boolean().optional().default(false),
  editableAfterIssue: z.boolean().optional().default(false),
  myDataEnabled: z.boolean().optional().default(false),
  myDataInvoiceType: z.string().trim().max(20).optional().nullable(),
  myDataVatCategory: z.string().trim().max(20).optional().nullable(),
  glDebitAccount: z.string().trim().max(40).optional().nullable(),
  glCreditAccount: z.string().trim().max(40).optional().nullable(),
  glVatAccount: z.string().trim().max(40).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

export const seriesUpdateSchema = seriesCreateSchema.partial();

export const MYDATA_INVOICE_TYPES = [
  { code: "1.1", label: "Τιμολόγιο Πώλησης" },
  { code: "1.2", label: "Τιμολόγιο Παροχής Υπηρεσιών" },
  { code: "1.3", label: "Τίτλος Κτήσης" },
  { code: "2.1", label: "Τιμολόγιο Ενδοκοινοτικό" },
  { code: "5.1", label: "Πιστωτικό Τιμολόγιο" },
  { code: "5.2", label: "Πιστωτικό Στοιχείο Λιανικής" },
  { code: "8.1", label: "Αποδείξη Είσπραξης" },
  { code: "9.3", label: "Δελτίο Αποστολής" },
] as const;
