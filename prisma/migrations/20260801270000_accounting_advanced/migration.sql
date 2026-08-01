-- Parallel ledgers, cost allocations, intercompany matching

CREATE TABLE IF NOT EXISTS "parallel_ledgers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STATUTORY',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parallel_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "parallel_ledgers_tenantId_code_key" ON "parallel_ledgers"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "parallel_ledgers_tenantId_isActive_idx" ON "parallel_ledgers"("tenantId", "isActive");

ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "parallelLedgerId" TEXT;
CREATE INDEX IF NOT EXISTS "journal_entries_tenantId_parallelLedgerId_idx" ON "journal_entries"("tenantId", "parallelLedgerId");

CREATE TABLE IF NOT EXISTS "cost_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'PERCENT',
    "sourceCostCenterId" TEXT NOT NULL,
    "glAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "journalEntryId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cost_allocations_tenantId_code_key" ON "cost_allocations"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "cost_allocations_tenantId_status_idx" ON "cost_allocations"("tenantId", "status");

CREATE TABLE IF NOT EXISTS "cost_allocation_targets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "weight" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT "cost_allocation_targets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cost_allocation_targets_tenantId_allocationId_idx" ON "cost_allocation_targets"("tenantId", "allocationId");

CREATE TABLE IF NOT EXISTS "intercompany_matches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalEntityAId" TEXT NOT NULL,
    "legalEntityBId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "difference" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "notes" TEXT,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "intercompany_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "intercompany_matches_tenantId_code_key" ON "intercompany_matches"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "intercompany_matches_tenantId_status_idx" ON "intercompany_matches"("tenantId", "status");

CREATE TABLE IF NOT EXISTS "intercompany_match_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "lineAId" TEXT,
    "lineBId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "intercompany_match_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "intercompany_match_lines_tenantId_matchId_idx" ON "intercompany_match_lines"("tenantId", "matchId");

DO $$ BEGIN
  ALTER TABLE "parallel_ledgers" ADD CONSTRAINT "parallel_ledgers_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_parallelLedgerId_fkey"
    FOREIGN KEY ("parallelLedgerId") REFERENCES "parallel_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_sourceCostCenterId_fkey"
    FOREIGN KEY ("sourceCostCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_glAccountId_fkey"
    FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cost_allocation_targets" ADD CONSTRAINT "cost_allocation_targets_allocationId_fkey"
    FOREIGN KEY ("allocationId") REFERENCES "cost_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cost_allocation_targets" ADD CONSTRAINT "cost_allocation_targets_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intercompany_matches" ADD CONSTRAINT "intercompany_matches_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intercompany_matches" ADD CONSTRAINT "intercompany_matches_legalEntityAId_fkey"
    FOREIGN KEY ("legalEntityAId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intercompany_matches" ADD CONSTRAINT "intercompany_matches_legalEntityBId_fkey"
    FOREIGN KEY ("legalEntityBId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intercompany_matches" ADD CONSTRAINT "intercompany_matches_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intercompany_match_lines" ADD CONSTRAINT "intercompany_match_lines_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "intercompany_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intercompany_match_lines" ADD CONSTRAINT "intercompany_match_lines_lineAId_fkey"
    FOREIGN KEY ("lineAId") REFERENCES "journal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intercompany_match_lines" ADD CONSTRAINT "intercompany_match_lines_lineBId_fkey"
    FOREIGN KEY ("lineBId") REFERENCES "journal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
