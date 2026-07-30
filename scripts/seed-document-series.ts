import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const tenant = await prisma.tenant.findUnique({ where: { slug: "akropolis" } });
  if (!tenant) throw new Error("Run npm run db:seed first");

  const hq = await prisma.site.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "HQ" } },
    update: { name: "Κεντρικά Αθήνα", kind: "BRANCH", isActive: true },
    create: {
      tenantId: tenant.id,
      code: "HQ",
      name: "Κεντρικά Αθήνα",
      kind: "BRANCH",
    },
  });

  const till = await prisma.site.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "TILL-01" } },
    update: {
      name: "Ταμείο 1",
      kind: "TILL",
      parentId: hq.id,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      code: "TILL-01",
      name: "Ταμείο 1",
      kind: "TILL",
      parentId: hq.id,
    },
  });

  const year = new Date().getFullYear();

  const seriesDefs = [
    {
      code: "ΠΑΡ",
      name: "Παραγγελίες πώλησης",
      kind: "SALES_ORDER" as const,
      prefix: "ΠΑΡ-{YYYY}-",
      nextNumber: 22,
      lastYear: year,
      siteId: hq.id,
      affectsCustomer: "NONE" as const,
      affectsInventory: "NONE" as const,
      allowPartial: true,
      myDataEnabled: false,
      isDefault: true,
      glDebitAccount: null as string | null,
      glCreditAccount: null as string | null,
      glVatAccount: null as string | null,
      myDataInvoiceType: null as string | null,
    },
    {
      code: "ΤΙΜ",
      name: "Τιμολόγια πώλησης",
      kind: "SALES_INVOICE" as const,
      prefix: "ΤΙΜ-{YYYY}-",
      nextNumber: 1485,
      lastYear: year,
      siteId: hq.id,
      affectsCustomer: "DEBIT" as const,
      affectsInventory: "OUT" as const,
      allowPartial: true,
      myDataEnabled: true,
      myDataInvoiceType: "1.1",
      isDefault: true,
      glDebitAccount: "30.00.00",
      glCreditAccount: "70.00.00",
      glVatAccount: "54.00.00",
    },
    {
      code: "ΤΙΜ-T1",
      name: "Τιμολόγια ταμείου 1",
      kind: "SALES_INVOICE" as const,
      prefix: "Τ1-{YYYY}-",
      nextNumber: 1,
      lastYear: year,
      siteId: till.id,
      affectsCustomer: "DEBIT" as const,
      affectsInventory: "OUT" as const,
      allowPartial: false,
      myDataEnabled: true,
      myDataInvoiceType: "1.1",
      isDefault: false,
      glDebitAccount: "30.00.00",
      glCreditAccount: "70.00.00",
      glVatAccount: "54.00.00",
    },
    {
      code: "ΠΙΣ",
      name: "Πιστωτικά τιμολόγια",
      kind: "SALES_CREDIT" as const,
      prefix: "ΠΙΣ-{YYYY}-",
      nextNumber: 1,
      lastYear: year,
      siteId: hq.id,
      affectsCustomer: "CREDIT" as const,
      affectsInventory: "IN" as const,
      allowPartial: false,
      myDataEnabled: true,
      myDataInvoiceType: "5.1",
      isDefault: true,
      glDebitAccount: "70.00.00",
      glCreditAccount: "30.00.00",
      glVatAccount: "54.00.00",
    },
    {
      code: "ΕΙΣ",
      name: "Εισπράξεις πελατών",
      kind: "CUSTOMER_RECEIPT" as const,
      prefix: "ΕΙΣ-{YYYY}-",
      nextNumber: 1,
      lastYear: year,
      siteId: till.id,
      affectsCustomer: "CREDIT" as const,
      affectsInventory: "NONE" as const,
      allowPartial: true,
      myDataEnabled: true,
      myDataInvoiceType: "8.1",
      isDefault: true,
      glDebitAccount: "38.00.00",
      glCreditAccount: "30.00.00",
      glVatAccount: null,
    },
    {
      code: "ΔΑ",
      name: "Δελτία αποστολής",
      kind: "DELIVERY_NOTE" as const,
      prefix: "ΔΑ-{YYYY}-",
      nextNumber: 1,
      lastYear: year,
      siteId: hq.id,
      affectsCustomer: "NONE" as const,
      affectsInventory: "OUT" as const,
      allowPartial: true,
      myDataEnabled: true,
      myDataInvoiceType: "9.3",
      isDefault: true,
      glDebitAccount: null,
      glCreditAccount: null,
      glVatAccount: null,
    },
  ];

  for (const def of seriesDefs) {
    await prisma.documentSeries.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: def.code } },
      update: {
        name: def.name,
        kind: def.kind,
        prefix: def.prefix,
        nextNumber: def.nextNumber,
        lastYear: def.lastYear,
        siteId: def.siteId,
        affectsCustomer: def.affectsCustomer,
        affectsInventory: def.affectsInventory,
        allowPartial: def.allowPartial,
        myDataEnabled: def.myDataEnabled,
        myDataInvoiceType: def.myDataInvoiceType,
        myDataVatCategory: "1",
        glDebitAccount: def.glDebitAccount,
        glCreditAccount: def.glCreditAccount,
        glVatAccount: def.glVatAccount,
        isDefault: def.isDefault,
        isActive: true,
        resetPolicy: "YEARLY",
        padLength: 5,
      },
      create: {
        tenantId: tenant.id,
        code: def.code,
        name: def.name,
        kind: def.kind,
        prefix: def.prefix,
        nextNumber: def.nextNumber,
        lastYear: def.lastYear,
        siteId: def.siteId,
        affectsCustomer: def.affectsCustomer,
        affectsInventory: def.affectsInventory,
        allowPartial: def.allowPartial,
        myDataEnabled: def.myDataEnabled,
        myDataInvoiceType: def.myDataInvoiceType,
        myDataVatCategory: "1",
        glDebitAccount: def.glDebitAccount,
        glCreditAccount: def.glCreditAccount,
        glVatAccount: def.glVatAccount,
        isDefault: def.isDefault,
        isActive: true,
        resetPolicy: "YEARLY",
        padLength: 5,
      },
    });
  }

  console.log(`Seeded sites + ${seriesDefs.length} document series`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
