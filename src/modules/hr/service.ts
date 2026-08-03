import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_LEAVE_TYPES } from "./labels";
import { randomBytes } from "crypto";
import { parseWorkCardQr, workCardQrPayload } from "./work-card-qr";
import type {
  EmployeeUpsertInput,
  LeaveRequestCreateInput,
  LeaveTypeUpsertInput,
  PayrollPeriodCreateInput,
  WorkCardCreateInput,
  WorkCardEventCreateInput,
  WorkCardScanInput,
  WorkScheduleAssignInput,
  WorkScheduleUpsertInput,
  WorkShiftCreateInput,
} from "./schemas";
import { assertLeaveRequestAllowed } from "./suite";
import { HrError } from "./errors";

export { HrError };

type Db = PrismaClient | Prisma.TransactionClient;

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function parseDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function businessDaysInclusive(from: Date, to: Date): number {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  if (end < start) return 0;
  let days = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const wd = cur.getUTCDay();
    if (wd !== 0 && wd !== 6) days += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return Math.max(days, 0.5);
}

/** Indicative Greek payroll split — rates overridable via tenant integrationsJson.payrollRates */
export type PayrollRateTable = {
  employeeEfkaRate: number;
  employerEfkaRate: number;
  taxRate: number;
};

export const DEFAULT_PAYROLL_RATES: PayrollRateTable = {
  employeeEfkaRate: 0.1387,
  employerEfkaRate: 0.2212,
  taxRate: 0.1,
};

export function readPayrollRates(
  integrationsJson: unknown,
): PayrollRateTable {
  if (
    !integrationsJson ||
    typeof integrationsJson !== "object" ||
    Array.isArray(integrationsJson)
  ) {
    return DEFAULT_PAYROLL_RATES;
  }
  const raw = (integrationsJson as Record<string, unknown>).payrollRates;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_PAYROLL_RATES;
  }
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1 ? n : fallback;
  };
  return {
    employeeEfkaRate: num(r.employeeEfkaRate, DEFAULT_PAYROLL_RATES.employeeEfkaRate),
    employerEfkaRate: num(r.employerEfkaRate, DEFAULT_PAYROLL_RATES.employerEfkaRate),
    taxRate: num(r.taxRate, DEFAULT_PAYROLL_RATES.taxRate),
  };
}

export function estimatePayrollSplits(
  gross: number,
  rates: PayrollRateTable = DEFAULT_PAYROLL_RATES,
) {
  const employeeEfka = Math.round(gross * rates.employeeEfkaRate * 100) / 100;
  const employerEfka = Math.round(gross * rates.employerEfkaRate * 100) / 100;
  const tax = Math.round(gross * rates.taxRate * 100) / 100;
  const net = Math.round((gross - employeeEfka - tax) * 100) / 100;
  return { employeeEfka, employerEfka, tax, net };
}

function employeeData(data: EmployeeUpsertInput | Partial<EmployeeUpsertInput>) {
  return {
    ...(data.code !== undefined ? { code: data.code } : {}),
    ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
    ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
    ...(data.email !== undefined ? { email: emptyToNull(data.email) } : {}),
    ...(data.phone !== undefined ? { phone: emptyToNull(data.phone) } : {}),
    ...(data.title !== undefined ? { title: emptyToNull(data.title) } : {}),
    ...(data.department !== undefined
      ? { department: emptyToNull(data.department) }
      : {}),
    ...(data.vatNumber !== undefined
      ? { vatNumber: emptyToNull(data.vatNumber) }
      : {}),
    ...(data.amka !== undefined ? { amka: emptyToNull(data.amka) } : {}),
    ...(data.ama !== undefined ? { ama: emptyToNull(data.ama) } : {}),
    ...(data.iban !== undefined ? { iban: emptyToNull(data.iban) } : {}),
    ...(data.birthDate !== undefined
      ? { birthDate: parseDate(data.birthDate) }
      : {}),
    ...(data.address !== undefined ? { address: emptyToNull(data.address) } : {}),
    ...(data.city !== undefined ? { city: emptyToNull(data.city) } : {}),
    ...(data.postalCode !== undefined
      ? { postalCode: emptyToNull(data.postalCode) }
      : {}),
    ...(data.nationality !== undefined
      ? { nationality: data.nationality || "GR" }
      : {}),
    ...(data.contractType !== undefined
      ? { contractType: data.contractType }
      : {}),
    ...(data.specialty !== undefined
      ? { specialty: emptyToNull(data.specialty) }
      : {}),
    ...(data.weeklyHours !== undefined
      ? {
          weeklyHours:
            data.weeklyHours == null
              ? null
              : new Prisma.Decimal(data.weeklyHours),
        }
      : {}),
    ...(data.baseGross !== undefined
      ? {
          baseGross:
            data.baseGross == null
              ? null
              : new Prisma.Decimal(data.baseGross),
        }
      : {}),
    ...(data.monthlyAllowance !== undefined
      ? {
          monthlyAllowance: new Prisma.Decimal(data.monthlyAllowance ?? 0),
        }
      : {}),
    ...(data.siteId !== undefined ? { siteId: emptyToNull(data.siteId) } : {}),
    ...(data.hireDate !== undefined ? { hireDate: parseDate(data.hireDate) } : {}),
    ...(data.terminationDate !== undefined
      ? { terminationDate: parseDate(data.terminationDate) }
      : {}),
    ...(data.erganiEmployeeId !== undefined
      ? { erganiEmployeeId: emptyToNull(data.erganiEmployeeId) }
      : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.notes !== undefined ? { notes: emptyToNull(data.notes) } : {}),
  };
}

