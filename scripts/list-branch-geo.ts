import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const rows = await prisma.$queryRaw`
    SELECT b.code, b.name, b.city, b.lat, b.lng, c.code as cust, c.city as cust_city, c.address as cust_address
    FROM branches b JOIN customers c ON c.id=b."customerId"
    ORDER BY b.lat NULLS LAST`;
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
