-- CreateEnum
CREATE TYPE "MarketplaceProvider" AS ENUM ('SKROUTZ', 'BESTPRICE', 'PUBLIC', 'SHOPIFY', 'WOOCOMMERCE', 'AMAZON', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MarketplaceChannelStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ERROR');

-- CreateTable
CREATE TABLE "marketplace_channels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "MarketplaceProvider" NOT NULL,
    "status" "MarketplaceChannelStatus" NOT NULL DEFAULT 'DRAFT',
    "merchantId" TEXT,
    "externalShopId" TEXT,
    "credentialsSecretKey" TEXT,
    "apiBaseHost" TEXT,
    "apiBaseUrl" TEXT,
    "syncCatalog" BOOLEAN NOT NULL DEFAULT true,
    "syncOrders" BOOLEAN NOT NULL DEFAULT true,
    "syncStock" BOOLEAN NOT NULL DEFAULT false,
    "syncPrices" BOOLEAN NOT NULL DEFAULT false,
    "autoImportOrders" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketplace_channels_tenantId_code_key" ON "marketplace_channels"("tenantId", "code");
CREATE INDEX "marketplace_channels_tenantId_provider_isActive_idx" ON "marketplace_channels"("tenantId", "provider", "isActive");
CREATE INDEX "marketplace_channels_tenantId_status_sortOrder_idx" ON "marketplace_channels"("tenantId", "status", "sortOrder");

ALTER TABLE "marketplace_channels"
  ADD CONSTRAINT "marketplace_channels_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate legacy Skroutz flags from TenantSettings.integrationsJson
INSERT INTO "marketplace_channels" (
  "id", "tenantId", "code", "name", "provider", "status",
  "merchantId", "notes", "syncCatalog", "syncOrders",
  "isActive", "sortOrder", "credentialsSecretKey", "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || ts."tenantId"),
  ts."tenantId",
  'SKROUTZ',
  'Skroutz Marketplace',
  'SKROUTZ'::"MarketplaceProvider",
  CASE
    WHEN COALESCE((ts."integrationsJson"->>'skroutzEnabled')::boolean, false)
      THEN 'ACTIVE'::"MarketplaceChannelStatus"
    ELSE 'DRAFT'::"MarketplaceChannelStatus"
  END,
  NULLIF(ts."integrationsJson"->>'skroutzShopId', ''),
  NULLIF(ts."integrationsJson"->>'marketplaceNotes', ''),
  true,
  true,
  true,
  10,
  'MARKETPLACE_TOKEN',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenant_settings" ts
WHERE ts."integrationsJson" IS NOT NULL
  AND (
    COALESCE((ts."integrationsJson"->>'skroutzEnabled')::boolean, false)
    OR NULLIF(ts."integrationsJson"->>'skroutzShopId', '') IS NOT NULL
    OR NULLIF(ts."integrationsJson"->>'marketplaceNotes', '') IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "marketplace_channels" mc
    WHERE mc."tenantId" = ts."tenantId" AND mc."code" = 'SKROUTZ'
  );
