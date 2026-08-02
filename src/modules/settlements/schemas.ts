import { z } from "zod";

export const settlementMethodLineSchema = z.object({
  paymentMethodId: z.string().min(1).optional().nullable(),
  method: z.string().trim().min(1).max(40).optional(),
  amount: z.coerce.number().positive().max(50_000_000),
  changeAmount: z.coerce.number().min(0).max(50_000_000).optional().default(0),
  externalRef: z.string().trim().max(120).optional().nullable(),
  giftCardId: z.string().min(1).optional().nullable(),
  loyaltyAccountId: z.string().min(1).optional().nullable(),
});

export const settlementAllocationSchema = z.object({
  targetType: z
    .enum(["INVOICE", "CREDIT_NOTE", "PURCHASE_INVOICE", "ON_ACCOUNT"])
    .default("INVOICE"),
  invoiceId: z.string().min(1).optional().nullable(),
  purchaseInvoiceId: z.string().min(1).optional().nullable(),
  amount: z.coerce.number().positive().max(50_000_000),
});

export const createReceiptSettlementSchema = z.object({
  customerId: z.string().min(1).optional().nullable(),
  legalEntityId: z.string().min(1).optional().nullable(),
  settledAt: z.string().datetime().optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Single-invoice shorthand used by collect UI */
  invoiceId: z.string().min(1).optional(),
  allocations: z.array(settlementAllocationSchema).max(50).optional(),
  methods: z.array(settlementMethodLineSchema).min(1).max(20),
});

export const createPaymentSettlementSchema = z.object({
  supplierId: z.string().min(1),
  legalEntityId: z.string().min(1).optional().nullable(),
  settledAt: z.string().datetime().optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  purchaseInvoiceId: z.string().min(1).optional(),
  allocations: z.array(settlementAllocationSchema).max(50).optional(),
  methods: z.array(settlementMethodLineSchema).min(1).max(20),
});

export type CreateReceiptSettlementInput = z.infer<
  typeof createReceiptSettlementSchema
>;
export type CreatePaymentSettlementInput = z.infer<
  typeof createPaymentSettlementSchema
>;
