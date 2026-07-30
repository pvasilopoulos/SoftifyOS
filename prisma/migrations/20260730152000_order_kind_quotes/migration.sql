-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('SALES_ORDER', 'SALES_QUOTE');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "kind" "OrderKind" NOT NULL DEFAULT 'SALES_ORDER';
ALTER TABLE "orders" ADD COLUMN "sourceQuoteId" TEXT;

-- CreateIndex
CREATE INDEX "orders_tenantId_kind_createdAt_idx" ON "orders"("tenantId", "kind", "createdAt" DESC);
CREATE INDEX "orders_tenantId_sourceQuoteId_idx" ON "orders"("tenantId", "sourceQuoteId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
