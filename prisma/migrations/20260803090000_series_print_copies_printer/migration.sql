-- AlterTable
ALTER TABLE "document_series" ADD COLUMN "printCopies" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "document_series" ADD COLUMN "printPrinter" TEXT;
