-- CreateEnum
CREATE TYPE "SiteKind" AS ENUM ('BRANCH', 'TILL');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('SALES_ORDER', 'SALES_INVOICE', 'SALES_CREDIT', 'CUSTOMER_RECEIPT', 'DELIVERY_NOTE');

-- CreateEnum
CREATE TYPE "NumberResetPolicy" AS ENUM ('NEVER', 'YEARLY');

-- CreateEnum
CREATE TYPE "CustomerEffect" AS ENUM ('NONE', 'DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "InventoryEffect" AS ENUM ('NONE', 'OUT', 'IN');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIAL_INVOICED';

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "orderLineId" TEXT,
ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "quantityInvoiced" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'OTHER',
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SiteKind" NOT NULL DEFAULT 'BRANCH',
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_series" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "prefix" TEXT NOT NULL,
    "padLength" INTEGER NOT NULL DEFAULT 5,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "lastYear" INTEGER,
    "resetPolicy" "NumberResetPolicy" NOT NULL DEFAULT 'YEARLY',
    "siteId" TEXT,
    "affectsCustomer" "CustomerEffect" NOT NULL DEFAULT 'NONE',
    "affectsInventory" "InventoryEffect" NOT NULL DEFAULT 'NONE',
    "allowPartial" BOOLEAN NOT NULL DEFAULT false,
    "editableAfterIssue" BOOLEAN NOT NULL DEFAULT false,
    "myDataEnabled" BOOLEAN NOT NULL DEFAULT false,
    "myDataInvoiceType" TEXT,
    "myDataVatCategory" TEXT,
    "glDebitAccount" TEXT,
    "glCreditAccount" TEXT,
    "glVatAccount" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_payments_tenantId_invoiceId_paidAt_idx" ON "invoice_payments"("tenantId", "invoiceId", "paidAt" DESC);

-- CreateIndex
CREATE INDEX "sites_tenantId_kind_isActive_idx" ON "sites"("tenantId", "kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenantId_code_key" ON "sites"("tenantId", "code");

-- CreateIndex
CREATE INDEX "document_series_tenantId_kind_isActive_idx" ON "document_series"("tenantId", "kind", "isActive");

-- CreateIndex
CREATE INDEX "document_series_tenantId_siteId_kind_idx" ON "document_series"("tenantId", "siteId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "document_series_tenantId_code_key" ON "document_series"("tenantId", "code");

-- CreateIndex
CREATE INDEX "invoice_lines_tenantId_productId_idx" ON "invoice_lines"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "invoice_lines_tenantId_orderLineId_idx" ON "invoice_lines"("tenantId", "orderLineId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_seriesId_idx" ON "invoices"("tenantId", "seriesId");

-- CreateIndex
CREATE INDEX "orders_tenantId_seriesId_idx" ON "orders"("tenantId", "seriesId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "document_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "document_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
