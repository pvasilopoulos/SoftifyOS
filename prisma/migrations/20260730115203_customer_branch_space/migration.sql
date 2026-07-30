-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SpaceType" AS ENUM ('OFFICE', 'WAREHOUSE', 'FLOOR', 'ROOM', 'YARD', 'OTHER');

-- DropIndex
DROP INDEX "audit_events_tenant_action_created_id_idx";

-- DropIndex
DROP INDEX "audit_events_tenant_created_id_idx";

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vatNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SpaceType" NOT NULL DEFAULT 'OTHER',
    "floorLabel" TEXT,
    "areaSqm" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenantId_name_idx" ON "customers"("tenantId", "name");

-- CreateIndex
CREATE INDEX "customers_tenantId_createdAt_id_idx" ON "customers"("tenantId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "customers_tenantId_status_createdAt_idx" ON "customers"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_code_key" ON "customers"("tenantId", "code");

-- CreateIndex
CREATE INDEX "branches_tenantId_customerId_createdAt_idx" ON "branches"("tenantId", "customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "branches_tenantId_createdAt_id_idx" ON "branches"("tenantId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenantId_customerId_code_key" ON "branches"("tenantId", "customerId", "code");

-- CreateIndex
CREATE INDEX "spaces_tenantId_branchId_createdAt_idx" ON "spaces"("tenantId", "branchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "spaces_tenantId_type_createdAt_idx" ON "spaces"("tenantId", "type", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "spaces_tenantId_branchId_code_key" ON "spaces"("tenantId", "branchId", "code");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
