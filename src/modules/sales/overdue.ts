import { prisma } from "@/server/db";

/** Mark open invoices past due as OVERDUE (idempotent). */
export async function syncOverdueInvoices(tenantId: string) {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE invoices
    SET status = 'OVERDUE'::"InvoiceStatus",
        "updatedAt" = NOW()
    WHERE "tenantId" = ${tenantId}
      AND status IN ('ISSUED'::"InvoiceStatus", 'PARTIAL'::"InvoiceStatus")
      AND "dueAt" IS NOT NULL
      AND "dueAt" < ${now}
      AND "paidAmount" < total
  `;
}
