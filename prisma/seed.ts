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

  const membership = await prisma.membership.upsert({
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

  const systemRoles: Array<{
    code: string;
    name: string;
    description: string;
    permissions: string[];
  }> = [
    {
      code: "OWNER",
      name: "Ιδιοκτήτης",
      description: "Πλήρης πρόσβαση στο tenant",
      permissions: ["*"],
    },
    {
      code: "ADMIN",
      name: "Διαχειριστής",
      description: "Διαχείριση ρυθμίσεων, χρηστών και δεδομένων",
      permissions: ["*"],
    },
    {
      code: "MEMBER",
      name: "Μέλος",
      description: "Καθημερινή εργασία σε πωλήσεις και λειτουργίες",
      permissions: [
        "dashboard.view",
        "customers.read",
        "customers.write",
        "quotes.read",
        "quotes.write",
        "orders.read",
        "orders.write",
        "invoices.read",
        "invoices.write",
        "pos.use",
        "products.read",
        "inventory.read",
        "purchasing.read",
        "finance.read",
        "reports.read",
      ],
    },
    {
      code: "VIEWER",
      name: "Αναγνώστης",
      description: "Μόνο ανάγνωση",
      permissions: [
        "dashboard.view",
        "customers.read",
        "quotes.read",
        "orders.read",
        "invoices.read",
        "products.read",
        "inventory.read",
        "purchasing.read",
        "finance.read",
        "reports.read",
      ],
    },
  ];

  for (const role of systemRoles) {
    const appRole = await prisma.appRole.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: role.code } },
      create: {
        tenantId: tenant.id,
        code: role.code,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isSystem: true,
      },
      update: {
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isSystem: true,
      },
    });
    if (role.code === "OWNER") {
      await prisma.membership.update({
        where: { id: membership.id },
        data: { appRoleId: appRole.id },
      });
    }
  }

  // Second demo company so tenant switcher has something to switch to
  const tenantB = await prisma.tenant.upsert({
    where: { slug: "softify-group" },
    update: { name: "SOFTIFY GROUP" },
    create: {
      slug: "softify-group",
      name: "SOFTIFY GROUP",
    },
  });
  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenantB.id,
        userId: user.id,
      },
    },
    update: { role: MembershipRole.OWNER },
    create: {
      tenantId: tenantB.id,
      userId: user.id,
      role: MembershipRole.OWNER,
    },
  });
  for (const role of systemRoles) {
    await prisma.appRole.upsert({
      where: { tenantId_code: { tenantId: tenantB.id, code: role.code } },
      create: {
        tenantId: tenantB.id,
        code: role.code,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isSystem: true,
      },
      update: {
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isSystem: true,
      },
    });
  }

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
  console.log("  tenants:", tenant.slug, "+", tenantB.slug);
  console.log("  user:  maria@akropolis.gr / SoftifyOS!2026");
  console.log("  roles: OWNER/ADMIN/MEMBER/VIEWER");

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
