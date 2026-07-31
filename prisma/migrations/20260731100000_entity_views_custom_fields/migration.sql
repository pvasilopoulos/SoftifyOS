-- CreateEnum
CREATE TYPE "EntityModule" AS ENUM ('CUSTOMERS', 'PRODUCTS', 'INVOICES', 'ORDERS', 'QUOTES', 'GIFT_CARDS');
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "customFields" JSONB;
ALTER TABLE "products" ADD COLUMN "customFields" JSONB;
ALTER TABLE "invoices" ADD COLUMN "customFields" JSONB;
ALTER TABLE "orders" ADD COLUMN "customFields" JSONB;
ALTER TABLE "gift_cards" ADD COLUMN "customFields" JSONB;

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" "EntityModule" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "optionsJson" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "filterable" BOOLEAN NOT NULL DEFAULT false,
    "showInList" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entity_list_views" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" "EntityModule" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "configJson" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entity_list_views_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entity_form_views" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" "EntityModule" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "configJson" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entity_form_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_field_definitions_tenantId_entity_code_key" ON "custom_field_definitions"("tenantId", "entity", "code");
CREATE INDEX "custom_field_definitions_tenantId_entity_isActive_sortOrder_idx" ON "custom_field_definitions"("tenantId", "entity", "isActive", "sortOrder");
CREATE UNIQUE INDEX "entity_list_views_tenantId_entity_code_key" ON "entity_list_views"("tenantId", "entity", "code");
CREATE INDEX "entity_list_views_tenantId_entity_isActive_sortOrder_idx" ON "entity_list_views"("tenantId", "entity", "isActive", "sortOrder");
CREATE UNIQUE INDEX "entity_form_views_tenantId_entity_code_key" ON "entity_form_views"("tenantId", "entity", "code");
CREATE INDEX "entity_form_views_tenantId_entity_isActive_sortOrder_idx" ON "entity_form_views"("tenantId", "entity", "isActive", "sortOrder");

ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_list_views" ADD CONSTRAINT "entity_list_views_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_form_views" ADD CONSTRAINT "entity_form_views_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
