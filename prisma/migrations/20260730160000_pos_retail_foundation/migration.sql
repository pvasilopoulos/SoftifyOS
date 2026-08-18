-- AlterTable invoice_payments
ALTER TABLE "invoice_payments" ADD COLUMN IF NOT EXISTS "changeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice_payments" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
ALTER TABLE "invoice_payments" ADD COLUMN IF NOT EXISTS "posSessionId" TEXT;
ALTER TABLE "invoice_payments" ADD COLUMN IF NOT EXISTS "giftCardId" TEXT;
ALTER TABLE "invoice_payments" ADD COLUMN IF NOT EXISTS "loyaltyAccountId" TEXT;

-- CreateEnum
CREATE TYPE "PosSessionStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "PosTerminalProvider" AS ENUM ('MOCK', 'VIVA', 'WORLDLINE', 'OTHER');
CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'DEPLETED', 'VOID', 'EXPIRED');
CREATE TYPE "LoyaltyLedgerKind" AS ENUM ('EARN', 'REDEEM', 'ADJUST', 'VOID');

-- CreateTable
CREATE TABLE "pos_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "status" "PosSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openingFloat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closingCash" DECIMAL(14,2),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_terminals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "PosTerminalProvider" NOT NULL DEFAULT 'MOCK',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "configJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_terminals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gift_cards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "initialBalance" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "loyalty_ledgers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "LoyaltyLedgerKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loyalty_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pos_sessions_tenantId_status_openedAt_idx" ON "pos_sessions"("tenantId", "status", "openedAt" DESC);
CREATE INDEX "pos_sessions_tenantId_siteId_status_idx" ON "pos_sessions"("tenantId", "siteId", "status");
CREATE UNIQUE INDEX "pos_terminals_tenantId_code_key" ON "pos_terminals"("tenantId", "code");
CREATE INDEX "pos_terminals_tenantId_siteId_isActive_idx" ON "pos_terminals"("tenantId", "siteId", "isActive");
CREATE UNIQUE INDEX "gift_cards_tenantId_code_key" ON "gift_cards"("tenantId", "code");
CREATE INDEX "gift_cards_tenantId_status_idx" ON "gift_cards"("tenantId", "status");
CREATE UNIQUE INDEX "loyalty_accounts_tenantId_customerId_key" ON "loyalty_accounts"("tenantId", "customerId");
CREATE INDEX "loyalty_accounts_tenantId_isActive_idx" ON "loyalty_accounts"("tenantId", "isActive");
CREATE INDEX "loyalty_ledgers_tenantId_accountId_createdAt_idx" ON "loyalty_ledgers"("tenantId", "accountId", "createdAt" DESC);
CREATE INDEX "invoice_payments_tenantId_posSessionId_idx" ON "invoice_payments"("tenantId", "posSessionId");

ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_ledgers" ADD CONSTRAINT "loyalty_ledgers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_ledgers" ADD CONSTRAINT "loyalty_ledgers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_posSessionId_fkey" FOREIGN KEY ("posSessionId") REFERENCES "pos_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "loyalty_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
