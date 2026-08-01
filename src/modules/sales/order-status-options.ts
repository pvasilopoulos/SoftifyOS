import type { OrderStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  ORDER_WORKFLOWS,
  orderStatusLabel,
  orderStatusTone,
  type OrderStatusKey,
} from "./order-utils";

export { ORDER_WORKFLOWS };

type Db = PrismaClient | Prisma.TransactionClient;

export class OrderStatusOptionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const SYSTEM_SEED: Array<{
  code: OrderStatusKey;
  name: string;
  workflow: OrderStatusKey;
  sortOrder: number;
  selectableOnCreate: boolean;
  tone: string;
}> = [
  {
    code: "DRAFT",
    name: orderStatusLabel.DRAFT,
    workflow: "DRAFT",
    sortOrder: 10,
    selectableOnCreate: true,
    tone: orderStatusTone.DRAFT,
  },
  {
    code: "CONFIRMED",
    name: orderStatusLabel.CONFIRMED,
    workflow: "CONFIRMED",
    sortOrder: 20,
    selectableOnCreate: true,
    tone: orderStatusTone.CONFIRMED,
  },
  {
    code: "PARTIAL_INVOICED",
    name: orderStatusLabel.PARTIAL_INVOICED,
    workflow: "PARTIAL_INVOICED",
    sortOrder: 30,
    selectableOnCreate: false,
    tone: orderStatusTone.PARTIAL_INVOICED,
  },
  {
    code: "INVOICED",
    name: orderStatusLabel.INVOICED,
    workflow: "INVOICED",
    sortOrder: 40,
    selectableOnCreate: false,
    tone: orderStatusTone.INVOICED,
  },
  {
    code: "CANCELLED",
    name: orderStatusLabel.CANCELLED,
    workflow: "CANCELLED",
    sortOrder: 50,
    selectableOnCreate: false,
    tone: orderStatusTone.CANCELLED,
  },
];

export type OrderStatusOptionInput = {
  code: string;
  name: string;
  workflow: OrderStatusKey;
  sortOrder?: number;
  isActive?: boolean;
  selectableOnCreate?: boolean;
  tone?: string;
};

export async function ensureOrderStatusOptions(db: Db, tenantId: string) {
  for (const row of SYSTEM_SEED) {
    await db.orderStatusOption.upsert({
      where: { tenantId_code: { tenantId, code: row.code } },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        workflow: row.workflow,
        sortOrder: row.sortOrder,
        selectableOnCreate: row.selectableOnCreate,
        tone: row.tone,
        isSystem: true,
        isActive: true,
      },
      update: {},
    });
  }
}

