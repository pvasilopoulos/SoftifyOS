import type { DocumentKind, Prisma, PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_PRINT_FORMS, parseBodyJson, type PrintFormBody } from "./defaults";

export { parseBodyJson };

type Db = PrismaClient | Prisma.TransactionClient;

export class PrintFormError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function ensureDefaultPrintForms(db: Db, tenantId: string) {
  for (const row of DEFAULT_PRINT_FORMS) {
    const existing = await db.printForm.findUnique({
      where: { tenantId_code: { tenantId, code: row.code } },
    });
    if (!existing) {
      await db.printForm.create({
        data: {
          tenantId,
          code: row.code,
          name: row.name,
          documentKind: row.documentKind,
          bodyJson: row.body as unknown as Prisma.InputJsonValue,
          isDefault: row.isDefault,
          isSystem: true,
          isActive: true,
        },
      });
      continue;
    }
    // Upgrade system templates that are still legacy block-only
    const parsed = parseBodyJson(existing.bodyJson);
    const needsHtmlUpgrade =
      existing.isSystem &&
      (parsed.version === 1 ||
        (parsed.version === 2 && parsed.engine !== "html"));
    if (needsHtmlUpgrade) {
      await db.printForm.update({
        where: { id: existing.id },
        data: {
          name: row.name,
          bodyJson: row.body as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
}

export async function listPrintForms(
  db: Db,
  tenantId: string,
  opts?: { kind?: DocumentKind; activeOnly?: boolean },
) {
  await ensureDefaultPrintForms(db, tenantId);
  return db.printForm.findMany({
    where: {
      tenantId,
      ...(opts?.kind ? { documentKind: opts.kind } : {}),
      ...(opts?.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ documentKind: "asc" }, { code: "asc" }],
  });
}

export async function syncSeriesPrintForms(
  db: Db,
  input: {
    tenantId: string;
    seriesId: string;
    printFormIds: string[];
    defaultPrintFormId?: string | null;
  },
) {
  const uniqueIds = [...new Set(input.printFormIds.filter(Boolean))];
  if (uniqueIds.length > 0) {
    const found = await db.printForm.findMany({
      where: { tenantId: input.tenantId, id: { in: uniqueIds } },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      throw new PrintFormError("Μη έγκυρη φόρμα εκτύπωσης");
    }
  }

  const defaultId =
    input.defaultPrintFormId && uniqueIds.includes(input.defaultPrintFormId)
      ? input.defaultPrintFormId
      : (uniqueIds[0] ?? null);

  await db.documentSeriesPrintForm.deleteMany({
    where: { tenantId: input.tenantId, seriesId: input.seriesId },
  });

  if (uniqueIds.length === 0) return;

  await db.documentSeriesPrintForm.createMany({
    data: uniqueIds.map((printFormId, index) => ({
      tenantId: input.tenantId,
      seriesId: input.seriesId,
      printFormId,
      isDefault: printFormId === defaultId,
      sortOrder: index,
    })),
  });
}

export async function resolvePrintFormForSeries(
  db: Db,
  input: {
    tenantId: string;
    seriesId?: string | null;
    documentKind: DocumentKind;
    printFormId?: string | null;
  },
) {
  await ensureDefaultPrintForms(db, input.tenantId);

  if (input.printFormId) {
    const explicit = await db.printForm.findFirst({
      where: {
        id: input.printFormId,
        tenantId: input.tenantId,
        isActive: true,
      },
    });
    if (explicit) return explicit;
  }

  if (input.seriesId) {
    const links = await db.documentSeriesPrintForm.findMany({
      where: { tenantId: input.tenantId, seriesId: input.seriesId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { printForm: true },
    });
    const active = links.filter((l) => l.printForm.isActive);
    const preferred =
      active.find((l) => l.isDefault)?.printForm ?? active[0]?.printForm;
    if (preferred) return preferred;
  }

  return db.printForm.findFirst({
    where: {
      tenantId: input.tenantId,
      documentKind: input.documentKind,
      isActive: true,
      isDefault: true,
    },
  });
}

export function mapSeriesPrintLinks(
  links: {
    printFormId: string;
    isDefault: boolean;
    sortOrder: number;
    printForm: {
      id: string;
      code: string;
      name: string;
      documentKind: string;
      isActive: boolean;
    };
  }[],
) {
  return {
    allowedPrintFormIds: links.map((l) => l.printFormId),
    defaultPrintFormId:
      links.find((l) => l.isDefault)?.printFormId ??
      links[0]?.printFormId ??
      null,
    printForms: links.map((l) => ({
      id: l.printForm.id,
      code: l.printForm.code,
      name: l.printForm.name,
      documentKind: l.printForm.documentKind,
      isActive: l.printForm.isActive,
      isDefault: l.isDefault,
    })),
  };
}
