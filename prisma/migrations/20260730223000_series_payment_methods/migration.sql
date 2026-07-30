-- CreateTable
CREATE TABLE "document_series_payment_methods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_series_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_series_payment_methods_tenantId_seriesId_idx" ON "document_series_payment_methods"("tenantId", "seriesId");

-- CreateIndex
CREATE INDEX "document_series_payment_methods_tenantId_paymentMethodId_idx" ON "document_series_payment_methods"("tenantId", "paymentMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "document_series_payment_methods_seriesId_paymentMethodId_key" ON "document_series_payment_methods"("seriesId", "paymentMethodId");

-- AddForeignKey
ALTER TABLE "document_series_payment_methods" ADD CONSTRAINT "document_series_payment_methods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_series_payment_methods" ADD CONSTRAINT "document_series_payment_methods_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "document_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_series_payment_methods" ADD CONSTRAINT "document_series_payment_methods_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