export async function listEmployees(
  db: Db,
  tenantId: string,
  opts?: { q?: string; status?: string; take?: number },
) {
  const q = opts?.q?.trim();
  return db.employee.findMany({
    where: {
      tenantId,
      ...(opts?.status ? { status: opts.status as "ACTIVE" } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { vatNumber: { contains: q, mode: "insensitive" } },
              { amka: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { site: { select: { id: true, code: true, name: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: opts?.take ?? 200,
  });
}

export async function createEmployee(
  db: Db,
  input: { tenantId: string; data: EmployeeUpsertInput },
) {
  const existing = await db.employee.findUnique({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.data.code },
    },
  });
  if (existing) {
    throw new HrError(`Υπάρχει ήδη εργαζόμενος με κωδικό ${input.data.code}`, 409);
  }
  if (input.data.siteId) {
    const site = await db.site.findFirst({
      where: { id: input.data.siteId, tenantId: input.tenantId },
    });
    if (!site) throw new HrError("Η εγκατάσταση δεν βρέθηκε", 404);
  }

  const row = await db.employee.create({
    data: {
      tenantId: input.tenantId,
      code: input.data.code,
      firstName: input.data.firstName,
      lastName: input.data.lastName,
      email: emptyToNull(input.data.email),
      phone: emptyToNull(input.data.phone),
      title: emptyToNull(input.data.title),
      department: emptyToNull(input.data.department),
      vatNumber: emptyToNull(input.data.vatNumber),
      amka: emptyToNull(input.data.amka),
      ama: emptyToNull(input.data.ama),
      iban: emptyToNull(input.data.iban),
      birthDate: parseDate(input.data.birthDate),
      address: emptyToNull(input.data.address),
      city: emptyToNull(input.data.city),
      postalCode: emptyToNull(input.data.postalCode),
      nationality: input.data.nationality || "GR",
      contractType: input.data.contractType || "INDEFINITE",
      specialty: emptyToNull(input.data.specialty),
      weeklyHours:
        input.data.weeklyHours == null
          ? null
          : new Prisma.Decimal(input.data.weeklyHours),
      baseGross:
        input.data.baseGross == null
          ? null
          : new Prisma.Decimal(input.data.baseGross),
      monthlyAllowance: new Prisma.Decimal(input.data.monthlyAllowance ?? 0),
      siteId: emptyToNull(input.data.siteId),
      hireDate: parseDate(input.data.hireDate),
      terminationDate: parseDate(input.data.terminationDate),
      erganiEmployeeId: emptyToNull(input.data.erganiEmployeeId),
      status: input.data.status || "ACTIVE",
      notes: emptyToNull(input.data.notes),
    },
  });

  await enqueueErganiSubmission(db, {
    tenantId: input.tenantId,
    entityType: "employee",
    entityId: row.id,
    eventKind: "EMPLOYEE_HIRE",
    payload: {
      code: row.code,
      vatNumber: row.vatNumber,
      amka: row.amka,
      ama: row.ama,
      contractType: row.contractType,
      hireDate: row.hireDate?.toISOString() ?? null,
    },
  });

  try {
    const { seedOnboardingChecklist } = await import("./suite");
    await seedOnboardingChecklist(db, {
      tenantId: input.tenantId,
      employeeId: row.id,
    });
  } catch {
    /* checklist seed is best-effort */
  }

  return row;
}

export async function updateEmployee(
  db: Db,
  input: { tenantId: string; id: string; data: Partial<EmployeeUpsertInput> },
) {
  const row = await db.employee.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);

  if (input.data.code && input.data.code !== row.code) {
    const clash = await db.employee.findUnique({
      where: {
        tenantId_code: { tenantId: input.tenantId, code: input.data.code },
      },
    });
    if (clash) throw new HrError(`Υπάρχει ήδη κωδικός ${input.data.code}`, 409);
  }

  if (input.data.siteId) {
    const site = await db.site.findFirst({
      where: { id: input.data.siteId, tenantId: input.tenantId },
    });
    if (!site) throw new HrError("Η εγκατάσταση δεν βρέθηκε", 404);
  }

  const updated = await db.employee.update({
    where: { id: row.id },
    data: employeeData(input.data),
  });

  if (
    input.data.status === "TERMINATED" &&
    row.status !== "TERMINATED"
  ) {
    await enqueueErganiSubmission(db, {
      tenantId: input.tenantId,
      entityType: "employee",
      entityId: updated.id,
      eventKind: "EMPLOYEE_TERMINATION",
      payload: {
        code: updated.code,
        terminationDate: updated.terminationDate?.toISOString() ?? null,
      },
    });
  }

  return updated;
}

export async function ensureLeaveTypes(db: Db, tenantId: string) {
  for (const row of DEFAULT_LEAVE_TYPES) {
    await db.leaveType.upsert({
      where: { tenantId_code: { tenantId, code: row.code } },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        daysPerYear: row.daysPerYear,
        isPaid: row.isPaid,
        sortOrder: row.sortOrder,
        isSystem: true,
        isActive: true,
      },
      update: {},
    });
  }
}

export async function listLeaveTypes(db: Db, tenantId: string) {
  await ensureLeaveTypes(db, tenantId);
  return db.leaveType.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createLeaveType(
  db: Db,
  input: { tenantId: string; data: LeaveTypeUpsertInput },
) {
  await ensureLeaveTypes(db, input.tenantId);
  const existing = await db.leaveType.findUnique({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.data.code },
    },
  });
  if (existing) {
    throw new HrError(`Υπάρχει ήδη τύπος άδειας ${input.data.code}`, 409);
  }
  return db.leaveType.create({
    data: {
      tenantId: input.tenantId,
      code: input.data.code,
      name: input.data.name,
      daysPerYear: input.data.daysPerYear ?? 20,
      isPaid: input.data.isPaid ?? true,
      isActive: input.data.isActive ?? true,
      sortOrder: input.data.sortOrder ?? 100,
      isSystem: false,
    },
  });
}

export async function listLeaveRequests(
  db: Db,
  tenantId: string,
  opts?: { status?: string; take?: number },
) {
  await ensureLeaveTypes(db, tenantId);
  return db.leaveRequest.findMany({
    where: {
      tenantId,
      ...(opts?.status ? { status: opts.status as "PENDING" } : {}),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      leaveType: { select: { id: true, code: true, name: true, isPaid: true } },
    },
    orderBy: { fromDate: "desc" },
    take: opts?.take ?? 200,
  });
}

export async function createLeaveRequest(
  db: Db,
  input: { tenantId: string; data: LeaveRequestCreateInput },
) {
  await ensureLeaveTypes(db, input.tenantId);
  const employee = await db.employee.findFirst({
    where: { id: input.data.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);
  const leaveType = await db.leaveType.findFirst({
    where: { id: input.data.leaveTypeId, tenantId: input.tenantId, isActive: true },
  });
  if (!leaveType) throw new HrError("Ο τύπος άδειας δεν βρέθηκε", 404);

  const fromDate = parseDate(input.data.fromDate);
  const toDate = parseDate(input.data.toDate);
  if (!fromDate || !toDate) throw new HrError("Μη έγκυρες ημερομηνίες");
  if (toDate < fromDate) throw new HrError("Η λήξη πρέπει να είναι ≥ έναρξη");

  const halfDay = Boolean(input.data.halfDay);
  if (halfDay && ymdLocal(fromDate) !== ymdLocal(toDate)) {
    throw new HrError("Η μισή ημέρα ισχύει μόνο για μονοήμερη άδεια");
  }
  const days =
    input.data.days ??
    (halfDay ? 0.5 : businessDaysInclusive(fromDate, toDate));

  await assertLeaveRequestAllowed(db, {
    tenantId: input.tenantId,
    employeeId: employee.id,
    fromDate,
    toDate,
    leaveTypeId: leaveType.id,
    days,
    year: fromDate.getUTCFullYear(),
  });

  return db.leaveRequest.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      fromDate,
      toDate,
      days: new Prisma.Decimal(days),
      halfDay,
      status: "PENDING",
      notes: emptyToNull(input.data.notes),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      leaveType: { select: { id: true, code: true, name: true, isPaid: true } },
    },
  });
}

