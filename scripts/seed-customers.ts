import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const tenant = await prisma.tenant.findUnique({ where: { slug: "akropolis" } });
  if (!tenant) throw new Error("Run npm run db:seed first");

  const customers = [
    {
      code: "CUS-NIREAS",
      name: "Νηρέας Logistics ΑΕ",
      tradeName: "Nireas Logistics",
      legalForm: "AE" as const,
      vatNumber: "998877661",
      taxOffice: "Α' Αθηνών",
      gemhNumber: "123456789012",
      vatStatus: "NORMAL" as const,
      email: "ops@nireas.example",
      phone: "+30 210 1110001",
      mobile: "+30 694 1110001",
      website: "https://nireas.example",
      address: "Πειραιώς 100",
      city: "Αθήνα",
      postalCode: "11854",
      region: "Αττικής",
      country: "GR",
      category: "WHOLESALE" as const,
      salesperson: "Μ. Παπαδοπούλου",
      paymentTermsDays: 30,
      paymentTermsLabel: "30 ημέρες",
      creditLimit: 50000,
      currency: "EUR",
      locale: "el-GR",
      iban: "GR1601101250000000012300695",
      bic: "ETHNGRAA",
      bankName: "Εθνική Τράπεζα",
      bankAccountHolder: "Νηρέας Logistics ΑΕ",
      sendEinvoice: true,
      contacts: [
        {
          name: "Γιάννης Κωνσταντίνου",
          title: "Αγορές",
          email: "purchasing@nireas.example",
          phone: "+30 210 1110002",
          isPrimary: true,
        },
        {
          name: "Ελένη Νικολάου",
          title: "Λογιστήριο",
          email: "ap@nireas.example",
          mobile: "+30 693 2223344",
          isPrimary: false,
        },
      ],
      branches: [
        {
          code: "BR-ATH",
          name: "Αθήνα Κέντρο",
          city: "Αθήνα",
          address: "Πειραιώς 100",
          postalCode: "11854",
          region: "Αττικής",
          country: "GR",
          isPrimary: true,
          spaces: [
            {
              code: "OFF-1",
              name: "Γραφεία διοίκησης",
              type: "OFFICE" as const,
              floorLabel: "1ος",
              areaSqm: 180,
            },
            {
              code: "WH-A",
              name: "Αποθήκη Α",
              type: "WAREHOUSE" as const,
              floorLabel: "Ισόγειο",
              areaSqm: 1200,
            },
          ],
        },
        {
          code: "BR-SKG",
          name: "Θεσσαλονίκη",
          city: "Θεσσαλονίκη",
          address: "26ης Οκτωβρίου 50",
          postalCode: "54627",
          region: "Θεσσαλονίκης",
          country: "GR",
          isPrimary: false,
          spaces: [
            {
              code: "WH-B",
              name: "Αποθήκη Βορρά",
              type: "WAREHOUSE" as const,
              areaSqm: 800,
            },
            {
              code: "YARD-1",
              name: "Υπαίθριος χώρος staging",
              type: "YARD" as const,
              areaSqm: 400,
            },
          ],
        },
      ],
    },
    {
      code: "CUS-AIGAIO",
      name: "Αιγαίο Foods ΟΕ",
      tradeName: "Aegean Foods",
      legalForm: "OE" as const,
      vatNumber: "991122334",
      taxOffice: "Πειραιά",
      vatStatus: "NORMAL" as const,
      email: "info@aigaio.example",
      phone: "+30 210 9990001",
      address: "Ακτή Μιαούλη 20",
      city: "Πειραιάς",
      postalCode: "18531",
      region: "Αττικής",
      country: "GR",
      category: "RETAIL" as const,
      salesperson: "Ν. Γεωργίου",
      paymentTermsDays: 0,
      paymentTermsLabel: "Μετρητοίς",
      creditLimit: 10000,
      currency: "EUR",
      contacts: [
        {
          name: "Μαρία Αιγαίου",
          title: "Ιδιοκτήτρια",
          email: "info@aigaio.example",
          phone: "+30 210 9990001",
          isPrimary: true,
        },
      ],
      branches: [
        {
          code: "BR-HQ",
          name: "Έδρα Πειραιά",
          city: "Πειραιάς",
          address: "Ακτή Μιαούλη 20",
          postalCode: "18531",
          country: "GR",
          isPrimary: true,
          spaces: [
            {
              code: "PROD-1",
              name: "Χώρος παραγωγής",
              type: "OTHER" as const,
              areaSqm: 650,
            },
            {
              code: "OFF-HQ",
              name: "Reception",
              type: "ROOM" as const,
              floorLabel: "Ισόγειο",
              areaSqm: 40,
            },
          ],
        },
      ],
    },
  ];

  for (const c of customers) {
    const { branches, contacts, ...cust } = c;
    const customer = await prisma.customer.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: c.code } },
      update: {
        ...cust,
        status: "ACTIVE",
      },
      create: {
        tenantId: tenant.id,
        ...cust,
        status: "ACTIVE",
      },
    });

    for (const contact of contacts) {
      const existing = await prisma.customerContact.findFirst({
        where: {
          tenantId: tenant.id,
          customerId: customer.id,
          name: contact.name,
        },
      });
      if (existing) {
        await prisma.customerContact.update({
          where: { id: existing.id },
          data: contact,
        });
      } else {
        await prisma.customerContact.create({
          data: {
            tenantId: tenant.id,
            customerId: customer.id,
            ...contact,
          },
        });
      }
    }

    for (const b of branches) {
      const { spaces, ...branchData } = b;
      const branch = await prisma.branch.upsert({
        where: {
          tenantId_customerId_code: {
            tenantId: tenant.id,
            customerId: customer.id,
            code: b.code,
          },
        },
        update: branchData,
        create: {
          tenantId: tenant.id,
          customerId: customer.id,
          ...branchData,
        },
      });

      for (const s of spaces) {
        await prisma.space.upsert({
          where: {
            tenantId_branchId_code: {
              tenantId: tenant.id,
              branchId: branch.id,
              code: s.code,
            },
          },
          update: {
            name: s.name,
            type: s.type,
            floorLabel: "floorLabel" in s ? s.floorLabel : null,
            areaSqm: s.areaSqm,
          },
          create: {
            tenantId: tenant.id,
            branchId: branch.id,
            code: s.code,
            name: s.name,
            type: s.type,
            floorLabel: "floorLabel" in s ? (s.floorLabel as string) : null,
            areaSqm: s.areaSqm,
          },
        });
      }
    }
  }

  console.log("Seeded full ERP customers → contacts → branches → spaces");
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