export async function listOrderStatusOptions(
  db: Db,
  tenantId: string,
  opts?: { activeOnly?: boolean; selectableOnCreate?: boolean },
) {
  await ensureOrderStatusOptions(db, tenantId);
  return db.orderStatusOption.findMany({
    where: {
      tenantId,
      ...(opts?.activeOnly ? { isActive: true } : {}),
      ...(opts?.selectableOnCreate
        ? { selectableOnCreate: true, isActive: true }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function resolveOrderStatusOption(
  db: Db,
  tenantId: string,
  input: { statusOptionId?: string | null; statusCode?: string | null },
) {
  await ensureOrderStatusOptions(db, tenantId);

  if (input.statusOptionId) {
    const byId = await db.orderStatusOption.findFirst({
      where: {
        id: input.statusOptionId,
        tenantId,
        isActive: true,
      },
    });
    if (!byId) {
      throw new OrderStatusOptionError("Η κατάσταση δεν βρέθηκε", 404);
    }
    return byId;
  }

  const code = (input.statusCode || "DRAFT").trim().toUpperCase();
  const byCode = await db.orderStatusOption.findFirst({
    where: { tenantId, code, isActive: true },
  });
  if (byCode) return byCode;

  if (code === "DRAFT" || code === "CONFIRMED") {
    const fallback = await db.orderStatusOption.findFirst({
      where: { tenantId, code, isSystem: true },
    });
    if (fallback) return fallback;
  }

  throw new OrderStatusOptionError(`Άγνωστη κατάσταση: ${code}`, 400);
}

export async function createOrderStatusOption(
  db: Db,
  input: { tenantId: string; data: OrderStatusOptionInput },
) {
  const code = input.data.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) {
    throw new OrderStatusOptionError(
      "Ο κωδικός πρέπει να είναι λατινικά κεφαλαία / _ (2–40)",
    );
  }
  if (!ORDER_WORKFLOWS.includes(input.data.workflow)) {
    throw new OrderStatusOptionError("Μη έγκυρο workflow");
  }

  const existing = await db.orderStatusOption.findUnique({
    where: { tenantId_code: { tenantId: input.tenantId, code } },
  });
  if (existing) {
    throw new OrderStatusOptionError(`Υπάρχει ήδη κατάσταση με κωδικό ${code}`, 409);
  }

  return db.orderStatusOption.create({
    data: {
      tenantId: input.tenantId,
      code,
      name: input.data.name.trim(),
      workflow: input.data.workflow as OrderStatus,
      sortOrder: input.data.sortOrder ?? 100,
      isActive: input.data.isActive ?? true,
      selectableOnCreate: input.data.selectableOnCreate ?? true,
      tone: input.data.tone?.trim() || "slate",
      isSystem: false,
    },
  });
}

export async function updateOrderStatusOption(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    data: Partial<OrderStatusOptionInput> & { isActive?: boolean };
  },
) {
  const existing = await db.orderStatusOption.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) {
    throw new OrderStatusOptionError("Η κατάσταση δεν βρέθηκε", 404);
  }

  if (
    input.data.workflow &&
    !ORDER_WORKFLOWS.includes(input.data.workflow)
  ) {
    throw new OrderStatusOptionError("Μη έγκυρο workflow");
  }

  if (existing.isSystem) {
    // System: allow rename/tone/sort/active/selectable; lock code + workflow
    return db.orderStatusOption.update({
      where: { id: existing.id },
      data: {
        name: input.data.name?.trim() || existing.name,
        sortOrder: input.data.sortOrder ?? existing.sortOrder,
        isActive: input.data.isActive ?? existing.isActive,
        selectableOnCreate:
          input.data.selectableOnCreate ?? existing.selectableOnCreate,
        tone: input.data.tone?.trim() || existing.tone,
      },
    });
  }

  let code = existing.code;
  if (input.data.code != null) {
    code = input.data.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) {
      throw new OrderStatusOptionError(
        "Ο κωδικός πρέπει να είναι λατινικά κεφαλαία / _ (2–40)",
      );
    }
    if (code !== existing.code) {
      const clash = await db.orderStatusOption.findUnique({
        where: { tenantId_code: { tenantId: input.tenantId, code } },
      });
      if (clash) {
        throw new OrderStatusOptionError(`Υπάρχει ήδη κατάσταση με κωδικό ${code}`, 409);
      }
    }
  }

  return db.orderStatusOption.update({
    where: { id: existing.id },
    data: {
      code,
      name: input.data.name?.trim() || existing.name,
      workflow: (input.data.workflow as OrderStatus | undefined) ?? existing.workflow,
      sortOrder: input.data.sortOrder ?? existing.sortOrder,
      isActive: input.data.isActive ?? existing.isActive,
      selectableOnCreate:
        input.data.selectableOnCreate ?? existing.selectableOnCreate,
      tone: input.data.tone?.trim() || existing.tone,
    },
  });
}

export async function deleteOrderStatusOption(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const existing = await db.orderStatusOption.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) {
    throw new OrderStatusOptionError("Η κατάσταση δεν βρέθηκε", 404);
  }
  if (existing.isSystem) {
    throw new OrderStatusOptionError("Οι συστημικές καταστάσεις δεν διαγράφονται");
  }
  const inUse = await db.order.count({
    where: { tenantId: input.tenantId, statusOptionId: existing.id },
  });
  if (inUse > 0) {
    throw new OrderStatusOptionError(
      `Χρησιμοποιείται σε ${inUse} παραγγελίες — απενεργοποίησέ την`,
    );
  }
  await db.orderStatusOption.delete({ where: { id: existing.id } });
}

export function displayOrderStatus(
  status: string,
  option?: { name: string; tone: string } | null,
) {
  const key = status as OrderStatusKey;
  return {
    label: option?.name || orderStatusLabel[key] || status,
    tone: option?.tone || orderStatusTone[key] || "slate",
  };
}
