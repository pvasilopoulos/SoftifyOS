-- Greek HR package: employee master extensions, leave, digital work card, Ergani queue, payroll

-- Extend EmployeeStatus
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';

-- New enums
DO $$ BEGIN
  CREATE TYPE "LeaveRequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkCardStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkCardEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkCardEventSource" AS ENUM ('MANUAL', 'CARD', 'APP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ErganiSubmissionStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollPeriodStatus" AS ENUM ('DRAFT', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend employees
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "vatNumber" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "amka" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "ama" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "iban" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "birthDate" TIMESTAMP(3);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "nationality" TEXT NOT NULL DEFAULT 'GR';
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "contractType" TEXT NOT NULL DEFAULT 'INDEFINITE';
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "specialty" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "weeklyHours" DECIMAL(5,2);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "terminationDate" TIMESTAMP(3);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "erganiEmployeeId" TEXT;

CREATE INDEX IF NOT EXISTS "employees_tenantId_vatNumber_idx" ON "employees"("tenantId", "vatNumber");
CREATE INDEX IF NOT EXISTS "employees_tenantId_siteId_idx" ON "employees"("tenantId", "siteId");

DO $$ BEGIN
  ALTER TABLE "employees" ADD CONSTRAINT "employees_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Leave types
CREATE TABLE IF NOT EXISTS "leave_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysPerYear" INTEGER NOT NULL DEFAULT 20,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "leave_types_tenantId_code_key" ON "leave_types"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "leave_types_tenantId_isActive_sortOrder_idx" ON "leave_types"("tenantId", "isActive", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Leave requests
CREATE TABLE IF NOT EXISTS "leave_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "leave_requests_tenantId_status_fromDate_idx" ON "leave_requests"("tenantId", "status", "fromDate" DESC);
CREATE INDEX IF NOT EXISTS "leave_requests_tenantId_employeeId_fromDate_idx" ON "leave_requests"("tenantId", "employeeId", "fromDate" DESC);

DO $$ BEGIN
  ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leaveTypeId_fkey"
    FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Digital work cards
CREATE TABLE IF NOT EXISTS "work_cards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "status" "WorkCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "work_cards_tenantId_cardNumber_key" ON "work_cards"("tenantId", "cardNumber");
CREATE INDEX IF NOT EXISTS "work_cards_tenantId_employeeId_status_idx" ON "work_cards"("tenantId", "employeeId", "status");

DO $$ BEGIN
  ALTER TABLE "work_cards" ADD CONSTRAINT "work_cards_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_cards" ADD CONSTRAINT "work_cards_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Work card events (clock punches)
CREATE TABLE IF NOT EXISTS "work_card_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workCardId" TEXT,
    "type" "WorkCardEventType" NOT NULL,
    "source" "WorkCardEventSource" NOT NULL DEFAULT 'MANUAL',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "siteId" TEXT,
    "note" TEXT,
    "erganiStatus" "ErganiSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_card_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_card_events_tenantId_occurredAt_idx" ON "work_card_events"("tenantId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "work_card_events_tenantId_employeeId_occurredAt_idx" ON "work_card_events"("tenantId", "employeeId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "work_card_events_tenantId_erganiStatus_occurredAt_idx" ON "work_card_events"("tenantId", "erganiStatus", "occurredAt" DESC);

DO $$ BEGIN
  ALTER TABLE "work_card_events" ADD CONSTRAINT "work_card_events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_card_events" ADD CONSTRAINT "work_card_events_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_card_events" ADD CONSTRAINT "work_card_events_workCardId_fkey"
    FOREIGN KEY ("workCardId") REFERENCES "work_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_card_events" ADD CONSTRAINT "work_card_events_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ergani submission queue
CREATE TABLE IF NOT EXISTS "ergani_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "status" "ErganiSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "externalRef" TEXT,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ergani_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ergani_submissions_tenantId_status_createdAt_idx" ON "ergani_submissions"("tenantId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ergani_submissions_tenantId_entityType_entityId_idx" ON "ergani_submissions"("tenantId", "entityType", "entityId");

DO $$ BEGIN
  ALTER TABLE "ergani_submissions" ADD CONSTRAINT "ergani_submissions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Payroll
CREATE TABLE IF NOT EXISTS "payroll_periods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_periods_tenantId_year_month_key" ON "payroll_periods"("tenantId", "year", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_periods_tenantId_code_key" ON "payroll_periods"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "payroll_periods_tenantId_status_year_month_idx" ON "payroll_periods"("tenantId", "status", "year", "month");

DO $$ BEGIN
  ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "payroll_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "employeeEfka" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employerEfka" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_lines_periodId_employeeId_key" ON "payroll_lines"("periodId", "employeeId");
CREATE INDEX IF NOT EXISTS "payroll_lines_tenantId_periodId_idx" ON "payroll_lines"("tenantId", "periodId");

DO $$ BEGIN
  ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
