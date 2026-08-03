-- AlterTable
ALTER TABLE "document_series" ADD COLUMN "autoSettleOnIssue" "SettlementPolicy" NOT NULL DEFAULT 'NO';
