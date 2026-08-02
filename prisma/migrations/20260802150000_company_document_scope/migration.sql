-- A+B: document-level LegalEntity scope + membership company ACL

-- 1) Membership → LegalEntity ACL
CREATE TABLE IF NOT EXISTS "membership_companies" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "membership_companies_membershipId_legalEntityId_key"
  ON "membership_companies"("membershipId", "legalEntityId");
CREATE INDEX IF NOT EXISTS "membership_companies_legalEntityId_idx"
  ON "membership_companies"("legalEntityId");

-- 2) Ensure every tenant has a default LegalEntity (MAIN)
INSERT INTO "legal_entities" ("id", "tenantId", "code", "name", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || t.id),
  t.id,
  'MAIN',
  t.name,
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "legal_entities" le WHERE le."tenantId" = t.id
);

UPDATE "legal_entities" le
SET "isDefault" = true
WHERE le.id = (
  SELECT le2.id FROM "legal_entities" le2
  WHERE le2."tenantId" = le."tenantId"
  ORDER BY le2."isDefault" DESC, le2."code" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "legal_entities" x
  WHERE x."tenantId" = le."tenantId" AND x."isDefault" = true
);

-- 3) Add nullable columns
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;
ALTER TABLE "delivery_notes" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;
ALTER TABLE "document_series" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;

-- 4) Backfill from default LegalEntity per tenant
UPDATE "invoices" i
SET "legalEntityId" = (
  SELECT le.id FROM "legal_entities" le
  WHERE le."tenantId" = i."tenantId"
  ORDER BY le."isDefault" DESC, le."code" ASC
  LIMIT 1
)
WHERE i."legalEntityId" IS NULL;

UPDATE "orders" o
SET "legalEntityId" = (
  SELECT le.id FROM "legal_entities" le
  WHERE le."tenantId" = o."tenantId"
  ORDER BY le."isDefault" DESC, le."code" ASC
  LIMIT 1
)
WHERE o."legalEntityId" IS NULL;

UPDATE "delivery_notes" d
SET "legalEntityId" = (
  SELECT le.id FROM "legal_entities" le
  WHERE le."tenantId" = d."tenantId"
  ORDER BY le."isDefault" DESC, le."code" ASC
  LIMIT 1
)
WHERE d."legalEntityId" IS NULL;

UPDATE "purchase_orders" p
SET "legalEntityId" = (
  SELECT le.id FROM "legal_entities" le
  WHERE le."tenantId" = p."tenantId"
  ORDER BY le."isDefault" DESC, le."code" ASC
  LIMIT 1
)
WHERE p."legalEntityId" IS NULL;

UPDATE "document_series" s
SET "legalEntityId" = (
  SELECT le.id FROM "legal_entities" le
  WHERE le."tenantId" = s."tenantId"
  ORDER BY le."isDefault" DESC, le."code" ASC
  LIMIT 1
)
WHERE s."legalEntityId" IS NULL;

UPDATE "journal_entries" j
SET "legalEntityId" = (
  SELECT le.id FROM "legal_entities" le
  WHERE le."tenantId" = j."tenantId"
  ORDER BY le."isDefault" DESC, le."code" ASC
  LIMIT 1
)
WHERE j."legalEntityId" IS NULL;

UPDATE "journal_lines" jl
SET "legalEntityId" = je."legalEntityId"
FROM "journal_entries" je
WHERE jl."journalEntryId" = je.id
  AND jl."legalEntityId" IS NULL
  AND je."legalEntityId" IS NOT NULL;

UPDATE "purchase_invoices" pi
SET "legalEntityId" = (
  SELECT le.id FROM "legal_entities" le
  WHERE le."tenantId" = pi."tenantId"
  ORDER BY le."isDefault" DESC, le."code" ASC
  LIMIT 1
)
WHERE pi."legalEntityId" IS NULL;

-- 5) Enforce NOT NULL on operational docs
ALTER TABLE "invoices" ALTER COLUMN "legalEntityId" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "legalEntityId" SET NOT NULL;
ALTER TABLE "delivery_notes" ALTER COLUMN "legalEntityId" SET NOT NULL;
ALTER TABLE "purchase_orders" ALTER COLUMN "legalEntityId" SET NOT NULL;
ALTER TABLE "document_series" ALTER COLUMN "legalEntityId" SET NOT NULL;

-- 6) Replace unique constraints (tenant+number → tenant+company+number)
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_tenantId_number_key";
DROP INDEX IF EXISTS "invoices_tenantId_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenantId_legalEntityId_number_key"
  ON "invoices"("tenantId", "legalEntityId", "number");
CREATE INDEX IF NOT EXISTS "invoices_tenantId_legalEntityId_status_issuedAt_idx"
  ON "invoices"("tenantId", "legalEntityId", "status", "issuedAt" DESC);

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_tenantId_number_key";
DROP INDEX IF EXISTS "orders_tenantId_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "orders_tenantId_legalEntityId_number_key"
  ON "orders"("tenantId", "legalEntityId", "number");
CREATE INDEX IF NOT EXISTS "orders_tenantId_legalEntityId_status_orderedAt_idx"
  ON "orders"("tenantId", "legalEntityId", "status", "orderedAt" DESC);

ALTER TABLE "delivery_notes" DROP CONSTRAINT IF EXISTS "delivery_notes_tenantId_number_key";
DROP INDEX IF EXISTS "delivery_notes_tenantId_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_notes_tenantId_legalEntityId_number_key"
  ON "delivery_notes"("tenantId", "legalEntityId", "number");
CREATE INDEX IF NOT EXISTS "delivery_notes_tenantId_legalEntityId_status_issuedAt_idx"
  ON "delivery_notes"("tenantId", "legalEntityId", "status", "issuedAt" DESC);

ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_tenantId_number_key";
DROP INDEX IF EXISTS "purchase_orders_tenantId_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_tenantId_legalEntityId_number_key"
  ON "purchase_orders"("tenantId", "legalEntityId", "number");
CREATE INDEX IF NOT EXISTS "purchase_orders_tenantId_legalEntityId_status_orderedAt_idx"
  ON "purchase_orders"("tenantId", "legalEntityId", "status", "orderedAt" DESC);

ALTER TABLE "document_series" DROP CONSTRAINT IF EXISTS "document_series_tenantId_code_key";
DROP INDEX IF EXISTS "document_series_tenantId_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "document_series_tenantId_legalEntityId_code_key"
  ON "document_series"("tenantId", "legalEntityId", "code");
CREATE INDEX IF NOT EXISTS "document_series_tenantId_legalEntityId_kind_isActive_idx"
  ON "document_series"("tenantId", "legalEntityId", "kind", "isActive");

CREATE INDEX IF NOT EXISTS "journal_entries_tenantId_legalEntityId_idx"
  ON "journal_entries"("tenantId", "legalEntityId");

-- 7) Foreign keys
DO $$ BEGIN
  ALTER TABLE "membership_companies"
    ADD CONSTRAINT "membership_companies_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "membership_companies"
    ADD CONSTRAINT "membership_companies_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_notes"
    ADD CONSTRAINT "delivery_notes_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders"
    ADD CONSTRAINT "purchase_orders_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "document_series"
    ADD CONSTRAINT "document_series_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "journal_entries"
    ADD CONSTRAINT "journal_entries_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
