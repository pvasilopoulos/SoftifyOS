-- Enrich ScriptRunLog for operable run history at scale
CREATE TYPE "ScriptRunSource" AS ENUM ('PRODUCTION', 'TEST');

ALTER TABLE "script_run_logs"
  ADD COLUMN "source" "ScriptRunSource" NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN "scriptCode" TEXT,
  ADD COLUMN "scriptName" TEXT,
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "userEmail" TEXT,
  ADD COLUMN "userName" TEXT,
  ADD COLUMN "userRole" TEXT,
  ADD COLUMN "recordId" TEXT,
  ADD COLUMN "recordCode" TEXT,
  ADD COLUMN "logsJson" JSONB,
  ADD COLUMN "recordSnapshot" JSONB;

CREATE INDEX "script_run_logs_tenantId_success_createdAt_idx"
  ON "script_run_logs"("tenantId", "success", "createdAt");
CREATE INDEX "script_run_logs_tenantId_source_createdAt_idx"
  ON "script_run_logs"("tenantId", "source", "createdAt");
CREATE INDEX "script_run_logs_tenantId_scriptCode_idx"
  ON "script_run_logs"("tenantId", "scriptCode");
CREATE INDEX "script_run_logs_tenantId_userId_idx"
  ON "script_run_logs"("tenantId", "userId");
CREATE INDEX "script_run_logs_tenantId_recordId_idx"
  ON "script_run_logs"("tenantId", "recordId");
