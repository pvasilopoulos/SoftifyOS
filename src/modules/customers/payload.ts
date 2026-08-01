import type { z } from "zod";
import type { customerCreateSchema } from "@/modules/master-data/schemas";

export type CustomerWriteInput = z.infer<typeof customerCreateSchema>;

const EMPTY = new Set(["", "undefined", "null"]);

function emptyToNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return !s || EMPTY.has(s) ? null : s;
}

function toBool(v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === true) return true;
  if (v === "false" || v === false) return false;
  if (v === null || v === "") return undefined;
  return undefined;
}

function toNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null | undefined {
  const n = toNumber(v);
  if (n === undefined) return undefined;
  if (n === null) return null;
  return Math.trunc(n);
}

/** Map dynamic form values → API body (all ERP customer fields). */
export function customerBodyFromValues(
  values: Record<string, unknown>,
  customFields?: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    code: String(values.code ?? "").trim(),
    name: String(values.name ?? "").trim(),
    tradeName: emptyToNull(values.tradeName),
    legalForm: emptyToNull(values.legalForm),
    isPerson: toBool(values.isPerson) ?? false,
    vatNumber: emptyToNull(values.vatNumber),
    taxOffice: emptyToNull(values.taxOffice),
    gemhNumber: emptyToNull(values.gemhNumber),
    eoriNumber: emptyToNull(values.eoriNumber),
    vatStatus: emptyToNull(values.vatStatus) ?? "NORMAL",
    profession: emptyToNull(values.profession),
    email: emptyToNull(values.email),
    phone: emptyToNull(values.phone),
    mobile: emptyToNull(values.mobile),
    fax: emptyToNull(values.fax),
    website: emptyToNull(values.website),
    address: emptyToNull(values.address),
    address2: emptyToNull(values.address2),
    city: emptyToNull(values.city),
    postalCode: emptyToNull(values.postalCode),
    region: emptyToNull(values.region),
    country: emptyToNull(values.country) ?? "GR",
    shippingAddress: emptyToNull(values.shippingAddress),
    shippingAddress2: emptyToNull(values.shippingAddress2),
    shippingCity: emptyToNull(values.shippingCity),
    shippingPostalCode: emptyToNull(values.shippingPostalCode),
    shippingRegion: emptyToNull(values.shippingRegion),
    shippingCountry: emptyToNull(values.shippingCountry),
    category: emptyToNull(values.category),
    salesperson: emptyToNull(values.salesperson),
    paymentTermsDays: toInt(values.paymentTermsDays),
    paymentTermsLabel: emptyToNull(values.paymentTermsLabel),
    creditLimit: toNumber(values.creditLimit),
    currency: emptyToNull(values.currency) ?? "EUR",
    locale: emptyToNull(values.locale) ?? "el-GR",
    discountPercent: toNumber(values.discountPercent),
    priceListCode: emptyToNull(values.priceListCode),
    shippingMethod: emptyToNull(values.shippingMethod),
    iban: emptyToNull(values.iban),
    bic: emptyToNull(values.bic),
    bankName: emptyToNull(values.bankName),
    bankAccountHolder: emptyToNull(values.bankAccountHolder),
    isBlocked: toBool(values.isBlocked) ?? false,
    sendEinvoice: toBool(values.sendEinvoice) ?? false,
    notes: emptyToNull(values.notes),
    status: emptyToNull(values.status) ?? "ACTIVE",
  };
  if (customFields !== undefined) body.customFields = customFields;
  return body;
}

export function customerFormValuesFromItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const bool = (v: unknown) =>
    v === true || v === "true" ? "true" : v === false || v === "false" ? "false" : "";
  const num = (v: unknown) =>
    v == null || v === "" ? "" : String(v);

  return {
    code: item.code ?? "",
    name: item.name ?? "",
    tradeName: item.tradeName ?? "",
    legalForm: item.legalForm ?? "",
    isPerson: bool(item.isPerson),
    vatNumber: item.vatNumber ?? "",
    taxOffice: item.taxOffice ?? "",
    gemhNumber: item.gemhNumber ?? "",
    eoriNumber: item.eoriNumber ?? "",
    vatStatus: item.vatStatus ?? "NORMAL",
    profession: item.profession ?? "",
    email: item.email ?? "",
    phone: item.phone ?? "",
    mobile: item.mobile ?? "",
    fax: item.fax ?? "",
    website: item.website ?? "",
    address: item.address ?? "",
    address2: item.address2 ?? "",
    city: item.city ?? "",
    postalCode: item.postalCode ?? "",
    region: item.region ?? "",
    country: item.country ?? "GR",
    shippingAddress: item.shippingAddress ?? "",
    shippingAddress2: item.shippingAddress2 ?? "",
    shippingCity: item.shippingCity ?? "",
    shippingPostalCode: item.shippingPostalCode ?? "",
    shippingRegion: item.shippingRegion ?? "",
    shippingCountry: item.shippingCountry ?? "",
    category: item.category ?? "",
    salesperson: item.salesperson ?? "",
    paymentTermsDays: num(item.paymentTermsDays),
    paymentTermsLabel: item.paymentTermsLabel ?? "",
    creditLimit: num(item.creditLimit),
    currency: item.currency ?? "EUR",
    locale: item.locale ?? "el-GR",
    discountPercent: num(item.discountPercent),
    priceListCode: item.priceListCode ?? "",
    shippingMethod: item.shippingMethod ?? "",
    iban: item.iban ?? "",
    bic: item.bic ?? "",
    bankName: item.bankName ?? "",
    bankAccountHolder: item.bankAccountHolder ?? "",
    isBlocked: bool(item.isBlocked),
    sendEinvoice: bool(item.sendEinvoice),
    notes: item.notes ?? "",
    status: item.status ?? "ACTIVE",
  };
}

