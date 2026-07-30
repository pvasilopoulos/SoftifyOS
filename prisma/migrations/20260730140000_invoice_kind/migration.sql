-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('SALES_INVOICE', 'SALES_CREDIT', 'RETAIL_RECEIPT');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'SALES_INVOICE';

-- CreateIndex
CREATE INDEX "invoices_tenantId_kind_createdAt_idx" ON "invoices"("tenantId", "kind", "createdAt" DESC);
