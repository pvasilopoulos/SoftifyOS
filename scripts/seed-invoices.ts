import "dotenv/config";
import { PrismaClient, InvoiceStatus } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const tenant = await prisma.tenant.findUnique({ where: { slug: "akropolis" } });
  if (!tenant) throw new Error("Run npm run db:seed first");

  const legalEntity =
    (await prisma.legalEntity.findFirst({
      where: { tenantId: tenant.id, code: "MAIN" },
    })) ??
    (await prisma.legalEntity.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { code: "asc" },
    }));
  if (!legalEntity) throw new Error("No LegalEntity for tenant — run migrations/seed");

  const nireas = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, code: "CUS-NIREAS" },
    include: { branches: { include: { spaces: true } } },
  });
  const aigaio = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, code: "CUS-AIGAIO" },
    include: { branches: { include: { spaces: true } } },
  });
  if (!nireas || !aigaio) throw new Error("Run npm run db:seed:customers first");

  const ath = nireas.branches.find((b) => b.code === "BR-ATH");
  const skg = nireas.branches.find((b) => b.code === "BR-SKG");
  const hq = aigaio.branches.find((b) => b.code === "BR-HQ");
  const whA = ath?.spaces.find((s) => s.code === "WH-A");
  const yard = skg?.spaces.find((s) => s.code === "YARD-1");
  const prod = hq?.spaces.find((s) => s.code === "PROD-1");

  const docs: Array<{
    number: string;
    customerId: string;
    branchId?: string;
    spaceId?: string;
    status: InvoiceStatus;
    issuedAt: Date;
    dueAt: Date;
    paidAmount: number;
    lines: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
    }>;
  }> = [
    {
      number: "ΤΙΜ-2026-01482",
      customerId: nireas.id,
      branchId: ath?.id,
      spaceId: whA?.id,
      status: "ISSUED",
      issuedAt: new Date("2026-07-28"),
      dueAt: new Date("2026-08-27"),
      paidAmount: 0,
      lines: [
        {
          description: "Υπηρεσίες logistics Ιουλίου",
          quantity: 1,
          unitPrice: 10000,
          vatRate: 24,
        },
        {
          description: "Αποθήκευση παλετών",
          quantity: 40,
          unitPrice: 12.5,
          vatRate: 24,
        },
      ],
    },
    {
      number: "ΤΙΜ-2026-01481",
      customerId: aigaio.id,
      branchId: hq?.id,
      spaceId: prod?.id,
      status: "OVERDUE",
      issuedAt: new Date("2026-07-01"),
      dueAt: new Date("2026-07-15"),
      paidAmount: 1528.2,
      lines: [
        {
          description: "Συμβουλευτική παραγωγής",
          quantity: 12,
          unitPrice: 180,
          vatRate: 24,
        },
        {
          description: "Ανάλυση απαιτήσεων",
          quantity: 1,
          unitPrice: 900,
          vatRate: 24,
        },
      ],
    },
    {
      number: "ΤΙΜ-2026-01480",
      customerId: nireas.id,
      branchId: skg?.id,
      spaceId: yard?.id,
      status: "PAID",
      issuedAt: new Date("2026-06-20"),
      dueAt: new Date("2026-07-20"),
      paidAmount: 9112.8,
      lines: [
        {
          description: "Cross-dock Θεσσαλονίκης",
          quantity: 1,
          unitPrice: 7350,
          vatRate: 24,
        },
      ],
    },
    {
      number: "ΤΙΜ-2026-01479",
      customerId: aigaio.id,
      branchId: hq?.id,
      status: "PARTIAL",
      issuedAt: new Date("2026-07-18"),
      dueAt: new Date("2026-08-17"),
      paidAmount: 1200,
      lines: [
        {
          description: "Support package",
          quantity: 1,
          unitPrice: 1782.26,
          vatRate: 24,
        },
      ],
    },
    {
      number: "ΤΙΜ-2026-01478",
      customerId: nireas.id,
      branchId: ath?.id,
      status: "DRAFT",
      issuedAt: new Date("2026-07-29"),
      dueAt: new Date("2026-08-29"),
      paidAmount: 0,
      lines: [
        {
          description: "Πρόχειρη προσφορά μεταφοράς",
          quantity: 1,
          unitPrice: 516.13,
          vatRate: 24,
        },
      ],
    },
  ];

  for (const doc of docs) {
    let subtotal = 0;
    let vatAmount = 0;
    const prepared = doc.lines.map((line, idx) => {
      const net = line.quantity * line.unitPrice;
      const vat = net * (line.vatRate / 100);
      subtotal += net;
      vatAmount += vat;
      return {
        tenantId: tenant.id,
        position: idx + 1,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        lineTotal: Math.round((net + vat) * 100) / 100,
      };
    });
    const total = Math.round((subtotal + vatAmount) * 100) / 100;
    const paidAmount =
      doc.status === "PAID" ? total : Math.min(doc.paidAmount, total);

    await prisma.invoice.upsert({
      where: {
        tenantId_legalEntityId_number: {
          tenantId: tenant.id,
          legalEntityId: legalEntity.id,
          number: doc.number,
        },
      },
      update: {
        status: doc.status,
        issuedAt: doc.issuedAt,
        dueAt: doc.dueAt,
        customerId: doc.customerId,
        branchId: doc.branchId ?? null,
        spaceId: doc.spaceId ?? null,
        subtotal,
        vatAmount,
        total,
        paidAmount,
        lines: {
          deleteMany: {},
          create: prepared,
        },
      },
      create: {
        tenantId: tenant.id,
        legalEntityId: legalEntity.id,
        number: doc.number,
        status: doc.status,
        issuedAt: doc.issuedAt,
        dueAt: doc.dueAt,
        customerId: doc.customerId,
        branchId: doc.branchId ?? null,
        spaceId: doc.spaceId ?? null,
        subtotal,
        vatAmount,
        total,
        paidAmount,
        currency: "EUR",
        lines: { create: prepared },
      },
    });
  }

  console.log(`Seeded ${docs.length} invoices`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
