import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
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
    include: { branches: true },
  });
  if (!nireas || !aigaio) throw new Error("Run npm run db:seed:customers first");

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" },
  });
  if (products.length === 0) throw new Error("Run npm run db:seed:products first");

  const pal = products.find((p) => p.sku === "SKU-PAL-040") ?? products[0]!;
  const log = products.find((p) => p.sku === "SKU-LOG-001") ?? products[0]!;
  const con = products.find((p) => p.sku === "SKU-CON-012") ?? products[0]!;

  const ath = nireas.branches.find((b) => b.code === "BR-ATH");
  const whA = ath?.spaces.find((s) => s.code === "WH-A");
  const hq = aigaio.branches.find((b) => b.code === "BR-HQ");

  const docs = [
    {
      number: "ΠΑΡ-2026-00021",
      customerId: nireas.id,
      branchId: ath?.id,
      spaceId: whA?.id,
      status: "CONFIRMED" as const,
      lines: [
        {
          productId: log.id,
          description: log.name,
          quantity: 1,
          unitPrice: Number(log.price),
          vatRate: Number(log.vatRate),
        },
        {
          productId: pal.id,
          description: pal.name,
          quantity: 20,
          unitPrice: Number(pal.price),
          vatRate: Number(pal.vatRate),
        },
      ],
    },
    {
      number: "ΠΑΡ-2026-00020",
      customerId: aigaio.id,
      branchId: hq?.id,
      status: "DRAFT" as const,
      lines: [
        {
          productId: con.id,
          description: con.name,
          quantity: 8,
          unitPrice: Number(con.price),
          vatRate: Number(con.vatRate),
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
        productId: line.productId,
        position: idx + 1,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        lineTotal: Math.round((net + vat) * 100) / 100,
      };
    });
    const total = Math.round((subtotal + vatAmount) * 100) / 100;

    await prisma.order.upsert({
      where: {
        tenantId_legalEntityId_number: {
          tenantId: tenant.id,
          legalEntityId: legalEntity.id,
          number: doc.number,
        },
      },
      update: {
        status: doc.status,
        customerId: doc.customerId,
        branchId: doc.branchId ?? null,
        spaceId: doc.spaceId ?? null,
        subtotal,
        vatAmount,
        total,
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
        customerId: doc.customerId,
        branchId: doc.branchId ?? null,
        spaceId: doc.spaceId ?? null,
        subtotal,
        vatAmount,
        total,
        currency: "EUR",
        lines: { create: prepared },
      },
    });
  }

  console.log(`Seeded ${docs.length} orders`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
