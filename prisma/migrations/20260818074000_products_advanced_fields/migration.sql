ALTER TABLE "products"
ADD COLUMN "category" TEXT,
ADD COLUMN "brand" TEXT,
ADD COLUMN "barcode" TEXT,
ADD COLUMN "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "stockOnHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN "minStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN "reorderQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN "location" TEXT,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "isTracked" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "products_tenantId_barcode_key" ON "products"("tenantId", "barcode");
CREATE INDEX "products_tenantId_category_idx" ON "products"("tenantId", "category");
CREATE INDEX "products_tenantId_brand_idx" ON "products"("tenantId", "brand");
