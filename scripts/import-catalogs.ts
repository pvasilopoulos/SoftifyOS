import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { importBundledCatalogs } from "../src/modules/catalogs/import";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { slug: "asc" },
  });
  if (tenants.length === 0) {
    throw new Error("Δεν υπάρχουν tenants — τρέξε πρώτα npm run db:seed");
  }
  for (const tenant of tenants) {
    const summary = await importBundledCatalogs(prisma, tenant.id);
    console.log(tenant.slug, summary);
  }
  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
