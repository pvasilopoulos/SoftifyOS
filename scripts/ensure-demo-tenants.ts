import "dotenv/config";
import { PrismaClient, MembershipRole } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const user = await prisma.user.findFirst({
    where: { email: "maria@akropolis.gr" },
  });
  if (!user) throw new Error("Demo user not found — run npm run db:seed first");

  for (const row of [
    { slug: "akropolis", name: "Ακρόπολις ΑΕ" },
    { slug: "softify-group", name: "SOFTIFY GROUP" },
  ]) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: row.slug },
      update: { name: row.name },
      create: { slug: row.slug, name: row.name },
    });
    await prisma.membership.upsert({
      where: {
        tenantId_userId: { tenantId: tenant.id, userId: user.id },
      },
      update: { role: MembershipRole.OWNER },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: MembershipRole.OWNER,
      },
    });
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { tenant: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(
    "Demo memberships:",
    memberships.map((m) => `${m.tenant.name} (${m.tenant.slug}) · ${m.role}`),
  );

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
