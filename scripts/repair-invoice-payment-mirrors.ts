import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { repairCollapsedInvoicePaymentMirrors } from "../src/modules/settlements/service";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true },
  });
  for (const t of tenants) {
    const result = await repairCollapsedInvoicePaymentMirrors(prisma, t.id);
    console.log(t.slug, result);
  }
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