/** Keys scripts may patch on create/update */
export const CUSTOMER_PATCHABLE_KEYS = [
  "code",
  "name",
  "tradeName",
  "legalForm",
  "isPerson",
  "vatNumber",
  "taxOffice",
  "gemhNumber",
  "eoriNumber",
  "vatStatus",
  "profession",
  "email",
  "phone",
  "mobile",
  "fax",
  "website",
  "address",
  "address2",
  "city",
  "postalCode",
  "region",
  "country",
  "shippingAddress",
  "shippingAddress2",
  "shippingCity",
  "shippingPostalCode",
  "shippingRegion",
  "shippingCountry",
  "category",
  "salesperson",
  "paymentTermsDays",
  "paymentTermsLabel",
  "creditLimit",
  "currency",
  "locale",
  "discountPercent",
  "priceListCode",
  "shippingMethod",
  "iban",
  "bic",
  "bankName",
  "bankAccountHolder",
  "isBlocked",
  "sendEinvoice",
  "notes",
  "status",
  "customFields",
] as const;

export function prismaCustomerDataFromPatched(
  patched: Record<string, unknown>,
): Record<string, unknown> {
  return {
    code: String(patched.code),
    name: String(patched.name),
    tradeName: (patched.tradeName as string | null) || null,
    legalForm: (patched.legalForm as string | null) || null,
    isPerson: Boolean(patched.isPerson),
    vatNumber: (patched.vatNumber as string | null) || null,
    taxOffice: (patched.taxOffice as string | null) || null,
    gemhNumber: (patched.gemhNumber as string | null) || null,
    eoriNumber: (patched.eoriNumber as string | null) || null,
    vatStatus: (patched.vatStatus as string | null) || "NORMAL",
    profession: (patched.profession as string | null) || null,
    email: (patched.email as string | null) || null,
    phone: (patched.phone as string | null) || null,
    mobile: (patched.mobile as string | null) || null,
    fax: (patched.fax as string | null) || null,
    website: (patched.website as string | null) || null,
    address: (patched.address as string | null) || null,
    address2: (patched.address2 as string | null) || null,
    city: (patched.city as string | null) || null,
    postalCode: (patched.postalCode as string | null) || null,
    region: (patched.region as string | null) || null,
    country: (patched.country as string | null) || "GR",
    shippingAddress: (patched.shippingAddress as string | null) || null,
    shippingAddress2: (patched.shippingAddress2 as string | null) || null,
    shippingCity: (patched.shippingCity as string | null) || null,
    shippingPostalCode: (patched.shippingPostalCode as string | null) || null,
    shippingRegion: (patched.shippingRegion as string | null) || null,
    shippingCountry: (patched.shippingCountry as string | null) || null,
    category: (patched.category as string | null) || null,
    salesperson: (patched.salesperson as string | null) || null,
    paymentTermsDays:
      patched.paymentTermsDays == null || patched.paymentTermsDays === ""
        ? null
        : Number(patched.paymentTermsDays),
    paymentTermsLabel: (patched.paymentTermsLabel as string | null) || null,
    creditLimit:
      patched.creditLimit == null || patched.creditLimit === ""
        ? null
        : Number(patched.creditLimit),
    currency: (patched.currency as string | null) || "EUR",
    locale: (patched.locale as string | null) || "el-GR",
    discountPercent:
      patched.discountPercent == null || patched.discountPercent === ""
        ? null
        : Number(patched.discountPercent),
    priceListCode: (patched.priceListCode as string | null) || null,
    shippingMethod: (patched.shippingMethod as string | null) || null,
    iban: (patched.iban as string | null) || null,
    bic: (patched.bic as string | null) || null,
    bankName: (patched.bankName as string | null) || null,
    bankAccountHolder: (patched.bankAccountHolder as string | null) || null,
    isBlocked: Boolean(patched.isBlocked),
    sendEinvoice: Boolean(patched.sendEinvoice),
    notes: (patched.notes as string | null) || null,
    status: (patched.status as string | null) || "ACTIVE",
  };
}

export function serializeCustomer<T extends Record<string, unknown>>(item: T) {
  const creditLimit = item.creditLimit as
    | { toString(): string }
    | number
    | null
    | undefined;
  const discountPercent = item.discountPercent as
    | { toString(): string }
    | number
    | null
    | undefined;
  return {
    ...item,
    creditLimit:
      creditLimit == null
        ? null
        : typeof creditLimit === "number"
          ? creditLimit
          : Number(creditLimit),
    discountPercent:
      discountPercent == null
        ? null
        : typeof discountPercent === "number"
          ? discountPercent
          : Number(discountPercent),
  };
}
