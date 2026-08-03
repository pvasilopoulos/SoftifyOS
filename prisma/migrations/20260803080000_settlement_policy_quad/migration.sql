-- CreateEnum
CREATE TYPE "SettlementPolicy" AS ENUM ('NONE', 'NO', 'YES', 'AUTO');

-- Partial / overpay / on-account / write-off
ALTER TABLE "document_series" ALTER COLUMN "allowPartialSettlement" DROP DEFAULT;
ALTER TABLE "document_series"
  ALTER COLUMN "allowPartialSettlement" TYPE "SettlementPolicy"
  USING (
    CASE WHEN "allowPartialSettlement" THEN 'YES'::"SettlementPolicy"
         ELSE 'NO'::"SettlementPolicy" END
  );
ALTER TABLE "document_series"
  ALTER COLUMN "allowPartialSettlement" SET DEFAULT 'YES'::"SettlementPolicy";

ALTER TABLE "document_series" ALTER COLUMN "allowOverpayment" DROP DEFAULT;
ALTER TABLE "document_series"
  ALTER COLUMN "allowOverpayment" TYPE "SettlementPolicy"
  USING (
    CASE WHEN "allowOverpayment" THEN 'YES'::"SettlementPolicy"
         ELSE 'NO'::"SettlementPolicy" END
  );
ALTER TABLE "document_series"
  ALTER COLUMN "allowOverpayment" SET DEFAULT 'NO'::"SettlementPolicy";

ALTER TABLE "document_series" ALTER COLUMN "allowOnAccount" DROP DEFAULT;
ALTER TABLE "document_series"
  ALTER COLUMN "allowOnAccount" TYPE "SettlementPolicy"
  USING (
    CASE WHEN "allowOnAccount" THEN 'YES'::"SettlementPolicy"
         ELSE 'NO'::"SettlementPolicy" END
  );
ALTER TABLE "document_series"
  ALTER COLUMN "allowOnAccount" SET DEFAULT 'NO'::"SettlementPolicy";

ALTER TABLE "document_series" ALTER COLUMN "allowWriteOff" DROP DEFAULT;
ALTER TABLE "document_series"
  ALTER COLUMN "allowWriteOff" TYPE "SettlementPolicy"
  USING (
    CASE WHEN "allowWriteOff" THEN 'YES'::"SettlementPolicy"
         ELSE 'NO'::"SettlementPolicy" END
  );
ALTER TABLE "document_series"
  ALTER COLUMN "allowWriteOff" SET DEFAULT 'NO'::"SettlementPolicy";

-- Journal / void / bank
ALTER TABLE "document_series" ALTER COLUMN "autoPostSettlementJournal" DROP DEFAULT;
ALTER TABLE "document_series"
  ALTER COLUMN "autoPostSettlementJournal" TYPE "SettlementPolicy"
  USING (
    CASE WHEN "autoPostSettlementJournal" THEN 'AUTO'::"SettlementPolicy"
         ELSE 'NO'::"SettlementPolicy" END
  );
ALTER TABLE "document_series"
  ALTER COLUMN "autoPostSettlementJournal" SET DEFAULT 'AUTO'::"SettlementPolicy";

ALTER TABLE "document_series" ALTER COLUMN "allowVoidSettlement" DROP DEFAULT;
ALTER TABLE "document_series"
  ALTER COLUMN "allowVoidSettlement" TYPE "SettlementPolicy"
  USING (
    CASE WHEN "allowVoidSettlement" THEN 'YES'::"SettlementPolicy"
         ELSE 'NO'::"SettlementPolicy" END
  );
ALTER TABLE "document_series"
  ALTER COLUMN "allowVoidSettlement" SET DEFAULT 'YES'::"SettlementPolicy";

ALTER TABLE "document_series" ALTER COLUMN "allowBankMatch" DROP DEFAULT;
ALTER TABLE "document_series"
  ALTER COLUMN "allowBankMatch" TYPE "SettlementPolicy"
  USING (
    CASE WHEN "allowBankMatch" THEN 'YES'::"SettlementPolicy"
         ELSE 'NO'::"SettlementPolicy" END
  );
ALTER TABLE "document_series"
  ALTER COLUMN "allowBankMatch" SET DEFAULT 'YES'::"SettlementPolicy";

-- Card clearing: IMMEDIATE→NO, CLEARING→AUTO
ALTER TABLE "document_series" ADD COLUMN "cardClearingPolicy" "SettlementPolicy" NOT NULL DEFAULT 'NO';
UPDATE "document_series"
SET "cardClearingPolicy" = CASE
  WHEN "settlementClearingMode" = 'CLEARING' THEN 'AUTO'::"SettlementPolicy"
  ELSE 'NO'::"SettlementPolicy"
END;
ALTER TABLE "document_series" DROP COLUMN "settlementClearingMode";
