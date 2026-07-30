import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const products = [
  {
    sku: "SKU-LOG-001",
    name: "Υπηρεσίες logistics (μήνας)",
    unit: "μήν",
    price: 10000,
    vatRate: 24,
  },
  {
    sku: "SKU-PAL-040",
    name: "Αποθήκευση παλετών",
    unit: "παλ",
    price: 12.5,
    vatRate: 24,
  },
  {
    sku: "SKU-CON-012",
    name: "Συμβουλευτική παραγωγής",
    unit: "ώρ",
    price: 180,
    vatRate: 24,
  },
  {
    sku: "SKU-XDK-001",
    name: "Cross-dock ημέρας",
    unit: "ημ",
    price: 7350,
    vatRate: 24,
  },
  {
    sku: "SKU-SUP-100",
    name: "Support package",
    unit: "τεμ",
    price: 1782.26,
    vatRate: 24,
  },
  {
    sku: "SKU-TRN-050",
    name: "Μεταφορά παλέτας",
    unit: "παλ",
    price: 28,
    vatRate: 24,
    status: "INACTIVE" as const,
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const tenant = await prisma.tenant.findUnique({ where: { slug: "akropolis" } });
  if (!tenant) throw new Error("Run npm run db:seed first");

  for (const p of products) {
    await prisma.product.upsert({
      where: {
        tenantId_sku: { tenantId: tenant.id, sku: p.sku },
      },
      update: {
        name: p.name,
        unit: p.unit,
        price: p.price,
        vatRate: p.vatRate,
        status: p.status ?? "ACTIVE",
      },
      create: {
        tenantId: tenant.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        price: p.price,
        vatRate: p.vatRate,
        status: p.status ?? "ACTIVE",
      },
    });
  }

  console.log(`Seeded ${products.length} products`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
