-- Gift card GL tracking + ledger posting snapshot
ALTER TABLE "gift_cards" ADD COLUMN "glLiabilityAccount" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "glCashAccount" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "glRedeemContraAccount" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "costCenter" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "accountingCode" TEXT;

ALTER TABLE "gift_card_ledgers" ADD COLUMN "glDebitAccount" TEXT;
ALTER TABLE "gift_card_ledgers" ADD COLUMN "glCreditAccount" TEXT;

-- Backfill sensible Greek chart defaults on existing cards
UPDATE "gift_cards"
SET
  "glLiabilityAccount" = COALESCE("glLiabilityAccount", '56.00.00'),
  "glCashAccount" = COALESCE("glCashAccount", '38.00.00'),
  "glRedeemContraAccount" = COALESCE("glRedeemContraAccount", '70.00.00')
WHERE "glLiabilityAccount" IS NULL
   OR "glCashAccount" IS NULL
   OR "glRedeemContraAccount" IS NULL;

-- Backfill ISSUE ledger postings where missing
UPDATE "gift_card_ledgers" l
SET
  "glDebitAccount" = COALESCE(l."glDebitAccount", g."glCashAccount", '38.00.00'),
  "glCreditAccount" = COALESCE(l."glCreditAccount", g."glLiabilityAccount", '56.00.00')
FROM "gift_cards" g
WHERE l."giftCardId" = g."id"
  AND l."kind" = 'ISSUE'
  AND (l."glDebitAccount" IS NULL OR l."glCreditAccount" IS NULL);

UPDATE "gift_card_ledgers" l
SET
  "glDebitAccount" = COALESCE(l."glDebitAccount", g."glLiabilityAccount", '56.00.00'),
  "glCreditAccount" = COALESCE(l."glCreditAccount", g."glRedeemContraAccount", '70.00.00')
FROM "gift_cards" g
WHERE l."giftCardId" = g."id"
  AND l."kind" = 'REDEEM'
  AND (l."glDebitAccount" IS NULL OR l."glCreditAccount" IS NULL);

UPDATE "gift_card_ledgers" l
SET
  "glDebitAccount" = COALESCE(l."glDebitAccount", g."glLiabilityAccount", '56.00.00'),
  "glCreditAccount" = COALESCE(l."glCreditAccount", g."glCashAccount", '38.00.00')
FROM "gift_cards" g
WHERE l."giftCardId" = g."id"
  AND l."kind" IN ('VOID', 'EXPIRE')
  AND (l."glDebitAccount" IS NULL OR l."glCreditAccount" IS NULL);
