-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastTenantId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "workspacePrefs" JSONB;
