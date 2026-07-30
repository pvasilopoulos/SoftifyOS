import { z } from "zod";

export const customerCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  vatNumber: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

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
