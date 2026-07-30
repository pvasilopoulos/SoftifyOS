-- CreateEnum
CREATE TYPE "PrintPaperSize" AS ENUM ('A4', 'A5', 'RECEIPT_80');
CREATE TYPE "PrintOrientation" AS ENUM ('PORTRAIT', 'LANDSCAPE');
CREATE TYPE "GlAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateTable
CREATE TABLE "print_forms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentKind" "DocumentKind" NOT NULL,
    "paper" "PrintPaperSize" NOT NULL DEFAULT 'A4',
    "orientation" "PrintOrientation" NOT NULL DEFAULT 'PORTRAIT',
    "bodyJson" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_forms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_series_print_forms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "printFormId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_series_print_forms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gl_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GlAccountType" NOT NULL,
    "parentId" TEXT,
    "isPostable" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiscal_periods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "fiscalPeriodId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "glAccountId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "print_forms_tenantId_code_key" ON "print_forms"("tenantId", "code");
CREATE INDEX "print_forms_tenantId_documentKind_isActive_idx" ON "print_forms"("tenantId", "documentKind", "isActive");

CREATE UNIQUE INDEX "document_series_print_forms_seriesId_printFormId_key" ON "document_series_print_forms"("seriesId", "printFormId");
CREATE INDEX "document_series_print_forms_tenantId_seriesId_idx" ON "document_series_print_forms"("tenantId", "seriesId");

CREATE UNIQUE INDEX "gl_accounts_tenantId_code_key" ON "gl_accounts"("tenantId", "code");
CREATE INDEX "gl_accounts_tenantId_type_isActive_idx" ON "gl_accounts"("tenantId", "type", "isActive");
CREATE INDEX "gl_accounts_tenantId_parentId_idx" ON "gl_accounts"("tenantId", "parentId");

CREATE UNIQUE INDEX "fiscal_periods_tenantId_code_key" ON "fiscal_periods"("tenantId", "code");
CREATE INDEX "fiscal_periods_tenantId_year_status_idx" ON "fiscal_periods"("tenantId", "year", "status");

CREATE UNIQUE INDEX "journal_entries_tenantId_number_key" ON "journal_entries"("tenantId", "number");
CREATE INDEX "journal_entries_tenantId_status_postedAt_idx" ON "journal_entries"("tenantId", "status", "postedAt");
CREATE INDEX "journal_entries_tenantId_sourceType_sourceId_idx" ON "journal_entries"("tenantId", "sourceType", "sourceId");

CREATE INDEX "journal_lines_tenantId_journalEntryId_idx" ON "journal_lines"("tenantId", "journalEntryId");
CREATE INDEX "journal_lines_tenantId_glAccountId_idx" ON "journal_lines"("tenantId", "glAccountId");

-- FKs
ALTER TABLE "print_forms" ADD CONSTRAINT "print_forms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_series_print_forms" ADD CONSTRAINT "document_series_print_forms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_series_print_forms" ADD CONSTRAINT "document_series_print_forms_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "document_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_series_print_forms" ADD CONSTRAINT "document_series_print_forms_printFormId_fkey" FOREIGN KEY ("printFormId") REFERENCES "print_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
