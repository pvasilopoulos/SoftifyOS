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
      vatNumber: "998877661",
      email: "ops@nireas.example",
      phone: "+30 210 1110001",
      branches: [
        {
          code: "BR-ATH",
          name: "Αθήνα Κέντρο",
          city: "Αθήνα",
          address: "Πειραιώς 100",
          postalCode: "11854",
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
      vatNumber: "991122334",
      email: "info@aigaio.example",
      branches: [
        {
          code: "BR-HQ",
          name: "Έδρα Πειραιά",
          city: "Πειραιάς",
          address: "Ακτή Μιαούλη 20",
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
    const customer = await prisma.customer.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: c.code } },
      update: {
        name: c.name,
        vatNumber: c.vatNumber,
        email: c.email,
        phone: "phone" in c ? c.phone : undefined,
        status: "ACTIVE",
      },
      create: {
        tenantId: tenant.id,
        code: c.code,
        name: c.name,
        vatNumber: c.vatNumber,
        email: c.email,
        phone: "phone" in c ? (c.phone as string) : null,
        status: "ACTIVE",
      },
    });

    for (const b of c.branches) {
      const branch = await prisma.branch.upsert({
        where: {
          tenantId_customerId_code: {
            tenantId: tenant.id,
            customerId: customer.id,
            code: b.code,
          },
        },
        update: {
          name: b.name,
          city: b.city,
          address: b.address,
          postalCode: "postalCode" in b ? b.postalCode : null,
          isPrimary: b.isPrimary,
        },
        create: {
          tenantId: tenant.id,
          customerId: customer.id,
          code: b.code,
          name: b.name,
          city: b.city,
          address: b.address,
          postalCode: "postalCode" in b ? (b.postalCode as string) : null,
          isPrimary: b.isPrimary,
        },
      });

      for (const s of b.spaces) {
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

  console.log("Seeded customer → branch → space hierarchy");
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
