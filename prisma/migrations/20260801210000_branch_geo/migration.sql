-- AlterTable
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "geocodedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "branches_tenantId_lat_lng_idx" ON "branches"("tenantId", "lat", "lng");
