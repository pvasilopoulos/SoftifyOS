-- CreateEnum
CREATE TYPE "PaymentMethodKind" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'GIFT_CARD', 'LOYALTY', 'OTHER');

-- AlterTable
ALTER TABLE "invoice_payments" ADD COLUMN "paymentMethodId" TEXT;

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PaymentMethodKind" NOT NULL,
    "description" TEXT,
    "glAccount" TEXT,
    "glContraAccount" TEXT,
    "glClearingAccount" TEXT,
    "costCenter" TEXT,
    "accountingCode" TEXT,
    "bankIban" TEXT,
    "bankName" TEXT,
    "myDataPaymentType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showInPos" BOOLEAN NOT NULL DEFAULT true,
    "showInCollect" BOOLEAN NOT NULL DEFAULT true,
    "requiresExternalRef" BOOLEAN NOT NULL DEFAULT false,
    "allowsChange" BOOLEAN NOT NULL DEFAULT false,
    "affectsCashDrawer" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_methods_tenantId_code_key" ON "payment_methods"("tenantId", "code");
CREATE INDEX "payment_methods_tenantId_isActive_sortOrder_idx" ON "payment_methods"("tenantId", "isActive", "sortOrder");
CREATE INDEX "payment_methods_tenantId_showInPos_sortOrder_idx" ON "payment_methods"("tenantId", "showInPos", "sortOrder");
CREATE INDEX "invoice_payments_tenantId_paymentMethodId_idx" ON "invoice_payments"("tenantId", "paymentMethodId");

ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default methods for every tenant
INSERT INTO "payment_methods" (
  "id", "tenantId", "code", "name", "kind", "description",
  "glAccount", "glContraAccount", "glClearingAccount",
  "sortOrder", "isActive", "showInPos", "showInCollect",
  "requiresExternalRef", "allowsChange", "affectsCashDrawer", "isSystem",
  "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || t.id || d.code),
  t.id,
  d.code,
  d.name,
  d.kind::"PaymentMethodKind",
  d.description,
  d.gl_account,
  d.gl_contra,
  d.gl_clearing,
  d.sort_order,
  true,
  d.show_pos,
  d.show_collect,
  d.req_ext,
  d.allows_change,
  d.affects_cash,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('CASH', 'Μετρητά', 'CASH', 'Μετρητά στο ταμείο', '38.00.00', '30.00.00', NULL, 10, true, true, false, true, true),
    ('CARD', 'Κάρτα (POS)', 'CARD', 'Κάρτα μέσω τερματικού', '33.90.00', '30.00.00', '33.90.01', 20, true, true, true, false, false),
    ('TRANSFER', 'Μεταφορά', 'TRANSFER', 'Τραπεζική μεταφορά', '38.03.00', '30.00.00', NULL, 30, true, true, false, false, false),
    ('GIFT_CARD', 'Δωροκάρτα', 'GIFT_CARD', 'Εξαργύρωση δωροκάρτας', '56.00.00', '30.00.00', NULL, 40, true, false, false, false, false),
    ('LOYALTY', 'Πόντοι loyalty', 'LOYALTY', 'Εξαργύρωση πόντων', '64.90.00', '30.00.00', NULL, 50, false, false, false, false, false),
    ('OTHER', 'Άλλο', 'OTHER', 'Λοιποί τρόποι', '38.99.00', '30.00.00', NULL, 90, true, true, false, false, false)
) AS d(code, name, kind, description, gl_account, gl_contra, gl_clearing, sort_order, show_pos, show_collect, req_ext, allows_change, affects_cash)
WHERE NOT EXISTS (
  SELECT 1 FROM "payment_methods" pm WHERE pm."tenantId" = t.id AND pm."code" = d.code
);
