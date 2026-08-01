import type { InvoiceStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  INVOICE_CREATE_WORKFLOWS,
  INVOICE_WORKFLOWS,
  invoiceStatusLabel,
  invoiceStatusTone,
  type InvoiceStatusKey,
} from "./invoice-utils";

type Db = PrismaClient | Prisma.TransactionClient;

export class InvoiceStatusOptionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const SYSTEM_SEED: Array<{
  code: string;
  name: string;
  workflow: InvoiceStatusKey;
  sortOrder: number;
  selectableOnCreate: boolean;
  tone: string;
}> = [
  {
    code: "DRAFT",
    name: "Πρόχειρο",
    workflow: "DRAFT",
    sortOrder: 10,
    selectableOnCreate: true,
    tone: invoiceStatusTone.DRAFT,
  },
  {
    code: "ISSUE_NOW",
    name: "Έκδοση τώρα",
    workflow: "ISSUED",
    sortOrder: 20,
    selectableOnCreate: true,
    tone: invoiceStatusTone.ISSUED,
  },
  {
    code: "ISSUED",
    name: invoiceStatusLabel.ISSUED,
    workflow: "ISSUED",
    sortOrder: 30,
    selectableOnCreate: false,
    tone: invoiceStatusTone.ISSUED,
  },
  {
    code: "PARTIAL",
    name: invoiceStatusLabel.PARTIAL,
    workflow: "PARTIAL",
    sortOrder: 40,
    selectableOnCreate: false,
    tone: invoiceStatusTone.PARTIAL,
  },
  {
    code: "PAID",
    name: invoiceStatusLabel.PAID,
    workflow: "PAID",
    sortOrder: 50,
    selectableOnCreate: false,
    tone: invoiceStatusTone.PAID,
  },
  {
    code: "OVERDUE",
    name: invoiceStatusLabel.OVERDUE,
    workflow: "OVERDUE",
    sortOrder: 60,
    selectableOnCreate: false,
    tone: invoiceStatusTone.OVERDUE,
  },
  {
    code: "CANCELLED",
    name: invoiceStatusLabel.CANCELLED,
    workflow: "CANCELLED",
    sortOrder: 70,
    selectableOnCreate: false,
    tone: invoiceStatusTone.CANCELLED,
  },
];

export type InvoiceStatusOptionInput = {
  code: string;
  name: string;
  workflow: InvoiceStatusKey;
  sortOrder?: number;
  isActive?: boolean;
  selectableOnCreate?: boolean;
  tone?: string;
};

