import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

/** Ensure each demo tenant has MAIN + a second LegalEntity for company switching demos. */
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const tenants = await prisma.tenant.findMany({
    where: { slug: { in: ["akropolis", "softify", "softify-group"] } },
  });

  for (const t of tenants) {
    await prisma.legalEntity.upsert({
      where: { tenantId_code: { tenantId: t.id, code: "MAIN" } },
      create: {
        tenantId: t.id,
        code: "MAIN",
        name: t.name,
        isDefault: true,
        isActive: true,
      },
      update: { isDefault: true, isActive: true, name: t.name },
    });
    await prisma.legalEntity.upsert({
      where: { tenantId_code: { tenantId: t.id, code: "SUB" } },
      create: {
        tenantId: t.id,
        code: "SUB",
        name: `${t.name} — Θυγατρική`,
        isDefault: false,
        isActive: true,
      },
      update: { isActive: true },
    });
    const cos = await prisma.legalEntity.findMany({
      where: { tenantId: t.id },
      select: { code: true, name: true, isDefault: true },
    });
    console.log(t.slug, cos);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
