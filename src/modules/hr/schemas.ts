import { z } from "zod";

const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null));

const dateLike = z
  .string()
  .datetime()
  .optional()
  .nullable()
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable())
  .or(z.literal("").transform(() => null));

export const employeeStatusSchema = z.enum(["ACTIVE", "INACTIVE", "TERMINATED"]);
export const contractTypeSchema = z.enum([
  "INDEFINITE",
  "FIXED",
  "PART_TIME",
  "SEASONAL",
  "INTERNSHIP",
]);

export const employeeUpsertSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((v) => v.toUpperCase()),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  phone: optStr(40),
  title: optStr(120),
  department: optStr(120),
  vatNumber: optStr(20),
  amka: optStr(20),
  ama: optStr(20),
  iban: optStr(40),
  birthDate: dateLike,
  address: optStr(200),
  city: optStr(80),
  postalCode: optStr(20),
  nationality: z.string().trim().max(8).optional().default("GR"),
  contractType: contractTypeSchema.optional().default("INDEFINITE"),
  specialty: optStr(120),
  weeklyHours: z.coerce.number().min(0).max(168).optional().nullable(),
  baseGross: z.coerce.number().min(0).max(100000).optional().nullable(),
  monthlyAllowance: z.coerce.number().min(0).max(100000).optional().default(0),
  siteId: optStr(40),
  hireDate: dateLike,
  terminationDate: dateLike,
  erganiEmployeeId: optStr(80),
  status: employeeStatusSchema.optional().default("ACTIVE"),
  notes: optStr(2000),
});

export const employeePatchSchema = employeeUpsertSchema.partial();

export const leaveTypeUpsertSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9_]+$/.test(v), "Μόνο A-Z, 0-9, _"),
  name: z.string().trim().min(2).max(80),
  daysPerYear: z.coerce.number().int().min(0).max(366).optional().default(20),
  isPaid: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(100),
});

export const leaveRequestCreateSchema = z.object({
  employeeId: z.string().trim().min(1),
  leaveTypeId: z.string().trim().min(1),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().min(0.5).max(366).optional(),
  notes: optStr(2000),
});

export const leaveRequestDecideSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
  notes: optStr(2000),
});

export const workCardCreateSchema = z.object({
  employeeId: z.string().trim().min(1),
  cardNumber: z.string().trim().min(4).max(40),
  notes: optStr(500),
  status: z.enum(["ACTIVE", "INACTIVE", "LOST"]).optional().default("ACTIVE"),
});

export const workCardEventCreateSchema = z.object({
  employeeId: z.string().trim().min(1),
  workCardId: optStr(40),
  type: z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
  source: z.enum(["MANUAL", "CARD", "APP"]).optional().default("MANUAL"),
  occurredAt: z.string().datetime().optional().nullable(),
  siteId: optStr(40),
  note: optStr(500),
  enqueueErgani: z.boolean().optional().default(true),
});

export const payrollPeriodCreateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  notes: optStr(500),
  /** Προαιρετικό μικτό/μήνα ανά εργαζόμενο — αλλιώς default 1200 */
  defaultGross: z.coerce.number().min(0).max(100000).optional().default(1200),
});

export const payrollLineUpsertSchema = z.object({
  employeeId: z.string().trim().min(1),
  gross: z.coerce.number().min(0).max(100000),
  notes: optStr(500),
});

export const workCardStatusPatchSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "LOST"]),
  notes: optStr(500),
});

export const workScheduleUpsertSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  workDays: z.coerce.number().int().min(1).max(127).optional().default(31),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .default("09:00"),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .default("17:00"),
  breakMinutes: z.coerce.number().int().min(0).max(240).optional().default(30),
  weeklyHours: z.coerce.number().min(0).max(168).optional().default(40),
  isActive: z.boolean().optional().default(true),
  notes: optStr(500),
});

export const workScheduleAssignSchema = z.object({
  employeeId: z.string().trim().min(1),
  scheduleId: z.string().trim().min(1),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  notes: optStr(500),
});

export const workShiftCreateSchema = z.object({
  employeeId: z.string().trim().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.coerce.number().int().min(0).max(240).optional().default(0),
  kind: z.enum(["REGULAR", "OVERTIME", "REMOTE", "ON_CALL"]).optional().default("REGULAR"),
  siteId: optStr(40),
  notes: optStr(500),
});

export type EmployeeUpsertInput = z.infer<typeof employeeUpsertSchema>;
export type LeaveTypeUpsertInput = z.infer<typeof leaveTypeUpsertSchema>;
export type LeaveRequestCreateInput = z.infer<typeof leaveRequestCreateSchema>;
export type WorkCardCreateInput = z.infer<typeof workCardCreateSchema>;
export type WorkCardEventCreateInput = z.infer<typeof workCardEventCreateSchema>;
export type PayrollPeriodCreateInput = z.infer<typeof payrollPeriodCreateSchema>;
export type WorkScheduleUpsertInput = z.infer<typeof workScheduleUpsertSchema>;
export type WorkScheduleAssignInput = z.infer<typeof workScheduleAssignSchema>;
export type WorkShiftCreateInput = z.infer<typeof workShiftCreateSchema>;