function ymdLocal(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function decideLeaveRequest(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    status: "APPROVED" | "REJECTED" | "CANCELLED";
    notes?: string | null;
  },
) {
  const row = await db.leaveRequest.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new HrError("Η αίτηση άδειας δεν βρέθηκε", 404);
  if (row.status === "CANCELLED") {
    throw new HrError("Η αίτηση έχει ήδη ακυρωθεί");
  }
  if (row.status === "APPROVED" && input.status !== "CANCELLED") {
    throw new HrError("Η αίτηση είναι ήδη εγκεκριμένη");
  }

  const updated = await db.leaveRequest.update({
    where: { id: row.id },
    data: {
      status: input.status,
      decidedAt: new Date(),
      notes: input.notes !== undefined ? emptyToNull(input.notes) : row.notes,
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      leaveType: { select: { id: true, code: true, name: true, isPaid: true } },
    },
  });

  if (input.status === "APPROVED") {
    await enqueueErganiSubmission(db, {
      tenantId: input.tenantId,
      entityType: "leave_request",
      entityId: updated.id,
      eventKind: "LEAVE_DECLARE",
      payload: {
        employeeId: updated.employeeId,
        employeeCode: updated.employee.code,
        leaveType: updated.leaveType.code,
        fromDate: updated.fromDate.toISOString(),
        toDate: updated.toDate.toISOString(),
        days: Number(updated.days),
      },
    });
  }

  return updated;
}

/** Υπόλοιπα αδειών έτους ανά εργαζόμενο / τύπο */
export async function loadLeaveBalances(
  db: Db,
  tenantId: string,
  opts?: { year?: number; employeeId?: string },
) {
  await ensureLeaveTypes(db, tenantId);
  const year = opts?.year ?? new Date().getFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const [types, employees, approved, adjustments] = await Promise.all([
    db.leaveType.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.employee.findMany({
      where: {
        tenantId,
        status: { in: ["ACTIVE", "INACTIVE"] },
        ...(opts?.employeeId ? { id: opts.employeeId } : {}),
      },
      select: {
        id: true,
        code: true,
        firstName: true,
        lastName: true,
        status: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 500,
    }),
    db.leaveRequest.findMany({
      where: {
        tenantId,
        status: "APPROVED",
        fromDate: { lte: to },
        toDate: { gte: from },
        ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}),
      },
      select: {
        employeeId: true,
        leaveTypeId: true,
        days: true,
      },
    }),
    db.leaveBalanceAdjustment.findMany({
      where: {
        tenantId,
        year,
        ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}),
      },
      select: { employeeId: true, leaveTypeId: true, days: true },
    }),
  ]);

  const usedMap = new Map<string, number>();
  for (const r of approved) {
    const key = `${r.employeeId}:${r.leaveTypeId}`;
    usedMap.set(key, (usedMap.get(key) ?? 0) + Number(r.days));
  }
  const adjMap = new Map<string, number>();
  for (const a of adjustments) {
    const key = `${a.employeeId}:${a.leaveTypeId}`;
    adjMap.set(key, (adjMap.get(key) ?? 0) + Number(a.days));
  }

  return employees.map((e) => ({
    employee: e,
    year,
    balances: types.map((t) => {
      const used = usedMap.get(`${e.id}:${t.id}`) ?? 0;
      const adjustment = adjMap.get(`${e.id}:${t.id}`) ?? 0;
      const entitlement = t.daysPerYear + adjustment;
      return {
        leaveTypeId: t.id,
        code: t.code,
        name: t.name,
        isPaid: t.isPaid,
        entitlement: Math.round(entitlement * 100) / 100,
        adjustment: Math.round(adjustment * 100) / 100,
        used,
        remaining: Math.max(0, Math.round((entitlement - used) * 100) / 100),
      };
    }),
  }));
}


function newQrToken() {
  return randomBytes(16).toString("hex");
}

export { parseWorkCardQr, workCardQrPayload } from "./work-card-qr";

type PunchType = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";

export function suggestNextPunchType(
  lastType: PunchType | null | undefined,
): PunchType {
  if (!lastType || lastType === "CLOCK_OUT") return "CLOCK_IN";
  if (lastType === "CLOCK_IN") return "CLOCK_OUT";
  if (lastType === "BREAK_START") return "BREAK_END";
  return "CLOCK_OUT"; // BREAK_END
}

