import { z } from "zod";

export const customerCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  vatNumber: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
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

export const branchCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(300).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
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
