-- CreateEnum
CREATE TYPE "UnitOfMeasureKind" AS ENUM ('COUNT', 'WEIGHT', 'VOLUME', 'LENGTH', 'AREA', 'TIME', 'OTHER');

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "kind" "UnitOfMeasureKind" NOT NULL DEFAULT 'COUNT',
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "units_of_measure_tenantId_code_key" ON "units_of_measure"("tenantId", "code");
CREATE UNIQUE INDEX "units_of_measure_tenantId_symbol_key" ON "units_of_measure"("tenantId", "symbol");
CREATE INDEX "units_of_measure_tenantId_isActive_sortOrder_idx" ON "units_of_measure"("tenantId", "isActive", "sortOrder");
CREATE INDEX "units_of_measure_tenantId_kind_sortOrder_idx" ON "units_of_measure"("tenantId", "kind", "sortOrder");

ALTER TABLE "units_of_measure"
  ADD CONSTRAINT "units_of_measure_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default units per tenant
INSERT INTO "units_of_measure" (
  "id", "tenantId", "code", "name", "symbol", "kind", "decimals",
  "description", "sortOrder", "isActive", "isDefault", "isSystem", "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || t."id" || d.code),
  t."id",
  d.code,
  d.name,
  d.symbol,
  d.kind::"UnitOfMeasureKind",
  d.decimals,
  d.description,
  d.sort_order,
  true,
  d.is_default,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('PCS', 'Τεμάχια', 'τεμ', 'COUNT', 0, 'Βασική μονάδα τεμαχίων', 10, true),
    ('BOX', 'Κουτί', 'κουτί', 'COUNT', 0, NULL, 20, false),
    ('PKG', 'Συσκευασία', 'συσκ', 'COUNT', 0, NULL, 30, false),
    ('PAL', 'Παλέτα', 'παλ', 'COUNT', 0, NULL, 40, false),
    ('KG', 'Χιλιόγραμμα', 'kg', 'WEIGHT', 3, NULL, 50, false),
    ('G', 'Γραμμάρια', 'g', 'WEIGHT', 0, NULL, 60, false),
    ('LT', 'Λίτρα', 'lt', 'VOLUME', 3, NULL, 70, false),
    ('ML', 'Χιλιοστόλιτρα', 'ml', 'VOLUME', 0, NULL, 80, false),
    ('M', 'Μέτρα', 'm', 'LENGTH', 2, NULL, 90, false),
    ('CM', 'Εκατοστά', 'cm', 'LENGTH', 0, NULL, 100, false),
    ('M2', 'Τετραγωνικά μέτρα', 'm²', 'AREA', 2, NULL, 110, false),
    ('HR', 'Ώρες', 'ώρα', 'TIME', 2, NULL, 120, false)
) AS d(code, name, symbol, kind, decimals, description, sort_order, is_default);

-- Link products to units
ALTER TABLE "products" ADD COLUMN "unitId" TEXT;

-- Match existing product.unit strings to seeded symbols (case-insensitive)
UPDATE "products" p
SET "unitId" = u."id"
FROM "units_of_measure" u
WHERE u."tenantId" = p."tenantId"
  AND lower(u."symbol") = lower(trim(p."unit"));

-- Create ad-hoc units for unmatched product.unit values
INSERT INTO "units_of_measure" (
  "id", "tenantId", "code", "name", "symbol", "kind", "decimals",
  "sortOrder", "isActive", "isDefault", "isSystem", "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || p."tenantId" || lower(p.unit)),
  p."tenantId",
  'U_' || left(md5(p."tenantId" || lower(p.unit)), 10),
  p.unit,
  p.unit,
  'OTHER'::"UnitOfMeasureKind",
  0,
  200,
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "tenantId", trim("unit") AS unit
  FROM "products"
  WHERE "unitId" IS NULL AND trim("unit") <> ''
) p
WHERE NOT EXISTS (
  SELECT 1 FROM "units_of_measure" u
  WHERE u."tenantId" = p."tenantId"
    AND lower(u."symbol") = lower(p.unit)
);

UPDATE "products" p
SET "unitId" = u."id"
FROM "units_of_measure" u
WHERE p."unitId" IS NULL
  AND u."tenantId" = p."tenantId"
  AND lower(u."symbol") = lower(trim(p."unit"));

-- Fallback: default PCS unit
UPDATE "products" p
SET
  "unitId" = u."id",
  "unit" = u."symbol"
FROM "units_of_measure" u
WHERE p."unitId" IS NULL
  AND u."tenantId" = p."tenantId"
  AND u."code" = 'PCS';

CREATE INDEX "products_tenantId_unitId_idx" ON "products"("tenantId", "unitId");

ALTER TABLE "products"
  ADD CONSTRAINT "products_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
