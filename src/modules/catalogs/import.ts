import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { paymentMethodUpsertSchema } from "@/modules/payments/schemas";
import { unitOfMeasureUpsertSchema } from "@/modules/units/schemas";
import { isPermissionKey } from "@/platform/auth/permissions";
import {
  cell,
  parseBool,
  parseNumber,
  parseTableBuffer,
  type TableRow,
} from "./parse-table";

type Db = PrismaClient | Prisma.TransactionClient;

export type CatalogKind = "payment-methods" | "units" | "roles";

export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

const KIND_ALIASES: Record<string, string> = {
  μετρητά: "CASH",
  μετρητα: "CASH",
  cash: "CASH",
  κάρτα: "CARD",
  καρτα: "CARD",
  card: "CARD",
  pos: "CARD",
  μεταφορά: "TRANSFER",
  μεταφορα: "TRANSFER",
  transfer: "TRANSFER",
  iris: "TRANSFER",
  δωροκάρτα: "GIFT_CARD",
  δωροκαρτα: "GIFT_CARD",
  gift_card: "GIFT_CARD",
  loyalty: "LOYALTY",
  πόντοι: "LOYALTY",
  ποντοι: "LOYALTY",
  άλλο: "OTHER",
  αλλο: "OTHER",
  other: "OTHER",
};

const UNIT_KIND_ALIASES: Record<string, string> = {
  count: "COUNT",
  τεμάχια: "COUNT",
  τεμαχια: "COUNT",
  weight: "WEIGHT",
  βάρος: "WEIGHT",
  βαρος: "WEIGHT",
  volume: "VOLUME",
  όγκος: "VOLUME",
  ογκος: "VOLUME",
  length: "LENGTH",
  μήκος: "LENGTH",
  μηκος: "LENGTH",
  area: "AREA",
  εμβαδόν: "AREA",
  εμβαδον: "AREA",
  time: "TIME",
  χρόνος: "TIME",
  χρονος: "TIME",
  other: "OTHER",
  άλλο: "OTHER",
};

const SYSTEM_ROLE_CODES = new Set([
  "owner",
  "admin",
  "member",
  "viewer",
  "super_admin",
  "superadmin",
]);

export function catalogFilePath(kind: CatalogKind) {
  return join(process.cwd(), "data", "catalogs", `${kind}.csv`);
}

export function readBundledCatalogCsv(kind: CatalogKind) {
  return readFileSync(catalogFilePath(kind), "utf8");
}

function mapPaymentKind(raw: string) {
  const v = raw.trim();
  if (!v) return "OTHER";
  return KIND_ALIASES[v.toLowerCase()] ?? v.toUpperCase();
}

function mapUnitKind(raw: string) {
  const v = raw.trim();
  if (!v) return "COUNT";
  return UNIT_KIND_ALIASES[v.toLowerCase()] ?? v.toUpperCase();
}

