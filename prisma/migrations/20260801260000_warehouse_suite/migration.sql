-- Warehouse suite: bins, transfers, counts, reservations, valuation

ALTER TYPE "StockMovementSource" ADD VALUE IF NOT EXISTS 'TRANSFER';
ALTER TYPE "StockMovementSource" ADD VALUE IF NOT EXISTS 'COUNT';
ALTER TYPE "StockMovementSource" ADD VALUE IF NOT EXISTS 'RESERVE';

CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COUNTED', 'POSTED', 'CANCELLED');
CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "averageCost" DECIMAL(14,4);

ALTER TABLE "stock_balances" ADD COLUMN IF NOT EXISTS "qtyReserved" DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE "stock_balances" ADD COLUMN IF NOT EXISTS "binId" TEXT;

CREATE TABLE IF NOT EXISTS "stock_bins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_bins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_transfers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "fromSiteId" TEXT NOT NULL,
    "toSiteId" TEXT NOT NULL,
    "note" TEXT,
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_transfer_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "lotCode" TEXT,
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_counts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "countedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_count_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),
    "varianceQty" DECIMAL(14,3),
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_reservations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_bins_tenantId_siteId_code_key" ON "stock_bins"("tenantId", "siteId", "code");
CREATE INDEX IF NOT EXISTS "stock_bins_tenantId_siteId_isActive_idx" ON "stock_bins"("tenantId", "siteId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "stock_transfers_tenantId_number_key" ON "stock_transfers"("tenantId", "number");
CREATE INDEX IF NOT EXISTS "stock_transfers_tenantId_status_createdAt_idx" ON "stock_transfers"("tenantId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "stock_transfer_lines_tenantId_transferId_idx" ON "stock_transfer_lines"("tenantId", "transferId");
CREATE UNIQUE INDEX IF NOT EXISTS "stock_counts_tenantId_number_key" ON "stock_counts"("tenantId", "number");
CREATE INDEX IF NOT EXISTS "stock_counts_tenantId_status_createdAt_idx" ON "stock_counts"("tenantId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "stock_count_lines_tenantId_countId_idx" ON "stock_count_lines"("tenantId", "countId");
CREATE INDEX IF NOT EXISTS "stock_reservations_tenantId_status_siteId_idx" ON "stock_reservations"("tenantId", "status", "siteId");
CREATE INDEX IF NOT EXISTS "stock_reservations_tenantId_productId_status_idx" ON "stock_reservations"("tenantId", "productId", "status");
CREATE INDEX IF NOT EXISTS "stock_reservations_tenantId_refType_refId_idx" ON "stock_reservations"("tenantId", "refType", "refId");
CREATE INDEX IF NOT EXISTS "stock_balances_tenantId_binId_idx" ON "stock_balances"("tenantId", "binId");

ALTER TABLE "stock_bins" ADD CONSTRAINT "stock_bins_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_bins" ADD CONSTRAINT "stock_bins_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_balances" DROP CONSTRAINT IF EXISTS "stock_balances_binId_fkey";
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_binId_fkey" FOREIGN KEY ("binId") REFERENCES "stock_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_fromSiteId_fkey" FOREIGN KEY ("fromSiteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_toSiteId_fkey" FOREIGN KEY ("toSiteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
