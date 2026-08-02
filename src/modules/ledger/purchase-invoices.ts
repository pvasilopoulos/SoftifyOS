import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  findAccountByCode,
  LedgerError,
  round2,
  tryPostPurchaseInvoice,
} from "./service";

type Db = PrismaClient | Prisma.TransactionClient;

export async function listPurchaseInvoices(
  db: Db,
  tenantId: string,
  opts?: { legalEntityId?: string | null },
) {
  return db.purchaseInvoice.findMany({
    where: {
      tenantId,
      ...(opts?.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
    },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      legalEntity: { select: { code: true, name: true } },
      lines: { orderBy: { lineNo: "asc" } },
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
}

export async function createPurchaseInvoice(
  db: Db,
  input: {
    tenantId: string;
    number: string;
    supplierId: string;
    issueDate?: Date;
    dueDate?: Date | null;
    notes?: string | null;
    legalEntityId?: string | null;
    post?: boolean;
    userId?: string | null;
    lines: Array<{
      description: string;
      qty: number;
      unitPrice: number;
      vatRate?: number;
      glAccountId?: string | null;
      costCenterId?: string | null;
    }>;
  },
) {
  const supplier = await db.supplier.findFirst({
    where: { id: input.supplierId, tenantId: input.tenantId },
  });
  if (!supplier) throw new LedgerError("Προμηθευτής δεν βρέθηκε", 404);

  const defaultExpense = await findAccountByCode(
    db,
    input.tenantId,
    "64.00.00",
  );

  const computed = input.lines.map((l, i) => {
    const net = round2(l.qty * l.unitPrice);
    const vatRate = l.vatRate ?? 24;
    const vat = round2(net * (vatRate / 100));
    return {
      tenantId: input.tenantId,
      lineNo: i + 1,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      vatRate,
      netAmount: net,
      vatAmount: vat,
      glAccountId: l.glAccountId ?? defaultExpense?.id ?? null,
      costCenterId: l.costCenterId ?? null,
    };
  });

  const netAmount = round2(computed.reduce((s, l) => s + l.netAmount, 0));
  const vatAmount = round2(computed.reduce((s, l) => s + l.vatAmount, 0));
  const total = round2(netAmount + vatAmount);

  const invoice = await db.purchaseInvoice.create({
    data: {
      tenantId: input.tenantId,
      number: input.number,
      supplierId: input.supplierId,
      status: "DRAFT",
      issueDate: input.issueDate ?? new Date(),
      dueDate: input.dueDate ?? null,
      netAmount,
      vatAmount,
      total,
      notes: input.notes ?? null,
      legalEntityId: input.legalEntityId ?? null,
      lines: { create: computed },
    },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      lines: true,
    },
  });

  if (input.post === false) return { invoice, journalId: null };

  const journal = await tryPostPurchaseInvoice(db, {
    tenantId: input.tenantId,
    purchaseInvoiceId: invoice.id,
    number: invoice.number,
    netAmount,
    vatAmount,
    total,
    userId: input.userId,
    legalEntityId: input.legalEntityId,
    costCenterId: computed[0]?.costCenterId,
  });

  const updated = await db.purchaseInvoice.update({
    where: { id: invoice.id },
    data: {
      status: "POSTED",
      journalEntryId: journal?.id ?? null,
    },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      lines: true,
    },
  });

  try {
    const { enqueueMyDataSubmission } = await import("@/modules/mydata/service");
    await enqueueMyDataSubmission(db, {
      tenantId: input.tenantId,
      entityType: "purchase_invoice",
      entityId: updated.id,
      entityNumber: updated.number,
      invoiceType: "1.1",
      vatCategory: "1",
    });
  } catch {
    // myDATA enqueue is best-effort on purchase post
  }

  return { invoice: updated, journalId: journal?.id ?? null };
}
