-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "quantityDelivered" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "quantityCredited" DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "sourceInvoiceLineId" TEXT;

-- AlterTable
ALTER TABLE "delivery_notes" ADD COLUMN IF NOT EXISTS "orderId" TEXT;

-- AlterTable
ALTER TABLE "delivery_note_lines" ADD COLUMN IF NOT EXISTS "orderLineId" TEXT;
ALTER TABLE "delivery_note_lines" ADD COLUMN IF NOT EXISTS "invoiceLineId" TEXT;
ALTER TABLE "delivery_note_lines" ADD COLUMN IF NOT EXISTS "quantityInvoiced" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TransformCoverageMode" AS ENUM ('FULL_COPY', 'QUANTITY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TransformIssueMode" AS ENUM ('DRAFT', 'ISSUE_NOW');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "document_transform_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceKind" "DocumentKind" NOT NULL,
    "targetKind" "DocumentKind" NOT NULL,
    "handlerKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "allowPartial" BOOLEAN NOT NULL DEFAULT true,
    "coverageMode" "TransformCoverageMode" NOT NULL DEFAULT 'QUANTITY',
    "issueMode" "TransformIssueMode" NOT NULL DEFAULT 'ISSUE_NOW',
    "copyNotes" BOOLEAN NOT NULL DEFAULT true,
    "defaultSeriesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_transform_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_transform_rules_tenantId_code_key"
  ON "document_transform_rules"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "document_transform_rules_tenantId_sourceKind_isActive_sortOrder_idx"
  ON "document_transform_rules"("tenantId", "sourceKind", "isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS "document_transform_rules_tenantId_handlerKey_idx"
  ON "document_transform_rules"("tenantId", "handlerKey");
CREATE INDEX IF NOT EXISTS "document_transform_rules_tenantId_defaultSeriesId_idx"
  ON "document_transform_rules"("tenantId", "defaultSeriesId");

CREATE INDEX IF NOT EXISTS "invoice_lines_tenantId_sourceInvoiceLineId_idx"
  ON "invoice_lines"("tenantId", "sourceInvoiceLineId");
CREATE INDEX IF NOT EXISTS "delivery_notes_tenantId_orderId_idx"
  ON "delivery_notes"("tenantId", "orderId");
CREATE INDEX IF NOT EXISTS "delivery_notes_tenantId_invoiceId_idx"
  ON "delivery_notes"("tenantId", "invoiceId");
CREATE INDEX IF NOT EXISTS "delivery_note_lines_tenantId_orderLineId_idx"
  ON "delivery_note_lines"("tenantId", "orderLineId");
CREATE INDEX IF NOT EXISTS "delivery_note_lines_tenantId_invoiceLineId_idx"
  ON "delivery_note_lines"("tenantId", "invoiceLineId");

DO $$ BEGIN
  ALTER TABLE "invoice_lines"
    ADD CONSTRAINT "invoice_lines_sourceInvoiceLineId_fkey"
    FOREIGN KEY ("sourceInvoiceLineId") REFERENCES "invoice_lines"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_notes"
    ADD CONSTRAINT "delivery_notes_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_note_lines"
    ADD CONSTRAINT "delivery_note_lines_orderLineId_fkey"
    FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_note_lines"
    ADD CONSTRAINT "delivery_note_lines_invoiceLineId_fkey"
    FOREIGN KEY ("invoiceLineId") REFERENCES "invoice_lines"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "document_transform_rules"
    ADD CONSTRAINT "document_transform_rules_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "document_transform_rules"
    ADD CONSTRAINT "document_transform_rules_defaultSeriesId_fkey"
    FOREIGN KEY ("defaultSeriesId") REFERENCES "document_series"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
