-- AlterEnum
ALTER TYPE "StockMovementSource" ADD VALUE IF NOT EXISTS 'DELIVERY';

CREATE TYPE "DeliveryNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');
CREATE TYPE "MyDataSubmissionStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED');
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT,
    "seriesId" TEXT,
    "invoiceId" TEXT,
    "number" TEXT NOT NULL,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "shippingAddress" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_note_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "productId" TEXT,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'τεμ',
    CONSTRAINT "delivery_note_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mydata_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityNumber" TEXT,
    "invoiceType" TEXT,
    "vatCategory" TEXT,
    "status" "MyDataSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "response" JSONB,
    "mark" TEXT,
    "uid" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mydata_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "department" TEXT,
    "hireDate" TIMESTAMP(3),
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_notes_tenantId_number_key" ON "delivery_notes"("tenantId", "number");
CREATE INDEX "delivery_notes_tenantId_status_issuedAt_idx" ON "delivery_notes"("tenantId", "status", "issuedAt" DESC);
CREATE INDEX "delivery_notes_tenantId_customerId_createdAt_idx" ON "delivery_notes"("tenantId", "customerId", "createdAt" DESC);
CREATE INDEX "delivery_notes_tenantId_createdAt_id_idx" ON "delivery_notes"("tenantId", "createdAt" DESC, "id" DESC);
CREATE INDEX "delivery_note_lines_tenantId_deliveryNoteId_position_idx" ON "delivery_note_lines"("tenantId", "deliveryNoteId", "position");
CREATE INDEX "delivery_note_lines_tenantId_productId_idx" ON "delivery_note_lines"("tenantId", "productId");
CREATE INDEX "mydata_submissions_tenantId_status_createdAt_idx" ON "mydata_submissions"("tenantId", "status", "createdAt" DESC);
CREATE INDEX "mydata_submissions_tenantId_entityType_entityId_idx" ON "mydata_submissions"("tenantId", "entityType", "entityId");
CREATE UNIQUE INDEX "employees_tenantId_code_key" ON "employees"("tenantId", "code");
CREATE INDEX "employees_tenantId_lastName_firstName_idx" ON "employees"("tenantId", "lastName", "firstName");
CREATE INDEX "employees_tenantId_status_createdAt_idx" ON "employees"("tenantId", "status", "createdAt" DESC);

ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "document_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mydata_submissions" ADD CONSTRAINT "mydata_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
