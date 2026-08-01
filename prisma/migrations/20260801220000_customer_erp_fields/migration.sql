-- CreateEnum
CREATE TYPE "CustomerLegalForm" AS ENUM ('AE', 'OE', 'EE', 'IKE', 'EPE', 'INDIVIDUAL', 'PUBLIC', 'NGO', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerVatStatus" AS ENUM ('NORMAL', 'EXEMPT', 'INTRA_EU', 'EXPORT', 'OSS');

-- CreateEnum
CREATE TYPE "CustomerCategory" AS ENUM ('RETAIL', 'WHOLESALE', 'DISTRIBUTOR', 'PUBLIC', 'INTERNAL', 'OTHER');

-- AlterTable customers
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tradeName" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "legalForm" "CustomerLegalForm";
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isPerson" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "taxOffice" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "gemhNumber" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "eoriNumber" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "vatStatus" "CustomerVatStatus" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "profession" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "mobile" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "fax" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "address2" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'GR';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shippingAddress" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shippingAddress2" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shippingCity" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shippingPostalCode" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shippingRegion" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shippingCountry" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "category" "CustomerCategory";
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "salesperson" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "paymentTermsDays" INTEGER;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "paymentTermsLabel" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "creditLimit" DECIMAL(14,2);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'el-GR';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(5,2);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "priceListCode" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shippingMethod" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "iban" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "bic" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "bankAccountHolder" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "sendEinvoice" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "customers_tenantId_vatNumber_idx" ON "customers"("tenantId", "vatNumber");
CREATE INDEX IF NOT EXISTS "customers_tenantId_city_idx" ON "customers"("tenantId", "city");
CREATE INDEX IF NOT EXISTS "customers_tenantId_category_idx" ON "customers"("tenantId", "category");

-- AlterTable branches
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "address2" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'GR';
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "fax" TEXT;

-- CreateTable customer_contacts
CREATE TABLE IF NOT EXISTS "customer_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "customer_contacts_tenantId_customerId_isPrimary_idx" ON "customer_contacts"("tenantId", "customerId", "isPrimary");
CREATE INDEX IF NOT EXISTS "customer_contacts_tenantId_customerId_createdAt_idx" ON "customer_contacts"("tenantId", "customerId", "createdAt" DESC);

DO $$ BEGIN
  ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill HQ address from primary branch where customer address empty
UPDATE customers c
SET
  address = COALESCE(c.address, b.address),
  city = COALESCE(c.city, b.city),
  "postalCode" = COALESCE(c."postalCode", b."postalCode"),
  phone = COALESCE(c.phone, b.phone)
FROM branches b
WHERE b."customerId" = c.id
  AND b."isPrimary" = true
  AND c.address IS NULL;
