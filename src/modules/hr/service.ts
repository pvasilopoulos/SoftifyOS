import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_LEAVE_TYPES } from "./labels";
import type {
  EmployeeUpsertInput,
  LeaveRequestCreateInput,
  LeaveTypeUpsertInput,
  PayrollPeriodCreateInput,
  WorkCardCreateInput,
  WorkCardEventCreateInput,
} from "./schemas";

type Db = PrismaClient | Prisma.TransactionClient;

export class HrError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

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

/** Indicative Greek payroll split (EFKA employee ~13.87%, employer ~22.12%, tax ~10%) */
export function estimatePayrollSplits(gross: number) {
  const employeeEfka = Math.round(gross * 0.1387 * 100) / 100;
  const employerEfka = Math.round(gross * 0.2212 * 100) / 100;
  const tax = Math.round(gross * 0.1 * 100) / 100;
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

  const days =
    input.data.days ?? businessDaysInclusive(fromDate, toDate);

  return db.leaveRequest.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      fromDate,
      toDate,
      days: new Prisma.Decimal(days),
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

  return db.leaveRequest.update({
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
}

export async function listWorkCards(db: Db, tenantId: string) {
  return db.workCard.findMany({
    where: { tenantId },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
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
    },
  });

  return card;
}

export async function listWorkCardEvents(
  db: Db,
  tenantId: string,
  opts?: { take?: number },
) {
  return db.workCardEvent.findMany({
    where: { tenantId },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      workCard: { select: { id: true, cardNumber: true } },
      site: { select: { id: true, code: true, name: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: opts?.take ?? 200,
  });
}

export async function createWorkCardEvent(
  db: Db,
  input: { tenantId: string; data: WorkCardEventCreateInput },
) {
  const employee = await db.employee.findFirst({
    where: { id: input.data.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);

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
  }

  if (input.data.siteId) {
    const site = await db.site.findFirst({
      where: { id: input.data.siteId, tenantId: input.tenantId },
    });
    if (!site) throw new HrError("Η εγκατάσταση δεν βρέθηκε", 404);
  }

  const occurredAt = input.data.occurredAt
    ? parseDate(input.data.occurredAt) ?? new Date()
    : new Date();

  const event = await db.workCardEvent.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      workCardId,
      type: input.data.type,
      source: input.data.source ?? "MANUAL",
      occurredAt,
      siteId: emptyToNull(input.data.siteId),
      note: emptyToNull(input.data.note),
      erganiStatus: "PENDING",
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      workCard: { select: { id: true, cardNumber: true } },
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
      },
    });
  }

  return event;
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
    env === "prod" ? "ERG-STUB" : env === "test" ? "ERG-TEST" : "ERG-SIM";
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
        note:
          env === "prod"
            ? "Stub — δεν υπάρχει ακόμα live Ergani client"
            : "Local simulator (ψηφιακή κάρτα εργασίας)",
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
    select: { id: true },
  });

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
          const splits = estimatePayrollSplits(defaultGross);
          return {
            tenantId: input.tenantId,
            employeeId: e.id,
            gross: new Prisma.Decimal(defaultGross),
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
