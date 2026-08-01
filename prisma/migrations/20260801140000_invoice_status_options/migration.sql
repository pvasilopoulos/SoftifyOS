-- Parametric invoice statuses

CREATE TABLE IF NOT EXISTS "invoice_status_options" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workflow" "InvoiceStatus" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "selectableOnCreate" BOOLEAN NOT NULL DEFAULT false,
    "tone" TEXT NOT NULL DEFAULT 'slate',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoice_status_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_status_options_tenantId_code_key"
  ON "invoice_status_options"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "invoice_status_options_tenantId_isActive_sortOrder_idx"
  ON "invoice_status_options"("tenantId", "isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS "invoice_status_options_tenantId_selectableOnCreate_isActive_idx"
  ON "invoice_status_options"("tenantId", "selectableOnCreate", "isActive");

DO $$ BEGIN
  ALTER TABLE "invoice_status_options" ADD CONSTRAINT "invoice_status_options_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "statusOptionId" TEXT;

CREATE INDEX IF NOT EXISTS "invoices_tenantId_statusOptionId_idx"
  ON "invoices"("tenantId", "statusOptionId");

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_statusOptionId_fkey"
    FOREIGN KEY ("statusOptionId") REFERENCES "invoice_status_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
