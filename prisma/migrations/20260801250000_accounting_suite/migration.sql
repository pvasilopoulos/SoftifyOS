-- Accounting suite: periods, dimensions, assets, purchase invoices, journal lifecycle

CREATE TYPE "FiscalPeriodKind" AS ENUM ('YEAR', 'MONTH');
CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'DISPOSED');
CREATE TYPE "FixedAssetDepreciationMethod" AS ENUM ('STRAIGHT_LINE');
CREATE TYPE "FixedAssetMovementKind" AS ENUM ('ACQUIRE', 'DEPRECIATE', 'DISPOSE', 'ADJUST');
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'PARTIAL', 'PAID', 'CANCELLED');

ALTER TABLE "gl_accounts" ADD COLUMN IF NOT EXISTS "reportGroup" TEXT;

ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "month" INTEGER;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "kind" "FiscalPeriodKind" NOT NULL DEFAULT 'YEAR';
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "closedByUserId" TEXT;

ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "isOpening" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reversesId" TEXT;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_reversesId_key" ON "journal_entries"("reversesId");
CREATE INDEX IF NOT EXISTS "journal_entries_tenantId_entryDate_idx" ON "journal_entries"("tenantId", "entryDate");
CREATE INDEX IF NOT EXISTS "fiscal_periods_tenantId_kind_year_month_idx" ON "fiscal_periods"("tenantId", "kind", "year", "month");

CREATE TABLE IF NOT EXISTS "legal_entities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vatNumber" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cost_centers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "costCenterId" TEXT;
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;

CREATE TABLE IF NOT EXISTS "fixed_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCost" DECIMAL(14,2) NOT NULL,
    "residualValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
    "depreciationMethod" "FixedAssetDepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "glAssetAccountId" TEXT NOT NULL,
    "glAccumDeprAccountId" TEXT NOT NULL,
    "glDeprExpenseAccountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "legalEntityId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fixed_asset_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL,
    "kind" "FixedAssetMovementKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memo" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fixed_asset_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "purchase_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "seriesId" TEXT,
    "legalEntityId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "purchase_invoice_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 24,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "glAccountId" TEXT,
    "costCenterId" TEXT,
    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "legal_entities_tenantId_code_key" ON "legal_entities"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "legal_entities_tenantId_isActive_idx" ON "legal_entities"("tenantId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_tenantId_code_key" ON "cost_centers"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "cost_centers_tenantId_isActive_idx" ON "cost_centers"("tenantId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "fixed_assets_tenantId_code_key" ON "fixed_assets"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "fixed_assets_tenantId_status_idx" ON "fixed_assets"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "fixed_asset_movements_tenantId_fixedAssetId_movedAt_idx" ON "fixed_asset_movements"("tenantId", "fixedAssetId", "movedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_invoices_tenantId_number_key" ON "purchase_invoices"("tenantId", "number");
CREATE INDEX IF NOT EXISTS "purchase_invoices_tenantId_status_issueDate_idx" ON "purchase_invoices"("tenantId", "status", "issueDate");
CREATE INDEX IF NOT EXISTS "purchase_invoices_tenantId_supplierId_idx" ON "purchase_invoices"("tenantId", "supplierId");
CREATE INDEX IF NOT EXISTS "purchase_invoice_lines_tenantId_purchaseInvoiceId_idx" ON "purchase_invoice_lines"("tenantId", "purchaseInvoiceId");
CREATE INDEX IF NOT EXISTS "journal_lines_tenantId_costCenterId_idx" ON "journal_lines"("tenantId", "costCenterId");
CREATE INDEX IF NOT EXISTS "journal_lines_tenantId_legalEntityId_idx" ON "journal_lines"("tenantId", "legalEntityId");

ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entries" DROP CONSTRAINT IF EXISTS "journal_entries_reversesId_fkey";
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_lines" DROP CONSTRAINT IF EXISTS "journal_lines_costCenterId_fkey";
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_lines" DROP CONSTRAINT IF EXISTS "journal_lines_legalEntityId_fkey";
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_glAssetAccountId_fkey" FOREIGN KEY ("glAssetAccountId") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_glAccumDeprAccountId_fkey" FOREIGN KEY ("glAccumDeprAccountId") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_glDeprExpenseAccountId_fkey" FOREIGN KEY ("glDeprExpenseAccountId") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_movements" ADD CONSTRAINT "fixed_asset_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fixed_asset_movements" ADD CONSTRAINT "fixed_asset_movements_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fixed_asset_movements" ADD CONSTRAINT "fixed_asset_movements_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
