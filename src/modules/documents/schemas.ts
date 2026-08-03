import { z } from "zod";
import { SETTLEMENT_POLICY_VALUES } from "@/modules/settlements/policy";

const settlementPolicyField = z
  .union([z.enum(SETTLEMENT_POLICY_VALUES), z.boolean()])
  .transform((v): (typeof SETTLEMENT_POLICY_VALUES)[number] => {
    if (v === true) return "YES";
    if (v === false) return "NO";
    return v;
  });

const settlementJournalPolicyField = z
  .union([z.enum(SETTLEMENT_POLICY_VALUES), z.boolean()])
  .transform((v): (typeof SETTLEMENT_POLICY_VALUES)[number] => {
    if (v === true) return "AUTO";
    if (v === false) return "NO";
    return v;
  });

const cardClearingPolicyField = z
  .union([
    z.enum(SETTLEMENT_POLICY_VALUES),
    z.enum(["IMMEDIATE", "CLEARING"]),
  ])
  .transform((v): (typeof SETTLEMENT_POLICY_VALUES)[number] => {
    if (v === "IMMEDIATE") return "NO";
    if (v === "CLEARING") return "AUTO";
    return v;
  });

export const DOCUMENT_KINDS = [
  "SALES_ORDER",
  "SALES_INVOICE",
  "SALES_CREDIT",
  "CUSTOMER_RECEIPT",
  "DELIVERY_NOTE",
  "SALES_QUOTE",
  "RETAIL_RECEIPT",
  "PURCHASE_ORDER",
  "PURCHASE_INVOICE",
  "PURCHASE_CREDIT",
  "SUPPLIER_PAYMENT",
  "GOODS_RECEIPT",
  "STOCK_TRANSFER",
  "STOCK_RECEIPT",
  "STOCK_ISSUE",
  "CANCELLATION",
] as const;

export type DocumentKindCode = (typeof DOCUMENT_KINDS)[number];

export const documentKindSchema = z.enum(DOCUMENT_KINDS);

export const siteCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["BRANCH", "WAREHOUSE", "TILL"]).default("BRANCH"),
  parentId: z.string().trim().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const siteUpdateSchema = siteCreateSchema.partial();

export const seriesCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  kind: documentKindSchema,
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
  /** Empty / omitted = all catalog methods allowed for this series */
  allowedPaymentMethodIds: z.array(z.string().min(1)).max(50).optional(),
  defaultPaymentMethodId: z.string().min(1).nullable().optional(),
  /** Empty / omitted = default form for document kind */
  allowedPrintFormIds: z.array(z.string().min(1)).max(50).optional(),
  defaultPrintFormId: z.string().min(1).nullable().optional(),
  /** Print copies (1-9) */
  printCopies: z.coerce.number().int().min(1).max(9).optional().default(1),
  /** Printer destination code; null means Browser */
  printPrinter: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .optional()
    .transform((v) => (v && v !== "BROWSER" ? v : null)),
  /** Settlement Engine — τετραδική πολιτική (NONE/NO/YES/AUTO) */
  allowPartialSettlement: settlementPolicyField.optional().default("YES"),
  allowOverpayment: settlementPolicyField.optional().default("NO"),
  allowMultiTender: z.boolean().optional().default(true),
  maxTenderLines: z.coerce.number().int().min(1).max(20).optional().default(10),
  allowMultiDocumentSettlement: z.boolean().optional().default(false),
  allowCreditNoteOffset: z.boolean().optional().default(true),
  allowOnAccount: settlementPolicyField.optional().default("NO"),
  allowWriteOff: settlementPolicyField.optional().default("NO"),
  writeOffMaxAmount: z.coerce
    .number()
    .min(0)
    .max(10_000)
    .optional()
    .default(0),
  settlementTolerance: z.coerce
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.01),
  allowCashChange: z.boolean().optional().default(true),
  allowGiftCardTender: z.boolean().optional().default(true),
  allowLoyaltyTender: z.boolean().optional().default(true),
  requireExternalRef: z.boolean().optional().default(false),
  cardClearingPolicy: cardClearingPolicyField.optional().default("NO"),
  /** @deprecated accept old payload key */
  settlementClearingMode: cardClearingPolicyField.optional(),
  settlementValueDateMode: z
    .enum(["PAYMENT_DATE", "DOCUMENT_DATE"])
    .optional()
    .default("PAYMENT_DATE"),
  autoPostSettlementJournal: settlementJournalPolicyField
    .optional()
    .default("AUTO"),
  allowVoidSettlement: settlementPolicyField.optional().default("YES"),
  allowBankMatch: settlementPolicyField.optional().default("YES"),
  /** AUTO = πλήρης εξόφληση με default τρόπο πληρωμής κατά την έκδοση */
  autoSettleOnIssue: settlementPolicyField.optional().default("NO"),
});

export const seriesUpdateSchema = seriesCreateSchema.partial();

export const MYDATA_INVOICE_TYPES = [
  { code: "1.1", label: "Τιμολόγιο Πώλησης" },
  { code: "1.2", label: "Τιμολόγιο Παροχής Υπηρεσιών" },
  { code: "1.3", label: "Τίτλος Κτήσης" },
  { code: "2.1", label: "Τιμολόγιο Ενδοκοινοτικό" },
  { code: "5.1", label: "Πιστωτικό Τιμολόγιο" },
  { code: "5.2", label: "Πιστωτικό Στοιχείο Λιανικής" },
  { code: "6.1", label: "Στοιχείο Λιανικής Πώλησης" },
  { code: "8.1", label: "Αποδείξη Είσπραξης" },
  { code: "8.2", label: "Αποδείξη Πληρωμής" },
  { code: "9.3", label: "Δελτίο Αποστολής" },
] as const;
