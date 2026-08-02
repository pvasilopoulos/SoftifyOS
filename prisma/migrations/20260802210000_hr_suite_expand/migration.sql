-- CreateEnum
CREATE TYPE "HrDocumentCategory" AS ENUM ('CONTRACT', 'ID', 'MEDICAL', 'CERTIFICATE', 'TAX', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "ChecklistKind" AS ENUM ('ONBOARDING', 'OFFBOARDING', 'PERIODIC');

-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('TODO', 'DONE', 'SKIPPED');

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN "halfDay" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "leave_balance_adjustments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_holidays" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "isBlackout" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" "HrDocumentCategory" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklist_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "ChecklistKind" NOT NULL DEFAULT 'ONBOARDING',
    "title" TEXT NOT NULL,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'TODO',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_balance_adjustments_tenantId_year_employeeId_idx" ON "leave_balance_adjustments"("tenantId", "year", "employeeId");

-- CreateIndex
CREATE INDEX "leave_balance_adjustments_tenantId_leaveTypeId_idx" ON "leave_balance_adjustments"("tenantId", "leaveTypeId");

-- CreateIndex
CREATE INDEX "company_holidays_tenantId_date_idx" ON "company_holidays"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "company_holidays_tenantId_date_name_key" ON "company_holidays"("tenantId", "date", "name");

-- CreateIndex
CREATE INDEX "hr_documents_tenantId_employeeId_category_idx" ON "hr_documents"("tenantId", "employeeId", "category");

-- CreateIndex
CREATE INDEX "hr_documents_tenantId_expiresAt_idx" ON "hr_documents"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "employee_checklist_items_tenantId_employeeId_kind_status_idx" ON "employee_checklist_items"("tenantId", "employeeId", "kind", "status");

-- CreateIndex
CREATE INDEX "employee_checklist_items_tenantId_status_dueDate_idx" ON "employee_checklist_items"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "employees_tenantId_department_idx" ON "employees"("tenantId", "department");

-- CreateIndex
CREATE INDEX "leave_requests_tenantId_fromDate_toDate_idx" ON "leave_requests"("tenantId", "fromDate", "toDate");

-- AddForeignKey
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_holidays" ADD CONSTRAINT "company_holidays_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklist_items" ADD CONSTRAINT "employee_checklist_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklist_items" ADD CONSTRAINT "employee_checklist_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
