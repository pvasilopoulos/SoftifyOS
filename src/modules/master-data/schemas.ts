import { z } from "zod";

const emptyToNull = (v: unknown) =>
  v === "" || v === undefined ? null : v;

const optStr = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

const optEmail = z.preprocess(
  emptyToNull,
  z.string().trim().email().max(200).nullable().optional(),
);

const optBool = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return v;
}, z.boolean().optional());

const optNumber = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}, z.number().nullable().optional());

const optInt = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : v;
}, z.number().int().nullable().optional());

export const customerLegalFormEnum = z.enum([
  "AE",
  "OE",
  "EE",
  "IKE",
  "EPE",
  "INDIVIDUAL",
  "PUBLIC",
  "NGO",
  "OTHER",
]);

export const customerVatStatusEnum = z.enum([
  "NORMAL",
  "EXEMPT",
  "INTRA_EU",
  "EXPORT",
  "OSS",
]);

export const customerCategoryEnum = z.enum([
  "RETAIL",
  "WHOLESALE",
  "DISTRIBUTOR",
  "PUBLIC",
  "INTERNAL",
  "OTHER",
]);

export const customerCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  tradeName: optStr(200),
  legalForm: z.preprocess(
    emptyToNull,
    customerLegalFormEnum.nullable().optional(),
  ),
  isPerson: optBool,
  vatNumber: optStr(32),
  taxOffice: optStr(120),
  gemhNumber: optStr(40),
  eoriNumber: optStr(40),
  vatStatus: z.preprocess(
    emptyToNull,
    customerVatStatusEnum.optional().nullable(),
  ),
  profession: optStr(160),
  email: optEmail,
  phone: optStr(40),
  mobile: optStr(40),
  fax: optStr(40),
  website: optStr(200),
  address: optStr(300),
  address2: optStr(300),
  city: optStr(120),
  postalCode: optStr(20),
  region: optStr(120),
  country: optStr(8),
  shippingAddress: optStr(300),
  shippingAddress2: optStr(300),
  shippingCity: optStr(120),
  shippingPostalCode: optStr(20),
  shippingRegion: optStr(120),
  shippingCountry: optStr(8),
  category: z.preprocess(
    emptyToNull,
    customerCategoryEnum.nullable().optional(),
  ),
  salesperson: optStr(120),
  paymentTermsDays: optInt,
  paymentTermsLabel: optStr(120),
  creditLimit: optNumber,
  currency: optStr(8),
  locale: optStr(16),
  discountPercent: optNumber,
  priceListCode: optStr(40),
  shippingMethod: optStr(120),
  iban: optStr(40),
  bic: optStr(20),
  bankName: optStr(120),
  bankAccountHolder: optStr(160),
  isBlocked: optBool,
  sendEinvoice: optBool,
  notes: optStr(2000),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  customFields: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.string()),
      ]),
    )
    .optional(),
});

export const customerUpdateSchema = customerCreateSchema.partial();

export const customerContactSchema = z.object({
  name: z.string().trim().min(1).max(160),
  title: optStr(120),
  email: optEmail,
  phone: optStr(40),
  mobile: optStr(40),
  isPrimary: optBool,
  notes: optStr(2000),
});

export const customerContactUpdateSchema = customerContactSchema.partial();

export const branchCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  address: optStr(300),
  address2: optStr(300),
  city: optStr(120),
  postalCode: optStr(20),
  region: optStr(120),
  country: optStr(8),
  email: optEmail,
  phone: optStr(40),
  fax: optStr(40),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
  isPrimary: z.boolean().optional(),
});

export const spaceCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  type: z
    .enum(["OFFICE", "WAREHOUSE", "FLOOR", "ROOM", "YARD", "OTHER"])
    .optional(),
  floorLabel: z.string().trim().max(40).optional().nullable(),
  areaSqm: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const spaceTypeLabel = {
  OFFICE: "Γραφείο",
  WAREHOUSE: "Αποθήκη",
  FLOOR: "Όροφος",
  ROOM: "Δωμάτιο",
  YARD: "Αυλή/Υπαίθριος",
  OTHER: "Άλλο",
} as const;

export const productCreateSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  barcode: z
    .string()
    .trim()
    .max(64)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  name: z.string().trim().min(1).max(200),
  /** Preferred: UnitOfMeasure id */
  unitId: z.string().min(1).optional().nullable(),
  /** Legacy / fallback symbol — resolved against catalog */
  unit: z.string().trim().min(1).max(20).optional().nullable(),
  vatRate: z.coerce.number().min(0).max(100).optional().default(24),
  price: z.coerce.number().nonnegative().max(10_000_000),
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  trackInventory: z.boolean().optional(),
  customFields: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.string()),
      ]),
    )
    .optional(),
});

export const productUpdateSchema = productCreateSchema.partial();

export const productStatusLabel = {
  ACTIVE: "Ενεργό",
  INACTIVE: "Ανενεργό",
} as const;
