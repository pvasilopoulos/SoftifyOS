import "dotenv/config";
import { PrismaClient, MembershipRole } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

type TenantSeed = {
  slug: string;
  name: string;
  users: Array<{
    email: string;
    name: string;
    role: MembershipRole;
  }>;
};

const DEFAULT_PASSWORD = "SoftifyOS!2026";

const tenantSeeds: TenantSeed[] = [
  {
    slug: "akropolis",
    name: "Ακρόπολις ΑΕ",
    users: [
      { email: "maria@akropolis.gr", name: "Μαρία Καλογήρου", role: "OWNER" },
      { email: "ops@akropolis.gr", name: "Νίκος Ράπτης", role: "ADMIN" },
      { email: "sales@akropolis.gr", name: "Ελένη Γεωργίου", role: "MEMBER" },
    ],
  },
  {
    slug: "helios",
    name: "Helios Foods ΜΕΠΕ",
    users: [
      { email: "owner@helios.gr", name: "Γιάννης Ηλίου", role: "OWNER" },
      { email: "warehouse@helios.gr", name: "Πέτρος Λάμπρου", role: "MEMBER" },
    ],
  },
  {
    slug: "orama",
    name: "Orama Retail IKE",
    users: [
      { email: "owner@orama.gr", name: "Δήμητρα Όραμα", role: "OWNER" },
      { email: "finance@orama.gr", name: "Σοφία Παπανικολάου", role: "ADMIN" },
    ],
  },
  {
    slug: "atlas",
    name: "Atlas Logistics AE",
    users: [
      { email: "owner@atlas.gr", name: "Μιχάλης Άτλας", role: "OWNER" },
      { email: "viewer@atlas.gr", name: "Κώστας Θεοδώρου", role: "VIEWER" },
    ],
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  const createdCredentials: string[] = [];

  for (const tenantSeed of tenantSeeds) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: tenantSeed.slug },
      update: { name: tenantSeed.name },
      create: {
        slug: tenantSeed.slug,
        name: tenantSeed.name,
      },
    });

    for (const userSeed of tenantSeed.users) {
      const user = await prisma.user.upsert({
        where: { email: userSeed.email },
        update: {
          name: userSeed.name,
          passwordHash,
        },
        create: {
          email: userSeed.email,
          name: userSeed.name,
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
        update: { role: userSeed.role },
        create: {
          tenantId: tenant.id,
          userId: user.id,
          role: userSeed.role,
        },
      });

      createdCredentials.push(
        `${userSeed.email} / ${DEFAULT_PASSWORD} (${tenantSeed.slug}, ${userSeed.role})`,
      );
    }

    const owner = tenantSeed.users.find((x) => x.role === "OWNER") ?? tenantSeed.users[0];
    const ownerUser = await prisma.user.findUnique({ where: { email: owner.email } });
    if (ownerUser) {
      await prisma.auditEvent.create({
        data: {
          tenantId: tenant.id,
          userId: ownerUser.id,
          action: "seed.bootstrap",
          entity: "tenant",
          entityId: tenant.id,
          meta: { source: "prisma/seed.ts", tenantSlug: tenant.slug },
        },
      });
    }
  }

  console.log("Seeded SoftifyOS multi-tenant access");
  console.log("Tenants:");
  for (const tenant of tenantSeeds) {
    console.log(`  - ${tenant.slug}: ${tenant.name}`);
  }
  console.log("Users:");
  for (const line of createdCredentials) {
    console.log(`  - ${line}`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