export async function importPaymentMethodRows(db: Db, tenantId: string, rows: TableRow[]) {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowNo = index + 2;
    const parsed = paymentMethodUpsertSchema.safeParse({
      code: cell(row, "code", "κωδικός", "κωδικος"),
      name: cell(row, "name", "όνομα", "ονομα"),
      kind: mapPaymentKind(cell(row, "kind", "τύπος", "τυπος")),
      description: cell(row, "description", "περιγραφή", "περιγραφη") || null,
      glAccount: cell(row, "glAccount", "gl_account") || null,
      glContraAccount: cell(row, "glContraAccount", "gl_contra_account") || null,
      glClearingAccount: cell(row, "glClearingAccount", "gl_clearing_account") || null,
      costCenter: cell(row, "costCenter", "cost_center") || null,
      accountingCode: cell(row, "accountingCode", "accounting_code") || null,
      bankIban: cell(row, "bankIban", "iban") || null,
      bankName: cell(row, "bankName", "bank") || null,
      myDataPaymentType: cell(row, "myDataPaymentType", "mydata") || null,
      sortOrder: parseNumber(cell(row, "sortOrder", "sort_order"), 100),
      isActive: parseBool(cell(row, "isActive", "active"), true),
      showInPos: parseBool(cell(row, "showInPos", "pos"), true),
      showInCollect: parseBool(cell(row, "showInCollect", "collect"), true),
      requiresExternalRef: parseBool(cell(row, "requiresExternalRef"), false),
      allowsChange: parseBool(cell(row, "allowsChange"), false),
      affectsCashDrawer: parseBool(cell(row, "affectsCashDrawer"), false),
    });
    if (!parsed.success) {
      result.errors.push({
        row: rowNo,
        message: parsed.error.issues[0]?.message ?? "Μη έγκυρη γραμμή",
      });
      continue;
    }

    const data = parsed.data;
    const existing = await db.paymentMethod.findUnique({
      where: { tenantId_code: { tenantId, code: data.code } },
    });
    if (existing) {
      await db.paymentMethod.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          kind: data.kind,
          description: data.description,
          glAccount: data.glAccount,
          glContraAccount: data.glContraAccount,
          glClearingAccount: data.glClearingAccount,
          costCenter: data.costCenter,
          accountingCode: data.accountingCode,
          bankIban: data.bankIban,
          bankName: data.bankName,
          myDataPaymentType: data.myDataPaymentType,
          sortOrder: data.sortOrder ?? existing.sortOrder,
          isActive: data.isActive ?? existing.isActive,
          showInPos: data.showInPos ?? existing.showInPos,
          showInCollect: data.showInCollect ?? existing.showInCollect,
          requiresExternalRef: data.requiresExternalRef ?? existing.requiresExternalRef,
          allowsChange: data.allowsChange ?? existing.allowsChange,
          affectsCashDrawer: data.affectsCashDrawer ?? existing.affectsCashDrawer,
        },
      });
      result.updated += 1;
      continue;
    }

    await db.paymentMethod.create({
      data: {
        tenantId,
        ...data,
        isSystem: false,
      },
    });
    result.created += 1;
  }

  return result;
}

export async function importUnitRows(db: Db, tenantId: string, rows: TableRow[]) {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowNo = index + 2;
    const parsed = unitOfMeasureUpsertSchema.safeParse({
      code: cell(row, "code", "κωδικός", "κωδικος"),
      name: cell(row, "name", "όνομα", "ονομα"),
      symbol: cell(row, "symbol", "σύμβολο", "συμβολο"),
      kind: mapUnitKind(cell(row, "kind", "τύπος", "τυπος")),
      decimals: parseNumber(cell(row, "decimals"), 0),
      description: cell(row, "description", "περιγραφή", "περιγραφη") || null,
      sortOrder: parseNumber(cell(row, "sortOrder", "sort_order"), 100),
      isActive: parseBool(cell(row, "isActive", "active"), true),
      isDefault: parseBool(cell(row, "isDefault", "default"), false),
    });
    if (!parsed.success) {
      result.errors.push({
        row: rowNo,
        message: parsed.error.issues[0]?.message ?? "Μη έγκυρη γραμμή",
      });
      continue;
    }

    const data = parsed.data;
    const existing = await db.unitOfMeasure.findUnique({
      where: { tenantId_code: { tenantId, code: data.code } },
    });

    if (data.isDefault) {
      await db.unitOfMeasure.updateMany({
        where: {
          tenantId,
          isDefault: true,
          ...(existing ? { NOT: { id: existing.id } } : {}),
        },
        data: { isDefault: false },
      });
    }

    if (existing) {
      const symbolClash = await db.unitOfMeasure.findFirst({
        where: {
          tenantId,
          symbol: data.symbol,
          NOT: { id: existing.id },
        },
      });
      if (symbolClash) {
        result.errors.push({
          row: rowNo,
          message: `Το σύμβολο «${data.symbol}» χρησιμοποιείται ήδη`,
        });
        continue;
      }
      await db.unitOfMeasure.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          symbol: data.symbol,
          kind: data.kind,
          decimals: data.decimals ?? existing.decimals,
          description: data.description,
          sortOrder: data.sortOrder ?? existing.sortOrder,
          isActive: data.isActive ?? existing.isActive,
          isDefault: data.isDefault ?? existing.isDefault,
        },
      });
      result.updated += 1;
      continue;
    }

    const symbolClash = await db.unitOfMeasure.findUnique({
      where: { tenantId_symbol: { tenantId, symbol: data.symbol } },
    });
    if (symbolClash) {
      result.errors.push({
        row: rowNo,
        message: `Το σύμβολο «${data.symbol}» χρησιμοποιείται ήδη`,
      });
      continue;
    }

    await db.unitOfMeasure.create({
      data: {
        tenantId,
        ...data,
        isSystem: false,
      },
    });
    result.created += 1;
  }

  return result;
}

