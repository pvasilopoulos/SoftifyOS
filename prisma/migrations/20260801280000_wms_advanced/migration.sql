-- WMS advanced: wave picking, serials, putaway rules, dual UoM, movement cost/serial

CREATE TYPE "StockSerialStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_TRANSIT', 'SHIPPED', 'SCRAPPED');
CREATE TYPE "PickWaveStatus" AS ENUM ('DRAFT', 'RELEASED', 'PICKING', 'DONE', 'CANCELLED');
CREATE TYPE "PickWaveLineStatus" AS ENUM ('OPEN', 'PICKED', 'SHORT', 'CANCELLED');
CREATE TYPE "PutawayStrategy" AS ENUM ('FIXED', 'ZONE', 'EMPTY_BIN');

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trackSerials" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "altUnitId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "altToBaseFactor" DECIMAL(14,6);

ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(14,4);
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "serial" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "uomId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "qtyInUom" DECIMAL(14,3);
CREATE INDEX IF NOT EXISTS "stock_movements_tenantId_serial_idx" ON "stock_movements"("tenantId", "serial");

CREATE TABLE IF NOT EXISTS "stock_serials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "status" "StockSerialStatus" NOT NULL DEFAULT 'AVAILABLE',
    "binId" TEXT,
    "lotCode" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_serials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_serials_tenantId_productId_serial_key" ON "stock_serials"("tenantId", "productId", "serial");
CREATE INDEX IF NOT EXISTS "stock_serials_tenantId_siteId_status_idx" ON "stock_serials"("tenantId", "siteId", "status");
CREATE INDEX IF NOT EXISTS "stock_serials_tenantId_status_updatedAt_idx" ON "stock_serials"("tenantId", "status", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "pick_waves" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "PickWaveStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "releasedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pick_waves_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pick_waves_tenantId_number_key" ON "pick_waves"("tenantId", "number");
CREATE INDEX IF NOT EXISTS "pick_waves_tenantId_status_createdAt_idx" ON "pick_waves"("tenantId", "status", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "pick_wave_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "qtyPicked" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "status" "PickWaveLineStatus" NOT NULL DEFAULT 'OPEN',
    "lotCode" TEXT,
    "fromBinId" TEXT,
    "serial" TEXT,
    "reservationId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "lineNo" INT NOT NULL DEFAULT 0,
    CONSTRAINT "pick_wave_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pick_wave_lines_tenantId_waveId_idx" ON "pick_wave_lines"("tenantId", "waveId");
CREATE INDEX IF NOT EXISTS "pick_wave_lines_tenantId_productId_status_idx" ON "pick_wave_lines"("tenantId", "productId", "status");

CREATE TABLE IF NOT EXISTS "putaway_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INT NOT NULL DEFAULT 100,
    "strategy" "PutawayStrategy" NOT NULL DEFAULT 'FIXED',
    "productId" TEXT,
    "zone" TEXT,
    "targetBinId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "putaway_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "putaway_rules_tenantId_siteId_code_key" ON "putaway_rules"("tenantId", "siteId", "code");
CREATE INDEX IF NOT EXISTS "putaway_rules_tenantId_siteId_priority_idx" ON "putaway_rules"("tenantId", "siteId", "priority");

CREATE TABLE IF NOT EXISTS "unit_conversions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT,
    "fromUnitId" TEXT NOT NULL,
    "toUnitId" TEXT NOT NULL,
    "factor" DECIMAL(14,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "unit_conversions_tenantId_productId_idx" ON "unit_conversions"("tenantId", "productId");
CREATE INDEX IF NOT EXISTS "unit_conversions_tenantId_fromUnitId_toUnitId_idx" ON "unit_conversions"("tenantId", "fromUnitId", "toUnitId");

DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_altUnitId_fkey"
    FOREIGN KEY ("altUnitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_binId_fkey"
    FOREIGN KEY ("binId") REFERENCES "stock_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "pick_waves" ADD CONSTRAINT "pick_waves_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pick_waves" ADD CONSTRAINT "pick_waves_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_waveId_fkey"
    FOREIGN KEY ("waveId") REFERENCES "pick_waves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_fromBinId_fkey"
    FOREIGN KEY ("fromBinId") REFERENCES "stock_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "putaway_rules" ADD CONSTRAINT "putaway_rules_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "putaway_rules" ADD CONSTRAINT "putaway_rules_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "putaway_rules" ADD CONSTRAINT "putaway_rules_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "putaway_rules" ADD CONSTRAINT "putaway_rules_targetBinId_fkey"
    FOREIGN KEY ("targetBinId") REFERENCES "stock_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_fromUnitId_fkey"
    FOREIGN KEY ("fromUnitId") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_toUnitId_fkey"
    FOREIGN KEY ("toUnitId") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
