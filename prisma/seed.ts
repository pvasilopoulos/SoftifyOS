import "dotenv/config";
import { PrismaClient, MembershipRole } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const passwordHash = await bcrypt.hash("SoftifyOS!2026", 12);

  const tenant = await prisma.tenant.upsert({
    where: { slug: "akropolis" },
    update: { name: "Ακρόπολις ΑΕ" },
    create: {
      slug: "akropolis",
      name: "Ακρόπολις ΑΕ",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "maria@akropolis.gr" },
    update: {
      name: "Μαρία Καλογήρου",
      passwordHash,
    },
    create: {
      email: "maria@akropolis.gr",
      name: "Μαρία Καλογήρου",
      passwordHash,
    },
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id,
      },
    },
    update: { role: MembershipRole.OWNER },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: MembershipRole.OWNER,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      action: "seed.bootstrap",
      entity: "tenant",
      entityId: tenant.id,
      meta: { source: "prisma/seed.ts" },
    },
  });

  console.log("Seeded SoftifyOS Phase 0");
  console.log("  tenant:", tenant.slug);
  console.log("  user:  maria@akropolis.gr / SoftifyOS!2026");

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
