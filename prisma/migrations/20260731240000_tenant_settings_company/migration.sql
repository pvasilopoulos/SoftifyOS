-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "legalName" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "tradeName" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "vatNumber" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "taxOffice" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'GR';
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'el-GR';
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Europe/Athens';
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "maintenanceMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "integrationsJson" JSONB;
