-- AlterTable
ALTER TABLE "products" ADD COLUMN "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_barcode_key" ON "products"("tenantId", "barcode");

-- Backfill demo barcodes from SKU for easier POS scanning
UPDATE "products"
SET "barcode" = "sku"
WHERE "barcode" IS NULL;
