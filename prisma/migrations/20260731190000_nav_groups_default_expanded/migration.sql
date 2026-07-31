-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "navGroupsDefaultExpanded" BOOLEAN NOT NULL DEFAULT true;