export function assertPunchTransition(
  lastType: PunchType | null | undefined,
  next: PunchType,
) {
  const allowed: PunchType[] =
    !lastType || lastType === "CLOCK_OUT"
      ? ["CLOCK_IN"]
      : lastType === "CLOCK_IN"
        ? ["CLOCK_OUT", "BREAK_START"]
        : lastType === "BREAK_START"
          ? ["BREAK_END"]
          : ["CLOCK_OUT", "BREAK_START"]; // BREAK_END
  if (!allowed.includes(next)) {
    throw new HrError(
      `Μη έγκυρη μετάβαση παρουσίας: ${lastType ?? "—"} → ${next}`,
      400,
    );
  }
}

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function dayBounds(d = new Date()) {
  const from = new Date(d);
  from.setHours(0, 0, 0, 0);
  const to = new Date(d);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function parseHmToMinutes(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

async function resolveScheduleTimes(
  db: Db,
  tenantId: string,
  employeeId: string,
  at: Date,
) {
  const dayStart = new Date(at);
  dayStart.setHours(0, 0, 0, 0);
  const assignment = await db.workScheduleAssignment.findFirst({
    where: {
      tenantId,
      employeeId,
      fromDate: { lte: dayStart },
      OR: [{ toDate: null }, { toDate: { gte: dayStart } }],
    },
    include: { schedule: true },
    orderBy: { fromDate: "desc" },
  });
  if (!assignment?.schedule) return null;
  return {
    startTime: assignment.schedule.startTime,
    endTime: assignment.schedule.endTime,
    workDays: assignment.schedule.workDays,
  };
}

async function ensureCardQrToken(
  db: Db,
  card: { id: string; qrToken: string | null },
) {
  if (card.qrToken) return card.qrToken;
  const qrToken = newQrToken();
  await db.workCard.update({
    where: { id: card.id },
    data: { qrToken },
  });
  return qrToken;
}

export async function listWorkCards(db: Db, tenantId: string) {
  const cards = await db.workCard.findMany({
    where: { tenantId },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
  // Backfill QR tokens for older cards
  for (const c of cards) {
    if (!c.qrToken) {
      c.qrToken = await ensureCardQrToken(db, c);
    }
  }
  return cards;
}

export async function updateWorkCardStatus(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    status: "ACTIVE" | "INACTIVE" | "LOST";
    notes?: string | null;
  },
) {
  const card = await db.workCard.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
  });
  if (!card) throw new HrError("Η κάρτα δεν βρέθηκε", 404);

  const updated = await db.workCard.update({
    where: { id: card.id },
    data: {
      status: input.status,
      ...(input.notes !== undefined ? { notes: emptyToNull(input.notes) } : {}),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
  });

  if (input.status !== card.status) {
    await enqueueErganiSubmission(db, {
      tenantId: input.tenantId,
      entityType: "work_card",
      entityId: updated.id,
      eventKind:
        input.status === "LOST"
          ? "CARD_LOST"
          : input.status === "INACTIVE"
            ? "CARD_DEACTIVATE"
            : "CARD_REACTIVATE",
      payload: {
        cardNumber: updated.cardNumber,
        status: updated.status,
        employeeCode: updated.employee.code,
      },
    });
  }

  return updated;
}

export async function createWorkCard(
  db: Db,
  input: { tenantId: string; data: WorkCardCreateInput },
) {
  const employee = await db.employee.findFirst({
    where: { id: input.data.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);

  const existing = await db.workCard.findUnique({
    where: {
      tenantId_cardNumber: {
        tenantId: input.tenantId,
        cardNumber: input.data.cardNumber.trim(),
      },
    },
  });
  if (existing) throw new HrError("Ο αριθμός κάρτας υπάρχει ήδη", 409);

  const card = await db.workCard.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      cardNumber: input.data.cardNumber.trim(),
      qrToken: newQrToken(),
      status: input.data.status ?? "ACTIVE",
      notes: emptyToNull(input.data.notes),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
  });

  await enqueueErganiSubmission(db, {
    tenantId: input.tenantId,
    entityType: "work_card",
    entityId: card.id,
    eventKind: "CARD_ISSUE",
    payload: {
      cardNumber: card.cardNumber,
      employeeId: employee.id,
      employeeCode: employee.code,
      qr: workCardQrPayload(card.qrToken!),
    },
  });

  return card;
}

export async function listWorkCardEvents(
  db: Db,
  tenantId: string,
  opts?: { take?: number; day?: "today" | "all"; from?: Date; to?: Date },
) {
  const range =
    opts?.day === "today"
      ? dayBounds()
      : opts?.from && opts?.to
        ? { from: opts.from, to: opts.to }
        : null;
  return db.workCardEvent.findMany({
    where: {
      tenantId,
      ...(range
        ? { occurredAt: { gte: range.from, lte: range.to } }
        : {}),
    },
    include: {
      employee: {
        select: {
          id: true,
          code: true,
          firstName: true,
          lastName: true,
          department: true,
          title: true,
        },
      },
      workCard: { select: { id: true, cardNumber: true, qrToken: true } },
      site: { select: { id: true, code: true, name: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: opts?.take ?? 200,
  });
}

export async function loadLiveAttendance(db: Db, tenantId: string) {
  const { from, to } = dayBounds();
  const employees = await db.employee.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      firstName: true,
      lastName: true,
      department: true,
      title: true,
      siteId: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 500,
  });
  const events = await db.workCardEvent.findMany({
    where: { tenantId, occurredAt: { gte: from, lte: to } },
    orderBy: { occurredAt: "asc" },
    select: {
      id: true,
      employeeId: true,
      type: true,
      occurredAt: true,
      isLate: true,
      isEarly: true,
      siteId: true,
      source: true,
    },
  });
  const byEmp = new Map<string, typeof events>();
  for (const e of events) {
    const list = byEmp.get(e.employeeId) ?? [];
    list.push(e);
    byEmp.set(e.employeeId, list);
  }

  const rows = employees.map((emp) => {
    const todays = byEmp.get(emp.id) ?? [];
    const last = todays[todays.length - 1] ?? null;
    let presence: "OUT" | "IN" | "BREAK" = "OUT";
    if (last?.type === "CLOCK_IN" || last?.type === "BREAK_END") presence = "IN";
    if (last?.type === "BREAK_START") presence = "BREAK";
    const clockIn = todays.find((e) => e.type === "CLOCK_IN") ?? null;
    const clockOut =
      [...todays].reverse().find((e) => e.type === "CLOCK_OUT") ?? null;
    return {
      employee: emp,
      presence,
      lastType: last?.type ?? null,
      lastAt: last?.occurredAt.toISOString() ?? null,
      clockInAt: clockIn?.occurredAt.toISOString() ?? null,
      clockOutAt: clockOut?.occurredAt.toISOString() ?? null,
      isLate: todays.some((e) => e.isLate),
      isEarly: todays.some((e) => e.isEarly),
      punchCount: todays.length,
      suggestedNext: suggestNextPunchType(
        (last?.type as PunchType | undefined) ?? null,
      ),
    };
  });

  const summary = {
    total: rows.length,
    in: rows.filter((r) => r.presence === "IN").length,
    break: rows.filter((r) => r.presence === "BREAK").length,
    out: rows.filter((r) => r.presence === "OUT").length,
    late: rows.filter((r) => r.isLate).length,
    punchesToday: events.length,
  };

  return { day: from.toISOString().slice(0, 10), summary, rows };
}

export async function createWorkCardEvent(
  db: Db,
  input: { tenantId: string; data: WorkCardEventCreateInput },
) {
  const employee = await db.employee.findFirst({
    where: { id: input.data.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);
  if (employee.status === "TERMINATED") {
    throw new HrError("Ο εργαζόμενος έχει αποχωρήσει", 400);
  }

  let workCardId = emptyToNull(input.data.workCardId);
  if (!workCardId) {
    const active = await db.workCard.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeId: employee.id,
        status: "ACTIVE",
      },
      orderBy: { issuedAt: "desc" },
    });
    workCardId = active?.id ?? null;
  } else {
    const card = await db.workCard.findFirst({
      where: {
        id: workCardId,
        tenantId: input.tenantId,
        employeeId: employee.id,
      },
    });
    if (!card) throw new HrError("Η κάρτα εργασίας δεν βρέθηκε", 404);
    if (card.status !== "ACTIVE") {
      throw new HrError("Η κάρτα δεν είναι ενεργή", 400);
    }
  }

  let site:
    | { id: string; lat: number | null; lng: number | null; geoRadiusM: number | null }
    | null = null;
  if (input.data.siteId) {
    site = await db.site.findFirst({
      where: { id: input.data.siteId, tenantId: input.tenantId },
      select: { id: true, lat: true, lng: true, geoRadiusM: true },
    });
    if (!site) throw new HrError("Η εγκατάσταση δεν βρέθηκε", 404);
  }

  const occurredAt = input.data.occurredAt
    ? parseDate(input.data.occurredAt) ?? new Date()
    : new Date();

  const { from } = dayBounds(occurredAt);
  const lastToday = await db.workCardEvent.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      occurredAt: { gte: from, lte: occurredAt },
    },
    orderBy: { occurredAt: "desc" },
    select: { type: true },
  });

  const source = input.data.source ?? "MANUAL";
  const enforce =
    input.data.enforceState ?? (source === "CARD" || source === "APP");
  if (enforce) {
    assertPunchTransition(
      (lastToday?.type as PunchType | undefined) ?? null,
      input.data.type,
    );
  }

  // Late / early vs schedule
  let isLate = false;
  let isEarly = false;
  const sched = await resolveScheduleTimes(
    db,
    input.tenantId,
    employee.id,
    occurredAt,
  );
  if (sched) {
    const mins = occurredAt.getHours() * 60 + occurredAt.getMinutes();
    const start = parseHmToMinutes(sched.startTime);
    const end = parseHmToMinutes(sched.endTime);
    if (input.data.type === "CLOCK_IN" && mins > start + 5) isLate = true;
    if (input.data.type === "CLOCK_OUT" && mins < end - 5) isEarly = true;
  }

  // Geofence stub
  let withinGeofence: boolean | null = null;
  const lat = input.data.lat ?? null;
  const lng = input.data.lng ?? null;
  if (
    lat != null &&
    lng != null &&
    site?.lat != null &&
    site?.lng != null &&
    site.geoRadiusM
  ) {
    const dist = haversineM(lat, lng, site.lat, site.lng);
    withinGeofence = dist <= site.geoRadiusM;
  }

  const event = await db.workCardEvent.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      workCardId,
      type: input.data.type,
      source,
      occurredAt,
      siteId: site?.id ?? null,
      note: emptyToNull(input.data.note),
      lat,
      lng,
      accuracyM: input.data.accuracyM ?? null,
      withinGeofence,
      isLate,
      isEarly,
      erganiStatus: "PENDING",
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      workCard: { select: { id: true, cardNumber: true, qrToken: true } },
      site: { select: { id: true, code: true, name: true } },
    },
  });

  if (input.data.enqueueErgani !== false) {
    await enqueueErganiSubmission(db, {
      tenantId: input.tenantId,
      entityType: "work_card_event",
      entityId: event.id,
      eventKind: `CARD_${input.data.type}`,
      payload: {
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
        employeeId: employee.id,
        employeeCode: employee.code,
        cardNumber: event.workCard?.cardNumber ?? null,
        siteId: event.siteId,
        isLate,
        isEarly,
        source,
      },
    });
  }

  return event;
}

