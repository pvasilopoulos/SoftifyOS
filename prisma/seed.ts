import "dotenv/config";
import { PrismaClient, MembershipRole } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { importBundledCatalogs } from "../src/modules/catalogs/import";

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

const superAdminUser = {
  email: "superadmin@softifyos.gr",
  name: "SoftifyOS Super Admin",
  role: "SUPER_ADMIN" as MembershipRole,
};

const systemRoles: Array<{
  code: string;
  name: string;
  description: string;
  permissions: string[];
}> = [
  { code: "OWNER", name: "Ιδιοκτήτης", description: "Πλήρης πρόσβαση στο tenant", permissions: ["*"] },
  { code: "ADMIN", name: "Διαχειριστής", description: "Διαχείριση ρυθμίσεων, χρηστών και δεδομένων", permissions: ["*"] },
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
  {
    code: "SUPER_ADMIN",
    name: "Super Admin",
    description: "Global full access across tenants",
    permissions: ["*"],
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  const createdCredentials: string[] = [];
  const tenantRecords: Array<{ id: string; slug: string }> = [];

  for (const tenantSeed of tenantSeeds) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: tenantSeed.slug },
      update: { name: tenantSeed.name },
      create: { slug: tenantSeed.slug, name: tenantSeed.name },
    });
    tenantRecords.push({ id: tenant.id, slug: tenant.slug });

    const roleMap = new Map<string, string>();
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
      roleMap.set(role.code, appRole.id);
    }

    for (const userSeed of tenantSeed.users) {
      const user = await prisma.user.upsert({
        where: { email: userSeed.email },
        update: { name: userSeed.name, passwordHash },
        create: { email: userSeed.email, name: userSeed.name, passwordHash },
      });
      const membership = await prisma.membership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        update: { role: userSeed.role },
        create: { tenantId: tenant.id, userId: user.id, role: userSeed.role },
      });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { appRoleId: roleMap.get(userSeed.role) ?? roleMap.get("MEMBER") ?? null },
      });
      createdCredentials.push(
        `${userSeed.email} / ${DEFAULT_PASSWORD} (${tenantSeed.slug}, ${userSeed.role})`,
      );
    }
  }

  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminUser.email },
    update: { name: superAdminUser.name, passwordHash },
    create: { email: superAdminUser.email, name: superAdminUser.name, passwordHash },
  });
  for (const tenant of tenantRecords) {
    const superAdminRole = await prisma.appRole.findFirst({
      where: { tenantId: tenant.id, code: "SUPER_ADMIN" },
      select: { id: true },
    });
    const membership = await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: superAdmin.id } },
      update: { role: superAdminUser.role },
      create: { tenantId: tenant.id, userId: superAdmin.id, role: superAdminUser.role },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: { appRoleId: superAdminRole?.id ?? null },
    });
    await prisma.auditEvent.create({
      data: {
        tenantId: tenant.id,
        userId: superAdmin.id,
        action: "seed.bootstrap",
        entity: "tenant",
        entityId: tenant.id,
        meta: { source: "prisma/seed.ts", tenantSlug: tenant.slug, by: "super-admin" },
      },
    });
  }
  createdCredentials.push(
    `${superAdminUser.email} / ${DEFAULT_PASSWORD} (all tenants, SUPER_ADMIN)`,
  );

  console.log("Importing bundled catalogs (payments / units / roles)...");
  for (const tenant of tenantRecords) {
    const summary = await importBundledCatalogs(prisma, tenant.id);
    console.log(
      `  ${tenant.slug}: payments +${summary["payment-methods"].created}/${summary["payment-methods"].updated}, units +${summary.units.created}/${summary.units.updated}, roles +${summary.roles.created}/${summary.roles.updated}`,
    );
  }

  console.log("Seeded SoftifyOS multi-tenant settings data");
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
