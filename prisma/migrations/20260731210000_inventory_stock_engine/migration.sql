-- AlterEnum Create
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'ADJUST');
CREATE TYPE "StockMovementSource" AS ENUM ('MANUAL', 'INVOICE', 'CREDIT', 'ADJUSTMENT', 'OPENING');

-- AlterTable products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trackInventory" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyOnHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "source" "StockMovementSource" NOT NULL DEFAULT 'MANUAL',
    "qty" DECIMAL(14,3) NOT NULL,
    "qtyBefore" DECIMAL(14,3) NOT NULL,
    "qtyAfter" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_balances_tenantId_siteId_productId_key" ON "stock_balances"("tenantId", "siteId", "productId");
CREATE INDEX "stock_balances_tenantId_productId_idx" ON "stock_balances"("tenantId", "productId");
CREATE INDEX "stock_balances_tenantId_siteId_idx" ON "stock_balances"("tenantId", "siteId");
CREATE INDEX "stock_movements_tenantId_createdAt_id_idx" ON "stock_movements"("tenantId", "createdAt" DESC, "id" DESC);
CREATE INDEX "stock_movements_tenantId_productId_createdAt_idx" ON "stock_movements"("tenantId", "productId", "createdAt" DESC);
CREATE INDEX "stock_movements_tenantId_siteId_createdAt_idx" ON "stock_movements"("tenantId", "siteId", "createdAt" DESC);
CREATE INDEX "stock_movements_tenantId_refType_refId_idx" ON "stock_movements"("tenantId", "refType", "refId");

ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
