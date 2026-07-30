import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_PAYMENT_METHODS } from "./labels";
import type { PaymentMethodUpsertInput } from "./schemas";

type Db = PrismaClient | Prisma.TransactionClient;

export class PaymentMethodError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function ensurePaymentMethods(db: Db, tenantId: string) {
  for (const row of DEFAULT_PAYMENT_METHODS) {
    await db.paymentMethod.upsert({
      where: { tenantId_code: { tenantId, code: row.code } },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        kind: row.kind,
        description: row.description,
        glAccount: row.glAccount,
        glContraAccount: row.glContraAccount,
        glClearingAccount: row.glClearingAccount,
        sortOrder: row.sortOrder,
        showInPos: row.showInPos,
        showInCollect: row.showInCollect,
        requiresExternalRef: row.requiresExternalRef,
        allowsChange: row.allowsChange,
        affectsCashDrawer: row.affectsCashDrawer,
        isSystem: true,
        isActive: true,
      },
      update: {},
    });
  }
}

export async function listPaymentMethods(
  db: Db,
  tenantId: string,
  opts?: { activeOnly?: boolean; posOnly?: boolean; collectOnly?: boolean },
) {
  await ensurePaymentMethods(db, tenantId);
  return db.paymentMethod.findMany({
    where: {
      tenantId,
      ...(opts?.activeOnly ? { isActive: true } : {}),
      ...(opts?.posOnly ? { showInPos: true, isActive: true } : {}),
      ...(opts?.collectOnly ? { showInCollect: true, isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function createPaymentMethod(
  db: Db,
  input: { tenantId: string; data: PaymentMethodUpsertInput },
) {
  const existing = await db.paymentMethod.findUnique({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.data.code },
    },
  });
  if (existing) {
    throw new PaymentMethodError(`Υπάρχει ήδη τρόπος με κωδικό ${input.data.code}`, 409);
  }

  return db.paymentMethod.create({
    data: {
      tenantId: input.tenantId,
      code: input.data.code,
      name: input.data.name,
      kind: input.data.kind,
      description: emptyToNull(input.data.description),
      glAccount: emptyToNull(input.data.glAccount),
      glContraAccount: emptyToNull(input.data.glContraAccount),
      glClearingAccount: emptyToNull(input.data.glClearingAccount),
      costCenter: emptyToNull(input.data.costCenter),
      accountingCode: emptyToNull(input.data.accountingCode),
      bankIban: emptyToNull(input.data.bankIban),
      bankName: emptyToNull(input.data.bankName),
      myDataPaymentType: emptyToNull(input.data.myDataPaymentType),
      sortOrder: input.data.sortOrder ?? 100,
      isActive: input.data.isActive ?? true,
      showInPos: input.data.showInPos ?? true,
      showInCollect: input.data.showInCollect ?? true,
      requiresExternalRef: input.data.requiresExternalRef ?? false,
      allowsChange: input.data.allowsChange ?? false,
      affectsCashDrawer: input.data.affectsCashDrawer ?? false,
      isSystem: false,
    },
  });
}

export async function updatePaymentMethod(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    data: Partial<PaymentMethodUpsertInput>;
  },
) {
  const row = await db.paymentMethod.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new PaymentMethodError("Ο τρόπος πληρωμής δεν βρέθηκε", 404);

  if (input.data.code && input.data.code !== row.code) {
    if (row.isSystem) {
      throw new PaymentMethodError("Οι system κωδικοί δεν αλλάζουν");
    }
    const clash = await db.paymentMethod.findUnique({
      where: {
        tenantId_code: { tenantId: input.tenantId, code: input.data.code },
      },
    });
    if (clash) {
      throw new PaymentMethodError(`Υπάρχει ήδη κωδικός ${input.data.code}`, 409);
    }
  }

  if (input.data.kind && input.data.kind !== row.kind && row.isSystem) {
    throw new PaymentMethodError("Το kind των system τρόπων δεν αλλάζει");
  }

  return db.paymentMethod.update({
    where: { id: row.id },
    data: {
      ...(input.data.code ? { code: input.data.code } : {}),
      ...(input.data.name ? { name: input.data.name } : {}),
      ...(input.data.kind ? { kind: input.data.kind } : {}),
      ...(input.data.description !== undefined
        ? { description: emptyToNull(input.data.description) }
        : {}),
      ...(input.data.glAccount !== undefined
        ? { glAccount: emptyToNull(input.data.glAccount) }
        : {}),
      ...(input.data.glContraAccount !== undefined
        ? { glContraAccount: emptyToNull(input.data.glContraAccount) }
        : {}),
      ...(input.data.glClearingAccount !== undefined
        ? { glClearingAccount: emptyToNull(input.data.glClearingAccount) }
        : {}),
      ...(input.data.costCenter !== undefined
        ? { costCenter: emptyToNull(input.data.costCenter) }
        : {}),
      ...(input.data.accountingCode !== undefined
        ? { accountingCode: emptyToNull(input.data.accountingCode) }
        : {}),
      ...(input.data.bankIban !== undefined
        ? { bankIban: emptyToNull(input.data.bankIban) }
        : {}),
      ...(input.data.bankName !== undefined
        ? { bankName: emptyToNull(input.data.bankName) }
        : {}),
      ...(input.data.myDataPaymentType !== undefined
        ? { myDataPaymentType: emptyToNull(input.data.myDataPaymentType) }
        : {}),
      ...(input.data.sortOrder !== undefined
        ? { sortOrder: input.data.sortOrder }
        : {}),
      ...(input.data.isActive !== undefined ? { isActive: input.data.isActive } : {}),
      ...(input.data.showInPos !== undefined
        ? { showInPos: input.data.showInPos }
        : {}),
      ...(input.data.showInCollect !== undefined
        ? { showInCollect: input.data.showInCollect }
        : {}),
      ...(input.data.requiresExternalRef !== undefined
        ? { requiresExternalRef: input.data.requiresExternalRef }
        : {}),
      ...(input.data.allowsChange !== undefined
        ? { allowsChange: input.data.allowsChange }
        : {}),
      ...(input.data.affectsCashDrawer !== undefined
        ? { affectsCashDrawer: input.data.affectsCashDrawer }
        : {}),
    },
  });
}

export async function deletePaymentMethod(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const row = await db.paymentMethod.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new PaymentMethodError("Ο τρόπος πληρωμής δεν βρέθηκε", 404);
  if (row.isSystem) {
    throw new PaymentMethodError("Οι system τρόποι δεν διαγράφονται — απενεργοποιήστε τους");
  }

  const used = await db.invoicePayment.count({
    where: { paymentMethodId: row.id },
  });
  if (used > 0) {
    throw new PaymentMethodError(
      "Υπάρχουν πληρωμές με αυτόν τον τρόπο — απενεργοποιήστε τον",
    );
  }

  await db.paymentMethod.delete({ where: { id: row.id } });
  return { ok: true };
}

export type PaymentMethodRow = Prisma.PaymentMethodGetPayload<object>;
