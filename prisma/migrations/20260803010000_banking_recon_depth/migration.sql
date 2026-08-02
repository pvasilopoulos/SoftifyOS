-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN "legalEntityId" TEXT;

-- AlterTable
ALTER TABLE "bank_statement_lines" ADD COLUMN "matchedPurchaseInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "bank_accounts_tenantId_legalEntityId_idx" ON "bank_accounts"("tenantId", "legalEntityId");

-- CreateIndex
CREATE INDEX "bank_statement_lines_tenantId_matchedPurchaseInvoiceId_idx" ON "bank_statement_lines"("tenantId", "matchedPurchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