export async function ensureInvoiceStatusOptions(db: Db, tenantId: string) {
  for (const row of SYSTEM_SEED) {
    await db.invoiceStatusOption.upsert({
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

export async function listInvoiceStatusOptions(
  db: Db,
  tenantId: string,
  opts?: { activeOnly?: boolean; selectableOnCreate?: boolean },
) {
  await ensureInvoiceStatusOptions(db, tenantId);
  return db.invoiceStatusOption.findMany({
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

export async function resolveInvoiceStatusOption(
  db: Db,
  tenantId: string,
  input: {
    statusOptionId?: string | null;
    statusCode?: string | null;
    /** When true, only DRAFT/ISSUED workflows allowed */
    forCreate?: boolean;
  },
) {
  await ensureInvoiceStatusOptions(db, tenantId);

  let option =
    input.statusOptionId
      ? await db.invoiceStatusOption.findFirst({
          where: {
            id: input.statusOptionId,
            tenantId,
            isActive: true,
          },
        })
      : null;

  if (!option) {
    const code = (input.statusCode || "DRAFT").trim().toUpperCase();
    option = await db.invoiceStatusOption.findFirst({
      where: { tenantId, code, isActive: true },
    });
    if (!option && (code === "DRAFT" || code === "ISSUED" || code === "ISSUE_NOW")) {
      option = await db.invoiceStatusOption.findFirst({
        where: {
          tenantId,
          code: code === "ISSUED" ? "ISSUE_NOW" : code,
          isSystem: true,
        },
      });
      if (!option && code === "ISSUED") {
        option = await db.invoiceStatusOption.findFirst({
          where: { tenantId, code: "ISSUED", isSystem: true },
        });
      }
    }
  }

  if (!option) {
    throw new InvoiceStatusOptionError("Η κατάσταση δεν βρέθηκε", 404);
  }

  if (input.forCreate) {
    if (
      !(INVOICE_CREATE_WORKFLOWS as readonly string[]).includes(option.workflow)
    ) {
      throw new InvoiceStatusOptionError(
        "Η κατάσταση δεν επιτρέπεται στη δημιουργία παραστατικού",
      );
    }
  }

  return option;
}

export async function createInvoiceStatusOption(
  db: Db,
  input: { tenantId: string; data: InvoiceStatusOptionInput },
) {
  const code = input.data.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) {
    throw new InvoiceStatusOptionError(
      "Ο κωδικός πρέπει να είναι λατινικά κεφαλαία / _ (2–40)",
    );
  }
  if (!(INVOICE_WORKFLOWS as readonly string[]).includes(input.data.workflow)) {
    throw new InvoiceStatusOptionError("Μη έγκυρο workflow");
  }
  if (
    input.data.selectableOnCreate &&
    !(INVOICE_CREATE_WORKFLOWS as readonly string[]).includes(input.data.workflow)
  ) {
    throw new InvoiceStatusOptionError(
      "Στη νέα φόρμα επιτρέπονται μόνο workflow Πρόχειρο / Έκδοση",
    );
  }

  const existing = await db.invoiceStatusOption.findUnique({
    where: { tenantId_code: { tenantId: input.tenantId, code } },
  });
  if (existing) {
    throw new InvoiceStatusOptionError(
      `Υπάρχει ήδη κατάσταση με κωδικό ${code}`,
      409,
    );
  }

  return db.invoiceStatusOption.create({
    data: {
      tenantId: input.tenantId,
      code,
      name: input.data.name.trim(),
      workflow: input.data.workflow as InvoiceStatus,
      sortOrder: input.data.sortOrder ?? 100,
      isActive: input.data.isActive ?? true,
      selectableOnCreate: input.data.selectableOnCreate ?? true,
      tone: input.data.tone?.trim() || "slate",
      isSystem: false,
    },
  });
}

export async function updateInvoiceStatusOption(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    data: Partial<InvoiceStatusOptionInput> & { isActive?: boolean };
  },
) {
  const existing = await db.invoiceStatusOption.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) {
    throw new InvoiceStatusOptionError("Η κατάσταση δεν βρέθηκε", 404);
  }

  if (
    input.data.workflow &&
    !(INVOICE_WORKFLOWS as readonly string[]).includes(input.data.workflow)
  ) {
    throw new InvoiceStatusOptionError("Μη έγκυρο workflow");
  }

  const nextSelectable =
    input.data.selectableOnCreate ?? existing.selectableOnCreate;
  const nextWorkflow =
    (input.data.workflow as InvoiceStatus | undefined) ?? existing.workflow;
  if (
    nextSelectable &&
    !(INVOICE_CREATE_WORKFLOWS as readonly string[]).includes(nextWorkflow)
  ) {
    throw new InvoiceStatusOptionError(
      "Στη νέα φόρμα επιτρέπονται μόνο workflow Πρόχειρο / Έκδοση",
    );
  }

  if (existing.isSystem) {
    return db.invoiceStatusOption.update({
      where: { id: existing.id },
      data: {
        name: input.data.name?.trim() || existing.name,
        sortOrder: input.data.sortOrder ?? existing.sortOrder,
        isActive: input.data.isActive ?? existing.isActive,
        selectableOnCreate: nextSelectable,
        tone: input.data.tone?.trim() || existing.tone,
      },
    });
  }

  let code = existing.code;
  if (input.data.code != null) {
    code = input.data.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) {
      throw new InvoiceStatusOptionError(
        "Ο κωδικός πρέπει να είναι λατινικά κεφαλαία / _ (2–40)",
      );
    }
    if (code !== existing.code) {
      const clash = await db.invoiceStatusOption.findUnique({
        where: { tenantId_code: { tenantId: input.tenantId, code } },
      });
      if (clash) {
        throw new InvoiceStatusOptionError(
          `Υπάρχει ήδη κατάσταση με κωδικό ${code}`,
          409,
        );
      }
    }
  }

  return db.invoiceStatusOption.update({
    where: { id: existing.id },
    data: {
      code,
      name: input.data.name?.trim() || existing.name,
      workflow: nextWorkflow,
      sortOrder: input.data.sortOrder ?? existing.sortOrder,
      isActive: input.data.isActive ?? existing.isActive,
      selectableOnCreate: nextSelectable,
      tone: input.data.tone?.trim() || existing.tone,
    },
  });
}

export async function deleteInvoiceStatusOption(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const existing = await db.invoiceStatusOption.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) {
    throw new InvoiceStatusOptionError("Η κατάσταση δεν βρέθηκε", 404);
  }
  if (existing.isSystem) {
    throw new InvoiceStatusOptionError(
      "Οι συστημικές καταστάσεις δεν διαγράφονται",
    );
  }
  const inUse = await db.invoice.count({
    where: { tenantId: input.tenantId, statusOptionId: existing.id },
  });
  if (inUse > 0) {
    throw new InvoiceStatusOptionError(
      `Χρησιμοποιείται σε ${inUse} παραστατικά — απενεργοποίησέ την`,
    );
  }
  await db.invoiceStatusOption.delete({ where: { id: existing.id } });
}

export function displayInvoiceStatus(
  status: string,
  option?: { name: string; tone: string } | null,
) {
  const key = status as InvoiceStatusKey;
  return {
    label: option?.name || invoiceStatusLabel[key] || status,
    tone: option?.tone || invoiceStatusTone[key] || "slate",
  };
}
