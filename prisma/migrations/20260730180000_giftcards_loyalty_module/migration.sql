-- CreateEnum
CREATE TYPE "GiftCardLedgerKind" AS ENUM ('ISSUE', 'REDEEM', 'ADJUST', 'VOID', 'EXPIRE');

-- AlterTable
CREATE INDEX "gift_cards_tenantId_createdAt_idx" ON "gift_cards"("tenantId", "createdAt" DESC);

-- CreateTable
CREATE TABLE "gift_card_ledgers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "kind" "GiftCardLedgerKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "invoiceId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gift_card_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Standard',
    "earnPointsPerEur" INTEGER NOT NULL DEFAULT 1,
    "redeemPointsPerEur" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "loyalty_programs_tenantId_key" ON "loyalty_programs"("tenantId");
CREATE INDEX "gift_card_ledgers_tenantId_giftCardId_createdAt_idx" ON "gift_card_ledgers"("tenantId", "giftCardId", "createdAt" DESC);

ALTER TABLE "gift_card_ledgers" ADD CONSTRAINT "gift_card_ledgers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_card_ledgers" ADD CONSTRAINT "gift_card_ledgers_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill ISSUE ledger rows for existing gift cards
INSERT INTO "gift_card_ledgers" ("id", "tenantId", "giftCardId", "kind", "amount", "balanceAfter", "note", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text),
  g."tenantId",
  g."id",
  'ISSUE'::"GiftCardLedgerKind",
  g."initialBalance",
  g."initialBalance",
  'Backfill from migration',
  g."createdAt"
FROM "gift_cards" g
WHERE NOT EXISTS (
  SELECT 1 FROM "gift_card_ledgers" l WHERE l."giftCardId" = g."id"
);

-- Seed default loyalty program per tenant that has loyalty accounts or any tenant
INSERT INTO "loyalty_programs" ("id", "tenantId", "name", "earnPointsPerEur", "redeemPointsPerEur", "isActive", "createdAt", "updatedAt")
SELECT
  md5(random()::text || t."id"),
  t."id",
  'Standard',
  1,
  100,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "loyalty_programs" p WHERE p."tenantId" = t."id"
);