export async function importRoleRows(db: Db, tenantId: string, rows: TableRow[]) {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowNo = index + 2;
    const code = cell(row, "code", "κωδικός", "κωδικος").trim().toLowerCase();
    const name = cell(row, "name", "όνομα", "ονομα");
    const description =
      cell(row, "description", "περιγραφή", "περιγραφη") || null;
    const permissionsRaw = cell(row, "permissions", "δικαιώματα", "δικαιωματα");
    const permissions = permissionsRaw
      .split(/[|,;]/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (!/^[a-z0-9_]{2,40}$/.test(code)) {
      result.errors.push({
        row: rowNo,
        message: "Άκυρος κωδικός ρόλου (πεζά λατινικά, αριθμοί, _)",
      });
      continue;
    }
    if (name.length < 2) {
      result.errors.push({ row: rowNo, message: "Λείπει όνομα ρόλου" });
      continue;
    }
    if (SYSTEM_ROLE_CODES.has(code)) {
      result.skipped += 1;
      result.errors.push({
        row: rowNo,
        message: `Ο ρόλος ${code} είναι system και δεν αντικαθίσταται`,
      });
      continue;
    }
    const bad = permissions.filter((p) => p !== "*" && !isPermissionKey(p));
    if (bad.length) {
      result.errors.push({
        row: rowNo,
        message: `Άγνωστα permissions: ${bad.join(", ")}`,
      });
      continue;
    }

    const existing = await db.appRole.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (existing?.isSystem) {
      result.skipped += 1;
      continue;
    }
    if (existing) {
      await db.appRole.update({
        where: { id: existing.id },
        data: { name, description, permissions },
      });
      result.updated += 1;
      continue;
    }

    await db.appRole.create({
      data: {
        tenantId,
        code,
        name,
        description,
        permissions,
        isSystem: false,
      },
    });
    result.created += 1;
  }

  return result;
}

export async function importCatalogFromBuffer(
  db: Db,
  input: { tenantId: string; kind: CatalogKind; buffer: Buffer; filename: string },
) {
  const rows = await parseTableBuffer(input.buffer, input.filename);
  if (rows.length === 0) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 1, message: "Κενό αρχείο ή λείπουν γραμμές δεδομένων" }],
    } satisfies ImportResult;
  }
  if (input.kind === "payment-methods") {
    return importPaymentMethodRows(db, input.tenantId, rows);
  }
  if (input.kind === "units") {
    return importUnitRows(db, input.tenantId, rows);
  }
  return importRoleRows(db, input.tenantId, rows);
}

export async function importBundledCatalogs(db: Db, tenantId: string) {
  const kinds: CatalogKind[] = ["payment-methods", "units", "roles"];
  const summary: Record<CatalogKind, ImportResult> = {
    "payment-methods": { created: 0, updated: 0, skipped: 0, errors: [] },
    units: { created: 0, updated: 0, skipped: 0, errors: [] },
    roles: { created: 0, updated: 0, skipped: 0, errors: [] },
  };
  for (const kind of kinds) {
    const csv = readBundledCatalogCsv(kind);
    summary[kind] = await importCatalogFromBuffer(db, {
      tenantId,
      kind,
      buffer: Buffer.from(csv, "utf8"),
      filename: `${kind}.csv`,
    });
  }
  return summary;
}
