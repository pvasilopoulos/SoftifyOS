-- Script Hooks Engine
CREATE TYPE "ScriptRuntime" AS ENUM ('SERVER', 'UI', 'BOTH');
CREATE TYPE "ScriptLifecycle" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "script_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scriptsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxTimeoutMs" INTEGER NOT NULL DEFAULT 3000,
    "maxHttpCalls" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "script_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "script_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" "EntityModule" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "eventKey" TEXT NOT NULL,
    "runtime" "ScriptRuntime" NOT NULL DEFAULT 'SERVER',
    "source" TEXT NOT NULL,
    "lifecycle" "ScriptLifecycle" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "timeoutMs" INTEGER NOT NULL DEFAULT 3000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "script_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "script_secrets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "script_secrets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "script_http_allowlist" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "script_http_allowlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "script_run_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scriptId" TEXT,
    "module" "EntityModule" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "httpCalls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "script_run_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "script_settings_tenantId_key" ON "script_settings"("tenantId");
CREATE UNIQUE INDEX "script_definitions_tenantId_module_code_key" ON "script_definitions"("tenantId", "module", "code");
CREATE INDEX "script_definitions_tenantId_module_eventKey_isActive_lifecycle_idx" ON "script_definitions"("tenantId", "module", "eventKey", "isActive", "lifecycle");
CREATE UNIQUE INDEX "script_secrets_tenantId_key_key" ON "script_secrets"("tenantId", "key");
CREATE INDEX "script_secrets_tenantId_idx" ON "script_secrets"("tenantId");
CREATE UNIQUE INDEX "script_http_allowlist_tenantId_host_key" ON "script_http_allowlist"("tenantId", "host");
CREATE INDEX "script_http_allowlist_tenantId_idx" ON "script_http_allowlist"("tenantId");
CREATE INDEX "script_run_logs_tenantId_createdAt_idx" ON "script_run_logs"("tenantId", "createdAt");
CREATE INDEX "script_run_logs_tenantId_module_eventKey_idx" ON "script_run_logs"("tenantId", "module", "eventKey");

ALTER TABLE "script_settings" ADD CONSTRAINT "script_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "script_definitions" ADD CONSTRAINT "script_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "script_secrets" ADD CONSTRAINT "script_secrets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "script_http_allowlist" ADD CONSTRAINT "script_http_allowlist_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "script_run_logs" ADD CONSTRAINT "script_run_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "script_run_logs" ADD CONSTRAINT "script_run_logs_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "script_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