/** QR / κάρτα scan → punch με auto check-in/out */
export async function punchByWorkCardQr(
  db: Db,
  input: { tenantId: string; data: WorkCardScanInput },
) {
  const tokenOrNumber = parseWorkCardQr(input.data.qr);
  const card =
    (await db.workCard.findFirst({
      where: {
        tenantId: input.tenantId,
        OR: [{ qrToken: tokenOrNumber }, { cardNumber: tokenOrNumber }],
      },
      include: {
        employee: {
          select: {
            id: true,
            code: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        },
      },
    })) ?? null;
  if (!card) throw new HrError("Κάρτα / QR δεν αναγνωρίστηκε", 404);
  if (card.status !== "ACTIVE") {
    throw new HrError(`Η κάρτα είναι ${card.status}`, 400);
  }
  if (card.employee.status !== "ACTIVE") {
    throw new HrError("Ο εργαζόμενος δεν είναι ενεργός", 400);
  }
  if (!card.qrToken) {
    await ensureCardQrToken(db, card);
  }

  const { from } = dayBounds();
  const lastToday = await db.workCardEvent.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: card.employeeId,
      occurredAt: { gte: from },
    },
    orderBy: { occurredAt: "desc" },
    select: { type: true },
  });

  const type: PunchType =
    !input.data.type || input.data.type === "AUTO"
      ? suggestNextPunchType((lastToday?.type as PunchType | undefined) ?? null)
      : input.data.type;

  const event = await createWorkCardEvent(db, {
    tenantId: input.tenantId,
    data: {
      employeeId: card.employeeId,
      workCardId: card.id,
      type,
      source: "CARD",
      siteId: input.data.siteId ?? null,
      note: input.data.note ?? null,
      lat: input.data.lat ?? null,
      lng: input.data.lng ?? null,
      accuracyM: input.data.accuracyM ?? null,
      enqueueErgani: input.data.enqueueErgani ?? true,
      enforceState: true,
    },
  });

  return {
    event,
    employee: card.employee,
    card: {
      id: card.id,
      cardNumber: card.cardNumber,
      qrToken: card.qrToken,
    },
    suggestedWas: type,
    presenceAfter:
      type === "CLOCK_OUT"
        ? ("OUT" as const)
        : type === "BREAK_START"
          ? ("BREAK" as const)
          : ("IN" as const),
  };
}

