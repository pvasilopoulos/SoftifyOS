-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "relatedInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "invoices_tenantId_relatedInvoiceId_idx" ON "invoices"("tenantId", "relatedInvoiceId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_relatedInvoiceId_fkey" FOREIGN KEY ("relatedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
