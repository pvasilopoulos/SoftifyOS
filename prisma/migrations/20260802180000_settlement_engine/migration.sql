-- Settlement Engine Φ1–Φ4

CREATE TYPE "SettlementKind" AS ENUM ('RECEIPT', 'PAYMENT', 'CLEARING');
CREATE TYPE "SettlementStatus" AS ENUM ('POSTED', 'VOIDED');
CREATE TYPE "SettlementTargetType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'PURCHASE_INVOICE', 'ON_ACCOUNT');

ALTER TABLE "document_series"
  ADD COLUMN IF NOT EXISTS "allowPartialSettlement" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "allowMultiTender" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "allowMultiDocumentSettlement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allowOnAccount" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "settlementClearingMode" TEXT NOT NULL DEFAULT 'IMMEDIATE';

ALTER TABLE "invoice_payments"
  ADD COLUMN IF NOT EXISTS "settlementId" TEXT;

CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "number" TEXT NOT NULL,
    "kind" "SettlementKind" NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'POSTED',
    "partyType" TEXT NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "clearingJournalId" TEXT,
    "bankStatementLineId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "settlements_tenantId_number_key" ON "settlements"("tenantId", "number");
CREATE INDEX "settlements_tenantId_kind_settledAt_idx" ON "settlements"("tenantId", "kind", "settledAt" DESC);
CREATE INDEX "settlements_tenantId_status_settledAt_idx" ON "settlements"("tenantId", "status", "settledAt" DESC);
CREATE INDEX "settlements_tenantId_customerId_settledAt_idx" ON "settlements"("tenantId", "customerId", "settledAt" DESC);
CREATE INDEX "settlements_tenantId_supplierId_settledAt_idx" ON "settlements"("tenantId", "supplierId", "settledAt" DESC);
CREATE INDEX "settlements_tenantId_legalEntityId_idx" ON "settlements"("tenantId", "legalEntityId");

CREATE TABLE "settlement_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "targetType" "SettlementTargetType" NOT NULL,
    "invoiceId" TEXT,
    "purchaseInvoiceId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "settlement_allocations_tenantId_settlementId_idx" ON "settlement_allocations"("tenantId", "settlementId");
CREATE INDEX "settlement_allocations_tenantId_invoiceId_idx" ON "settlement_allocations"("tenantId", "invoiceId");
CREATE INDEX "settlement_allocations_tenantId_purchaseInvoiceId_idx" ON "settlement_allocations"("tenantId", "purchaseInvoiceId");

CREATE TABLE "settlement_method_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "methodCode" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "changeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "externalRef" TEXT,
    "giftCardId" TEXT,
    "loyaltyAccountId" TEXT,
    "usesClearing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_method_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "settlement_method_lines_tenantId_settlementId_idx" ON "settlement_method_lines"("tenantId", "settlementId");
CREATE INDEX "settlement_method_lines_tenantId_paymentMethodId_idx" ON "settlement_method_lines"("tenantId", "paymentMethodId");

CREATE INDEX IF NOT EXISTS "invoice_payments_tenantId_settlementId_idx" ON "invoice_payments"("tenantId", "settlementId");

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlement_method_lines"
  ADD CONSTRAINT "settlement_method_lines_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_method_lines"
  ADD CONSTRAINT "settlement_method_lines_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
  ALTER TABLE "invoice_payments"
    ADD CONSTRAINT "invoice_payments_settlementId_fkey"
    FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
