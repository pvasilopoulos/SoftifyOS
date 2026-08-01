import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { LedgerError } from "@/modules/ledger/service";

type Db = PrismaClient | Prisma.TransactionClient;

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function listUserTenants(db: Db, userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: {
      tenant: {
        select: {
          id: true,
          slug: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              customers: true,
              sites: true,
              legalEntities: true,
              invoices: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.tenant.id,
    slug: m.tenant.slug,
    name: m.tenant.name,
    role: m.role,
    createdAt: m.tenant.createdAt.toISOString(),
    updatedAt: m.tenant.updatedAt.toISOString(),
    counts: m.tenant._count,
  }));
}

export async function createTenantForUser(
  db: PrismaClient,
  input: {
    userId: string;
    name: string;
    slug?: string | null;
  },
) {
  const name = input.name.trim();
  if (!name) throw new LedgerError("Απαιτείται επωνυμία tenant", 400);

  let slug = (input.slug?.trim() || slugify(name) || `org-${Date.now()}`).slice(
    0,
    40,
  );
  const existing = await db.tenant.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now().toString(36)}`.slice(0, 40);
  }

  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name, slug },
    });
    await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: input.userId,
        role: "OWNER",
      },
    });
    await tx.tenantSettings.create({
      data: {
        tenantId: tenant.id,
        legalName: name,
      },
    });
    await tx.legalEntity.create({
      data: {
        tenantId: tenant.id,
        code: "MAIN",
        name,
        isDefault: true,
        isActive: true,
      },
    });
    const branch = await tx.site.create({
      data: {
        tenantId: tenant.id,
        code: "HQ",
        name: "Έδρα",
        kind: "BRANCH",
        isActive: true,
      },
    });
    await tx.site.create({
      data: {
        tenantId: tenant.id,
        code: "MAIN",
        name: "Κεντρική αποθήκη",
        kind: "WAREHOUSE",
        parentId: branch.id,
        isActive: true,
      },
    });
    return tenant;
  });
}

export async function updateTenant(
  db: Db,
  input: {
    tenantId: string;
    name?: string;
    slug?: string;
  },
) {
  const data: Prisma.TenantUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.slug !== undefined) {
    const slug = slugify(input.slug);
    if (!slug) throw new LedgerError("Μη έγκυρο slug", 400);
    data.slug = slug;
  }
  try {
    return await db.tenant.update({
      where: { id: input.tenantId },
      data,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      throw new LedgerError("Το slug χρησιμοποιείται ήδη", 409);
    }
    throw error;
  }
}

export async function deleteTenantIfEmpty(
  db: Db,
  input: { tenantId: string; userId: string },
) {
  const membership = await db.membership.findUnique({
    where: {
      tenantId_userId: {
        tenantId: input.tenantId,
        userId: input.userId,
      },
    },
  });
  if (!membership || membership.role !== "OWNER") {
    throw new LedgerError("Μόνο OWNER μπορεί να διαγράψει tenant", 403);
  }

  const [customers, invoices, products, otherOwners] = await Promise.all([
    db.customer.count({ where: { tenantId: input.tenantId } }),
    db.invoice.count({ where: { tenantId: input.tenantId } }),
    db.product.count({ where: { tenantId: input.tenantId } }),
    db.membership.count({
      where: {
        userId: input.userId,
        role: "OWNER",
        tenantId: { not: input.tenantId },
      },
    }),
  ]);

  if (customers + invoices + products > 0) {
    throw new LedgerError(
      "Ο tenant έχει δεδομένα (πελάτες/τιμολόγια/προϊόντα) — δεν διαγράφεται",
      409,
    );
  }
  if (otherOwners < 1) {
    // Allow delete of empty extra tenants; block deleting the only tenant
    const totalMemberships = await db.membership.count({
      where: { userId: input.userId },
    });
    if (totalMemberships <= 1) {
      throw new LedgerError(
        "Δεν μπορείς να διαγράψεις τον μοναδικό σου οργανισμό",
        409,
      );
    }
  }

  await db.tenant.delete({ where: { id: input.tenantId } });
}

export async function updateLegalEntity(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    code?: string;
    name?: string;
    vatNumber?: string | null;
    isDefault?: boolean;
    isActive?: boolean;
  },
) {
  const existing = await db.legalEntity.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) throw new LedgerError("Η εταιρεία δεν βρέθηκε", 404);

  if (input.isDefault) {
    await db.legalEntity.updateMany({
      where: { tenantId: input.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  return db.legalEntity.update({
    where: { id: existing.id },
    data: {
      ...(input.code !== undefined ? { code: input.code.trim() } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.vatNumber !== undefined
        ? { vatNumber: input.vatNumber || null }
        : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function deleteLegalEntity(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const existing = await db.legalEntity.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) throw new LedgerError("Η εταιρεία δεν βρέθηκε", 404);
  if (existing.isDefault) {
    throw new LedgerError("Η προεπιλεγμένη εταιρεία δεν διαγράφεται", 409);
  }

  const [journalLines, assets, purchases] = await Promise.all([
    db.journalLine.count({ where: { legalEntityId: existing.id } }),
    db.fixedAsset.count({ where: { legalEntityId: existing.id } }),
    db.purchaseInvoice.count({ where: { legalEntityId: existing.id } }),
  ]);
  if (journalLines + assets + purchases > 0) {
    return db.legalEntity.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
  }
  await db.legalEntity.delete({ where: { id: existing.id } });
  return { id: existing.id, deleted: true };
}

export async function updateSite(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    code?: string;
    name?: string;
    kind?: "BRANCH" | "WAREHOUSE" | "TILL";
    parentId?: string | null;
    isActive?: boolean;
  },
) {
  const existing = await db.site.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) throw new LedgerError("Το site δεν βρέθηκε", 404);

  if (input.parentId) {
    if (input.parentId === existing.id) {
      throw new LedgerError("Το parent δεν μπορεί να είναι το ίδιο site", 400);
    }
    const parent = await db.site.findFirst({
      where: { id: input.parentId, tenantId: input.tenantId },
    });
    if (!parent) throw new LedgerError("Μη έγκυρο parent site", 400);
  }

  return db.site.update({
    where: { id: existing.id },
    data: {
      ...(input.code !== undefined ? { code: input.code.trim() } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.parentId !== undefined
        ? { parentId: input.parentId || null }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: { parent: { select: { id: true, code: true, name: true } } },
  });
}

export async function deleteSite(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const existing = await db.site.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) throw new LedgerError("Το site δεν βρέθηκε", 404);

  const [balances, children, series] = await Promise.all([
    db.stockBalance.count({
      where: { siteId: existing.id, qtyOnHand: { not: 0 } },
    }),
    db.site.count({ where: { parentId: existing.id } }),
    db.documentSeries.count({ where: { siteId: existing.id } }),
  ]);

  if (balances > 0) {
    throw new LedgerError(
      "Η αποθήκη έχει υπόλοιπα — απενεργοποίησέ την αντί για διαγραφή",
      409,
    );
  }
  if (children > 0) {
    throw new LedgerError("Υπάρχουν child sites — μετακίνησέ τα πρώτα", 409);
  }

  if (series > 0) {
    return db.site.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
  }

  await db.site.delete({ where: { id: existing.id } });
  return { id: existing.id, deleted: true };
}
