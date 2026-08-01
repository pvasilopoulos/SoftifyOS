-- AlterTable
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "baseGross" DECIMAL(14,2);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "monthlyAllowance" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WorkShiftKind" AS ENUM ('REGULAR', 'OVERTIME', 'REMOTE', 'ON_CALL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "work_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workDays" INTEGER NOT NULL DEFAULT 31,
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '17:00',
    "breakMinutes" INTEGER NOT NULL DEFAULT 30,
    "weeklyHours" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "work_schedule_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_schedule_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "work_shifts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "kind" "WorkShiftKind" NOT NULL DEFAULT 'REGULAR',
    "siteId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "work_schedules_tenantId_code_key" ON "work_schedules"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "work_schedules_tenantId_isActive_idx" ON "work_schedules"("tenantId", "isActive");

CREATE INDEX IF NOT EXISTS "work_schedule_assignments_tenantId_employeeId_fromDate_idx" ON "work_schedule_assignments"("tenantId", "employeeId", "fromDate" DESC);
CREATE INDEX IF NOT EXISTS "work_schedule_assignments_tenantId_scheduleId_idx" ON "work_schedule_assignments"("tenantId", "scheduleId");

CREATE UNIQUE INDEX IF NOT EXISTS "work_shifts_tenantId_employeeId_workDate_startTime_key" ON "work_shifts"("tenantId", "employeeId", "workDate", "startTime");
CREATE INDEX IF NOT EXISTS "work_shifts_tenantId_workDate_idx" ON "work_shifts"("tenantId", "workDate");
CREATE INDEX IF NOT EXISTS "work_shifts_tenantId_employeeId_workDate_idx" ON "work_shifts"("tenantId", "employeeId", "workDate");

DO $$ BEGIN
  ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "work_schedule_assignments" ADD CONSTRAINT "work_schedule_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "work_schedule_assignments" ADD CONSTRAINT "work_schedule_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "work_schedule_assignments" ADD CONSTRAINT "work_schedule_assignments_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "work_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
