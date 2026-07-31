-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "mobileFooterOverrides" JSONB;