type ErganiEnv = "simulator" | "test" | "prod";

async function resolveErganiEnv(db: Db, tenantId: string): Promise<ErganiEnv> {
  const settings = await db.tenantSettings.findUnique({
    where: { tenantId },
    select: { integrationsJson: true },
  });
  const json =
    (settings?.integrationsJson as { erganiEnv?: ErganiEnv } | null) ?? {};
  return json.erganiEnv ?? "simulator";
}

export async function enqueueErganiSubmission(
  db: Db,
  input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    eventKind: string;
    payload?: Prisma.InputJsonValue;
  },
) {
  const existing = await db.erganiSubmission.findFirst({
    where: {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventKind: input.eventKind,
      status: { in: ["PENDING", "SENT", "ACCEPTED"] },
    },
  });
  if (existing) return existing;

  return db.erganiSubmission.create({
    data: {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventKind: input.eventKind,
      status: "PENDING",
      payload: input.payload ?? undefined,
    },
  });
}

export async function listErganiSubmissions(
  db: Db,
  tenantId: string,
  opts?: { status?: string; take?: number },
) {
  return db.erganiSubmission.findMany({
    where: {
      tenantId,
      ...(opts?.status ? { status: opts.status as "PENDING" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts?.take ?? 200,
  });
}

export async function processErganiSubmission(
  db: Db,
  input: { tenantId: string; id: string; forceReject?: boolean },
) {
  const row = await db.erganiSubmission.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new HrError("Η δήλωση Εργάνη δεν βρέθηκε", 404);
  if (row.status === "ACCEPTED" || row.status === "CANCELLED") return row;

  const env = await resolveErganiEnv(db, input.tenantId);
  const now = new Date();
  const attempts = row.attempts + 1;

  if (row.status === "PENDING") {
    await db.erganiSubmission.update({
      where: { id: row.id },
      data: { status: "SENT", attempts, processedAt: now },
    });
  }

  if (input.forceReject || (env === "test" && attempts % 7 === 0)) {
    const rejected = await db.erganiSubmission.update({
      where: { id: row.id },
      data: {
        status: "REJECTED",
        attempts,
        lastError: "Προσομοίωση απόρριψης Εργάνη (validation)",
        processedAt: now,
      },
    });
    if (row.entityType === "work_card_event") {
      await db.workCardEvent.updateMany({
        where: { id: row.entityId, tenantId: input.tenantId },
        data: { erganiStatus: "REJECTED" },
      });
    }
    return rejected;
  }

  const prefix =
    env === "test" ? "ERG-TEST" : "ERG-SIM";

  // Prod without live client must fail closed — never fake ACCEPTED.
  if (env === "prod") {
    const rejected = await db.erganiSubmission.update({
      where: { id: row.id },
      data: {
        status: "REJECTED",
        attempts,
        lastError:
          "Ergani live client δεν είναι συνδεδεμένος — βάλε simulator/test ή σύνδεσε client",
        processedAt: now,
        payload: {
          ...((row.payload as object) ?? {}),
          mode: env,
          accepted: false,
          failClosed: true,
        } as Prisma.InputJsonValue,
      },
    });
    if (row.entityType === "work_card_event") {
      await db.workCardEvent.updateMany({
        where: { id: row.entityId, tenantId: input.tenantId },
        data: { erganiStatus: "REJECTED" },
      });
    }
    return rejected;
  }

  const externalRef = `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${row.id.slice(-8).toUpperCase()}`;

  const accepted = await db.erganiSubmission.update({
    where: { id: row.id },
    data: {
      status: "ACCEPTED",
      attempts,
      externalRef,
      lastError: null,
      processedAt: now,
      payload: {
        ...((row.payload as object) ?? {}),
        mode: env,
        accepted: true,
        externalRef,
        note: "Local Ergani simulator (ψηφιακή κάρτα εργασίας)",
      } as Prisma.InputJsonValue,
    },
  });

  if (row.entityType === "work_card_event") {
    await db.workCardEvent.updateMany({
      where: { id: row.entityId, tenantId: input.tenantId },
      data: { erganiStatus: "ACCEPTED" },
    });
  }
  if (row.entityType === "employee" && row.eventKind === "EMPLOYEE_HIRE") {
    await db.employee.updateMany({
      where: {
        id: row.entityId,
        tenantId: input.tenantId,
        erganiEmployeeId: null,
      },
      data: { erganiEmployeeId: externalRef },
    });
  }

  return accepted;
}

export async function processPendingErganiBatch(
  db: Db,
  input: { tenantId: string; limit?: number },
) {
  const pending = await db.erganiSubmission.findMany({
    where: {
      tenantId: input.tenantId,
      status: { in: ["PENDING", "SENT", "REJECTED"] },
    },
    orderBy: { createdAt: "asc" },
    take: input.limit ?? 25,
    select: { id: true },
  });
  const results = [];
  for (const p of pending) {
    results.push(
      await processErganiSubmission(db, {
        tenantId: input.tenantId,
        id: p.id,
      }),
    );
  }
  return results;
}

export async function listPayrollPeriods(db: Db, tenantId: string) {
  return db.payrollPeriod.findMany({
    where: { tenantId },
    include: {
      _count: { select: { lines: true } },
      lines: {
        select: {
          gross: true,
          net: true,
          employeeEfka: true,
          employerEfka: true,
          tax: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 48,
  });
}

export async function getPayrollPeriod(
  db: Db,
  tenantId: string,
  id: string,
) {
  return db.payrollPeriod.findFirst({
    where: { id, tenantId },
    include: {
      lines: {
        include: {
          employee: {
            select: {
              id: true,
              code: true,
              firstName: true,
              lastName: true,
              vatNumber: true,
              ama: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function createPayrollPeriod(
  db: Db,
  input: { tenantId: string; data: PayrollPeriodCreateInput },
) {
  const { year, month } = input.data;
  const code = `${year}-${String(month).padStart(2, "0")}`;
  const existing = await db.payrollPeriod.findUnique({
    where: { tenantId_year_month: { tenantId: input.tenantId, year, month } },
  });
  if (existing) throw new HrError(`Υπάρχει ήδη περίοδος ${code}`, 409);

  const fromDate = new Date(Date.UTC(year, month - 1, 1));
  const toDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const defaultGross = input.data.defaultGross ?? 1200;

  const employees = await db.employee.findMany({
    where: { tenantId: input.tenantId, status: "ACTIVE" },
    select: { id: true, baseGross: true, monthlyAllowance: true },
  });

  const settings = await db.tenantSettings.findUnique({
    where: { tenantId: input.tenantId },
    select: { integrationsJson: true },
  });
  const rates = readPayrollRates(settings?.integrationsJson);

  return db.payrollPeriod.create({
    data: {
      tenantId: input.tenantId,
      code,
      year,
      month,
      fromDate,
      toDate,
      notes: emptyToNull(input.data.notes),
      status: "DRAFT",
      lines: {
        create: employees.map((e) => {
          const base = e.baseGross != null ? Number(e.baseGross) : defaultGross;
          const allowance = Number(e.monthlyAllowance ?? 0);
          const gross = Math.round((base + allowance) * 100) / 100;
          const splits = estimatePayrollSplits(gross, rates);
          return {
            tenantId: input.tenantId,
            employeeId: e.id,
            gross: new Prisma.Decimal(gross),
            employeeEfka: new Prisma.Decimal(splits.employeeEfka),
            employerEfka: new Prisma.Decimal(splits.employerEfka),
            tax: new Prisma.Decimal(splits.tax),
            net: new Prisma.Decimal(splits.net),
          };
        }),
      },
    },
    include: {
      lines: {
        include: {
          employee: {
            select: {
              id: true,
              code: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });
}

export async function closePayrollPeriod(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const period = await db.payrollPeriod.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!period) throw new HrError("Η περίοδος μισθοδοσίας δεν βρέθηκε", 404);
  if (period.status === "CLOSED") return period;
  return db.payrollPeriod.update({
    where: { id: period.id },
    data: { status: "CLOSED" },
  });
}

export async function upsertPayrollLine(
  db: Db,
  input: {
    tenantId: string;
    periodId: string;
    employeeId: string;
    gross: number;
    notes?: string | null;
  },
) {
  const period = await db.payrollPeriod.findFirst({
    where: { id: input.periodId, tenantId: input.tenantId },
  });
  if (!period) throw new HrError("Η περίοδος δεν βρέθηκε", 404);
  if (period.status === "CLOSED") {
    throw new HrError("Η περίοδος είναι κλειστή — δεν αλλάζει");
  }
  const employee = await db.employee.findFirst({
    where: { id: input.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);

  const settings = await db.tenantSettings.findUnique({
    where: { tenantId: input.tenantId },
    select: { integrationsJson: true },
  });
  const rates = readPayrollRates(settings?.integrationsJson);
  const splits = estimatePayrollSplits(input.gross, rates);
  return db.payrollLine.upsert({
    where: {
      periodId_employeeId: {
        periodId: period.id,
        employeeId: employee.id,
      },
    },
    create: {
      tenantId: input.tenantId,
      periodId: period.id,
      employeeId: employee.id,
      gross: new Prisma.Decimal(input.gross),
      employeeEfka: new Prisma.Decimal(splits.employeeEfka),
      employerEfka: new Prisma.Decimal(splits.employerEfka),
      tax: new Prisma.Decimal(splits.tax),
      net: new Prisma.Decimal(splits.net),
      notes: emptyToNull(input.notes),
    },
    update: {
      gross: new Prisma.Decimal(input.gross),
      employeeEfka: new Prisma.Decimal(splits.employeeEfka),
      employerEfka: new Prisma.Decimal(splits.employerEfka),
      tax: new Prisma.Decimal(splits.tax),
      net: new Prisma.Decimal(splits.net),
      notes: emptyToNull(input.notes),
    },
    include: {
      employee: {
        select: {
          id: true,
          code: true,
          firstName: true,
          lastName: true,
          vatNumber: true,
          ama: true,
        },
      },
    },
  });
}

export async function listWorkSchedules(db: Db, tenantId: string) {
  return db.workSchedule.findMany({
    where: { tenantId },
    include: {
      _count: { select: { assignments: true } },
    },
    orderBy: { code: "asc" },
    take: 100,
  });
}

export async function createWorkSchedule(
  db: Db,
  input: { tenantId: string; data: WorkScheduleUpsertInput },
) {
  const existing = await db.workSchedule.findUnique({
    where: {
      tenantId_code: { tenantId: input.tenantId, code: input.data.code },
    },
  });
  if (existing) throw new HrError(`Υπάρχει ωράριο ${input.data.code}`, 409);
  return db.workSchedule.create({
    data: {
      tenantId: input.tenantId,
      code: input.data.code,
      name: input.data.name,
      workDays: input.data.workDays ?? 31,
      startTime: input.data.startTime ?? "09:00",
      endTime: input.data.endTime ?? "17:00",
      breakMinutes: input.data.breakMinutes ?? 30,
      weeklyHours: new Prisma.Decimal(input.data.weeklyHours ?? 40),
      isActive: input.data.isActive ?? true,
      notes: emptyToNull(input.data.notes),
    },
  });
}

export async function assignWorkSchedule(
  db: Db,
  input: { tenantId: string; data: WorkScheduleAssignInput },
) {
  const [employee, schedule] = await Promise.all([
    db.employee.findFirst({
      where: { id: input.data.employeeId, tenantId: input.tenantId },
    }),
    db.workSchedule.findFirst({
      where: { id: input.data.scheduleId, tenantId: input.tenantId },
    }),
  ]);
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);
  if (!schedule) throw new HrError("Το ωράριο δεν βρέθηκε", 404);

  const fromDate = parseDate(input.data.fromDate);
  if (!fromDate) throw new HrError("Μη έγκυρη ημερομηνία έναρξης");
  const toDate = parseDate(input.data.toDate);

  return db.workScheduleAssignment.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      scheduleId: schedule.id,
      fromDate,
      toDate,
      notes: emptyToNull(input.data.notes),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      schedule: {
        select: {
          id: true,
          code: true,
          name: true,
          startTime: true,
          endTime: true,
          workDays: true,
        },
      },
    },
  });
}

export async function listScheduleAssignments(db: Db, tenantId: string) {
  return db.workScheduleAssignment.findMany({
    where: { tenantId },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      schedule: {
        select: {
          id: true,
          code: true,
          name: true,
          startTime: true,
          endTime: true,
          workDays: true,
        },
      },
    },
    orderBy: { fromDate: "desc" },
    take: 200,
  });
}

export async function listWorkShifts(
  db: Db,
  tenantId: string,
  opts?: { from?: string; to?: string; take?: number },
) {
  const from = opts?.from ? parseDate(opts.from) : null;
  const to = opts?.to ? parseDate(opts.to) : null;
  return db.workShift.findMany({
    where: {
      tenantId,
      ...(from || to
        ? {
            workDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      site: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ workDate: "desc" }, { startTime: "asc" }],
    take: opts?.take ?? 200,
  });
}

export async function createWorkShift(
  db: Db,
  input: { tenantId: string; data: WorkShiftCreateInput },
) {
  const employee = await db.employee.findFirst({
    where: { id: input.data.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);
  const workDate = parseDate(input.data.workDate);
  if (!workDate) throw new HrError("Μη έγκυρη ημερομηνία");
  if (input.data.siteId) {
    const site = await db.site.findFirst({
      where: { id: input.data.siteId, tenantId: input.tenantId },
    });
    if (!site) throw new HrError("Η εγκατάσταση δεν βρέθηκε", 404);
  }

  try {
    return await db.workShift.create({
      data: {
        tenantId: input.tenantId,
        employeeId: employee.id,
        workDate,
        startTime: input.data.startTime,
        endTime: input.data.endTime,
        breakMinutes: input.data.breakMinutes ?? 0,
        kind: input.data.kind ?? "REGULAR",
        siteId: emptyToNull(input.data.siteId),
        notes: emptyToNull(input.data.notes),
      },
      include: {
        employee: {
          select: { id: true, code: true, firstName: true, lastName: true },
        },
        site: { select: { id: true, code: true, name: true } },
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new HrError("Υπάρχει ήδη βάρδια για αυτή την έναρξη", 409);
    }
    throw err;
  }
}

export function serializeEmployee(e: {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  department: string | null;
  vatNumber: string | null;
  amka: string | null;
  ama: string | null;
  iban: string | null;
  birthDate: Date | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  nationality: string;
  contractType: string;
  specialty: string | null;
  weeklyHours: Prisma.Decimal | null;
  baseGross?: Prisma.Decimal | null;
  monthlyAllowance?: Prisma.Decimal | null;
  siteId: string | null;
  hireDate: Date | null;
  terminationDate: Date | null;
  erganiEmployeeId: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  site?: { id: string; code: string; name: string } | null;
}) {
  return {
    id: e.id,
    code: e.code,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    title: e.title,
    department: e.department,
    vatNumber: e.vatNumber,
    amka: e.amka,
    ama: e.ama,
    iban: e.iban,
    birthDate: e.birthDate?.toISOString() ?? null,
    address: e.address,
    city: e.city,
    postalCode: e.postalCode,
    nationality: e.nationality,
    contractType: e.contractType,
    specialty: e.specialty,
    weeklyHours: e.weeklyHours == null ? null : Number(e.weeklyHours),
    baseGross: e.baseGross == null ? null : Number(e.baseGross),
    monthlyAllowance:
      e.monthlyAllowance == null ? 0 : Number(e.monthlyAllowance),
    siteId: e.siteId,
    site: e.site ?? null,
    hireDate: e.hireDate?.toISOString() ?? null,
    terminationDate: e.terminationDate?.toISOString() ?? null,
    erganiEmployeeId: e.erganiEmployeeId,
    status: e.status,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
