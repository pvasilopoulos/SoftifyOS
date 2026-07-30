import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const tenant = await prisma.tenant.findUnique({ where: { slug: "akropolis" } });
  if (!tenant) throw new Error("Run npm run db:seed first");

  const till = await prisma.site.findFirst({
    where: { tenantId: tenant.id, code: "TILL-01" },
  });
  if (!till) throw new Error("Run npm run db:seed:series first (TILL-01)");

  await prisma.posTerminal.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "POS-T1" } },
    update: {
      name: "Τερματικό Ταμείου 1",
      provider: "MOCK",
      siteId: till.id,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      siteId: till.id,
      code: "POS-T1",
      name: "Τερματικό Ταμείου 1",
      provider: "MOCK",
    },
  });

  await prisma.loyaltyProgram.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Standard",
      earnPointsPerEur: 1,
      redeemPointsPerEur: 100,
      isActive: true,
    },
  });

  for (const demo of [
    { code: "GIFT-100", balance: 100, notes: "Demo δωροκάρτα 100€" },
    { code: "GIFT-25", balance: 25, notes: "Demo δωροκάρτα 25€" },
  ] as const) {
    const existing = await prisma.giftCard.findUnique({
      where: { tenantId_code: { tenantId: tenant.id, code: demo.code } },
    });
    if (existing) {
      await prisma.giftCard.update({
        where: { id: existing.id },
        data: {
          balance: demo.balance,
          initialBalance: demo.balance,
          status: "ACTIVE",
          notes: demo.notes,
        },
      });
    } else {
      await prisma.giftCard.create({
        data: {
          tenantId: tenant.id,
          code: demo.code,
          initialBalance: demo.balance,
          balance: demo.balance,
          notes: demo.notes,
          ledger: {
            create: {
              tenantId: tenant.id,
              kind: "ISSUE",
              amount: demo.balance,
              balanceAfter: demo.balance,
              note: "Seed issue",
            },
          },
        },
      });
    }
  }

  const customer = await prisma.customer.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
  });
  if (customer) {
    await prisma.loyaltyAccount.upsert({
      where: {
        tenantId_customerId: {
          tenantId: tenant.id,
          customerId: customer.id,
        },
      },
      update: { pointsBalance: 1500, isActive: true, tier: "GOLD" },
      create: {
        tenantId: tenant.id,
        customerId: customer.id,
        pointsBalance: 1500,
        tier: "GOLD",
        ledger: {
          create: {
            tenantId: tenant.id,
            kind: "ADJUST",
            points: 1500,
            note: "Seed opening balance",
          },
        },
      },
    });
  }

  // Walk-in retail customer
  await prisma.customer.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "RETAIL" } },
    update: { name: "Λιανική / Περαστικός", status: "ACTIVE" },
    create: {
      tenantId: tenant.id,
      code: "RETAIL",
      name: "Λιανική / Περαστικός",
      status: "ACTIVE",
    },
  });

  console.log("Seeded POS terminal, gift cards, loyalty, RETAIL customer");
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
