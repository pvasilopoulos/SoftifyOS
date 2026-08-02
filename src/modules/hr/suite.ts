import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_ONBOARDING_TASKS } from "./labels";
import type {
  ChecklistItemCreateInput,
  ChecklistItemPatchInput,
  CompanyHolidayInput,
  HrDocumentInput,
  LeaveBalanceAdjustmentInput,
} from "./schemas";
import { HrError } from "./errors";

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

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function utcDate(y: number, m0: number, day: number) {
  return new Date(Date.UTC(y, m0, day));
}

/** Ορθόδοξο Πάσχα (Meeus / Julian → Gregorian) */
export function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);
  return julian;
}

export function greekFixedHolidays(year: number): Array<{
  name: string;
  date: Date;
  isRecurring: boolean;
}> {
  const easter = orthodoxEaster(year);
  const rel = (offset: number, name: string) => {
    const d = new Date(easter);
    d.setUTCDate(d.getUTCDate() + offset);
    return { name, date: d, isRecurring: false };
  };
  return [
    { name: "Πρωτοχρονιά", date: utcDate(year, 0, 1), isRecurring: true },
    { name: "Θεοφάνεια", date: utcDate(year, 0, 6), isRecurring: true },
    rel(-48, "Καθαρά Δευτέρα"),
    { name: "25η Μαρτίου", date: utcDate(year, 2, 25), isRecurring: true },
    rel(-2, "Μεγάλη Παρασκευή"),
    rel(0, "Κυριακή του Πάσχα"),
    rel(1, "Δευτέρα του Πάσχα"),
    { name: "Εργατική Πρωτομαγιά", date: utcDate(year, 4, 1), isRecurring: true },
    rel(50, "Αγίου Πνεύματος"),
    {
      name: "Κοίμηση της Θεοτόκου",
      date: utcDate(year, 7, 15),
      isRecurring: true,
    },
    { name: "28η Οκτωβρίου", date: utcDate(year, 9, 28), isRecurring: true },
    { name: "Χριστούγεννα", date: utcDate(year, 11, 25), isRecurring: true },
    { name: "Σύναξη Θεοτόκου", date: utcDate(year, 11, 26), isRecurring: true },
  ];
}

export async function ensureCompanyHolidays(
  db: Db,
  tenantId: string,
  year = new Date().getFullYear(),
) {
  const rows = greekFixedHolidays(year);
  for (const row of rows) {
    const existing = await db.companyHoliday.findFirst({
      where: {
        tenantId,
        date: row.date,
        name: row.name,
      },
      select: { id: true },
    });
    if (existing) continue;
    await db.companyHoliday.create({
      data: {
        tenantId,
        name: row.name,
        date: row.date,
        isRecurring: row.isRecurring,
        isBlackout: true,
      },
    });
  }
}

export async function listCompanyHolidays(
  db: Db,
  tenantId: string,
  opts?: { year?: number },
) {
  const year = opts?.year ?? new Date().getFullYear();
  await ensureCompanyHolidays(db, tenantId, year);
  const from = utcDate(year, 0, 1);
  const toEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return db.companyHoliday.findMany({
    where: { tenantId, date: { gte: from, lte: toEnd } },
    orderBy: { date: "asc" },
  });
}

export async function createCompanyHoliday(
  db: Db,
  input: { tenantId: string; data: CompanyHolidayInput },
) {
  const date = parseDate(input.data.date);
  if (!date) throw new HrError("Μη έγκυρη ημερομηνία");
  return db.companyHoliday.create({
    data: {
      tenantId: input.tenantId,
      name: input.data.name.trim(),
      date,
      isRecurring: input.data.isRecurring ?? false,
      isBlackout: input.data.isBlackout ?? false,
      notes: emptyToNull(input.data.notes),
    },
  });
}

export async function deleteCompanyHoliday(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const row = await db.companyHoliday.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new HrError("Η αργία δεν βρέθηκε", 404);
  await db.companyHoliday.delete({ where: { id: row.id } });
  return { ok: true as const };
}

export async function loadLeaveCalendar(
  db: Db,
  tenantId: string,
  opts: { from: string; to: string },
) {
  const from = parseDate(opts.from);
  const to = parseDate(opts.to);
  if (!from || !to) throw new HrError("Μη έγκυρο εύρος ημερομηνιών");
  const toEnd = new Date(to);
  toEnd.setUTCHours(23, 59, 59, 999);

  const [leaves, holidays] = await Promise.all([
    db.leaveRequest.findMany({
      where: {
        tenantId,
        status: { in: ["PENDING", "APPROVED"] },
        fromDate: { lte: toEnd },
        toDate: { gte: from },
      },
      include: {
        employee: {
          select: {
            id: true,
            code: true,
            firstName: true,
            lastName: true,
            department: true,
          },
        },
        leaveType: {
          select: { id: true, code: true, name: true, isPaid: true },
        },
      },
      orderBy: { fromDate: "asc" },
      take: 500,
    }),
    db.companyHoliday.findMany({
      where: { tenantId, date: { gte: from, lte: toEnd } },
      orderBy: { date: "asc" },
    }),
  ]);

  return {
    from: ymd(from),
    to: ymd(to),
    leaves: leaves.map((r) => ({
      id: r.id,
      days: Number(r.days),
      halfDay: r.halfDay,
      status: r.status,
      fromDate: r.fromDate.toISOString(),
      toDate: r.toDate.toISOString(),
      notes: r.notes,
      employee: r.employee,
      leaveType: r.leaveType,
    })),
    holidays: holidays.map((h) => ({
      id: h.id,
      name: h.name,
      date: h.date.toISOString(),
      isRecurring: h.isRecurring,
      isBlackout: h.isBlackout,
      notes: h.notes,
    })),
  };
}

export async function loadTeamPulse(db: Db, tenantId: string, dayIso?: string) {
  const day = parseDate(dayIso) ?? new Date();
  const dayStart = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  );
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const weekStart = new Date(dayStart);
  const wd = weekStart.getUTCDay();
  const mondayOffset = wd === 0 ? -6 : 1 - wd;
  weekStart.setUTCDate(weekStart.getUTCDate() + mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  const month = dayStart.getUTCMonth();
  const monthDay = dayStart.getUTCDate();

  const [employees, onLeave, holidays, openTasks, expiringDocs] =
    await Promise.all([
      db.employee.findMany({
        where: { tenantId, status: { in: ["ACTIVE", "INACTIVE"] } },
        select: {
          id: true,
          code: true,
          firstName: true,
          lastName: true,
          department: true,
          title: true,
          birthDate: true,
          hireDate: true,
          status: true,
          site: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 500,
      }),
      db.leaveRequest.findMany({
        where: {
          tenantId,
          status: "APPROVED",
          fromDate: { lte: dayEnd },
          toDate: { gte: dayStart },
        },
        include: {
          employee: {
            select: {
              id: true,
              code: true,
              firstName: true,
              lastName: true,
              department: true,
            },
          },
          leaveType: { select: { id: true, code: true, name: true } },
        },
      }),
      db.companyHoliday.findMany({
        where: { tenantId, date: { gte: dayStart, lte: dayEnd } },
      }),
      db.employeeChecklistItem.count({
        where: { tenantId, status: "TODO", kind: "ONBOARDING" },
      }),
      db.hrDocument.findMany({
        where: {
          tenantId,
          expiresAt: {
            gte: dayStart,
            lte: new Date(dayStart.getTime() + 30 * 86400000),
          },
        },
        include: {
          employee: {
            select: { id: true, code: true, firstName: true, lastName: true },
          },
        },
        orderBy: { expiresAt: "asc" },
        take: 20,
      }),
    ]);

  const birthdays = employees
    .filter((e) => {
      if (!e.birthDate) return false;
      const b = e.birthDate;
      const bDate = new Date(
        Date.UTC(
          dayStart.getUTCFullYear(),
          b.getUTCMonth(),
          b.getUTCDate(),
        ),
      );
      return bDate >= weekStart && bDate <= weekEnd;
    })
    .map((e) => ({
      id: e.id,
      code: e.code,
      firstName: e.firstName,
      lastName: e.lastName,
      department: e.department,
      date: e.birthDate!.toISOString(),
      kind: "birthday" as const,
    }));

  const anniversaries = employees
    .filter((e) => {
      if (!e.hireDate) return false;
      const h = e.hireDate;
      return h.getUTCMonth() === month && h.getUTCDate() === monthDay;
    })
    .map((e) => {
      const years =
        dayStart.getUTCFullYear() - e.hireDate!.getUTCFullYear();
      return {
        id: e.id,
        code: e.code,
        firstName: e.firstName,
        lastName: e.lastName,
        department: e.department,
        date: e.hireDate!.toISOString(),
        years,
        kind: "anniversary" as const,
      };
    })
    .filter((a) => a.years > 0);

  const byDepartment = new Map<string, number>();
  for (const e of employees.filter((x) => x.status === "ACTIVE")) {
    const key = e.department?.trim() || "Χωρίς τμήμα";
    byDepartment.set(key, (byDepartment.get(key) ?? 0) + 1);
  }

  return {
    day: ymd(dayStart),
    headcount: employees.filter((e) => e.status === "ACTIVE").length,
    onLeave: onLeave.map((r) => ({
      id: r.id,
      days: Number(r.days),
      halfDay: r.halfDay,
      fromDate: r.fromDate.toISOString(),
      toDate: r.toDate.toISOString(),
      employee: r.employee,
      leaveType: r.leaveType,
    })),
    holidays: holidays.map((h) => ({
      id: h.id,
      name: h.name,
      date: h.date.toISOString(),
      isBlackout: h.isBlackout,
    })),
    birthdays,
    anniversaries,
    departments: [...byDepartment.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "el")),
    openOnboarding: openTasks,
    expiringDocuments: expiringDocs.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      expiresAt: d.expiresAt?.toISOString() ?? null,
      employee: d.employee,
    })),
  };
}

export async function loadOrgDirectory(db: Db, tenantId: string) {
  const employees = await db.employee.findMany({
    where: { tenantId, status: { in: ["ACTIVE", "INACTIVE"] } },
    select: {
      id: true,
      code: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      title: true,
      department: true,
      contractType: true,
      status: true,
      hireDate: true,
      site: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ department: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    take: 500,
  });

  const groups = new Map<
    string,
    Array<(typeof employees)[number]>
  >();
  for (const e of employees) {
    const key = e.department?.trim() || "Χωρίς τμήμα";
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([department, members]) => ({
    department,
    count: members.length,
    members: members.map((m) => ({
      ...m,
      hireDate: m.hireDate?.toISOString() ?? null,
    })),
  }));
}

export async function createLeaveBalanceAdjustment(
  db: Db,
  input: { tenantId: string; data: LeaveBalanceAdjustmentInput },
) {
  const employee = await db.employee.findFirst({
    where: { id: input.data.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);
  const leaveType = await db.leaveType.findFirst({
    where: { id: input.data.leaveTypeId, tenantId: input.tenantId },
  });
  if (!leaveType) throw new HrError("Ο τύπος άδειας δεν βρέθηκε", 404);
  if (input.data.days === 0) throw new HrError("Οι ημέρες δεν μπορεί να είναι 0");

  return db.leaveBalanceAdjustment.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      year: input.data.year,
      days: new Prisma.Decimal(input.data.days),
      reason: emptyToNull(input.data.reason),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      leaveType: { select: { id: true, code: true, name: true } },
    },
  });
}

export async function listLeaveBalanceAdjustments(
  db: Db,
  tenantId: string,
  opts?: { year?: number; employeeId?: string },
) {
  const year = opts?.year ?? new Date().getFullYear();
  return db.leaveBalanceAdjustment.findMany({
    where: {
      tenantId,
      year,
      ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
      leaveType: { select: { id: true, code: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function listHrDocuments(
  db: Db,
  tenantId: string,
  opts?: { employeeId?: string },
) {
  return db.hrDocument.findMany({
    where: {
      tenantId,
      ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
}

export async function createHrDocument(
  db: Db,
  input: { tenantId: string; data: HrDocumentInput },
) {
  const employee = await db.employee.findFirst({
    where: { id: input.data.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);
  return db.hrDocument.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      category: input.data.category ?? "OTHER",
      title: input.data.title.trim(),
      fileName: emptyToNull(input.data.fileName),
      fileUrl: emptyToNull(input.data.fileUrl),
      issuedAt: parseDate(input.data.issuedAt),
      expiresAt: parseDate(input.data.expiresAt),
      notes: emptyToNull(input.data.notes),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
  });
}

export async function deleteHrDocument(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const row = await db.hrDocument.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new HrError("Το έγγραφο δεν βρέθηκε", 404);
  await db.hrDocument.delete({ where: { id: row.id } });
  return { ok: true as const };
}

export async function seedOnboardingChecklist(
  db: Db,
  input: { tenantId: string; employeeId: string },
) {
  const employee = await db.employee.findFirst({
    where: { id: input.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);
  const existing = await db.employeeChecklistItem.count({
    where: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      kind: "ONBOARDING",
    },
  });
  if (existing > 0) {
    throw new HrError("Υπάρχει ήδη onboarding checklist για τον εργαζόμενο");
  }
  const hire = employee.hireDate ?? new Date();
  const created = [];
  for (let i = 0; i < DEFAULT_ONBOARDING_TASKS.length; i += 1) {
    const title = DEFAULT_ONBOARDING_TASKS[i]!;
    const due = new Date(hire);
    due.setUTCDate(due.getUTCDate() + 7 + i * 2);
    created.push(
      await db.employeeChecklistItem.create({
        data: {
          tenantId: input.tenantId,
          employeeId: employee.id,
          kind: "ONBOARDING",
          title,
          status: "TODO",
          dueDate: due,
          sortOrder: (i + 1) * 10,
        },
      }),
    );
  }
  return created;
}

export async function listChecklistItems(
  db: Db,
  tenantId: string,
  opts?: { employeeId?: string; kind?: string; status?: string },
) {
  return db.employeeChecklistItem.findMany({
    where: {
      tenantId,
      ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}),
      ...(opts?.kind
        ? { kind: opts.kind as "ONBOARDING" | "OFFBOARDING" | "PERIODIC" }
        : {}),
      ...(opts?.status
        ? { status: opts.status as "TODO" | "DONE" | "SKIPPED" }
        : {}),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { sortOrder: "asc" }],
    take: 400,
  });
}

export async function createChecklistItem(
  db: Db,
  input: { tenantId: string; data: ChecklistItemCreateInput },
) {
  const employee = await db.employee.findFirst({
    where: { id: input.data.employeeId, tenantId: input.tenantId },
  });
  if (!employee) throw new HrError("Ο εργαζόμενος δεν βρέθηκε", 404);
  return db.employeeChecklistItem.create({
    data: {
      tenantId: input.tenantId,
      employeeId: employee.id,
      kind: input.data.kind ?? "ONBOARDING",
      title: input.data.title.trim(),
      dueDate: parseDate(input.data.dueDate),
      sortOrder: input.data.sortOrder ?? 0,
      notes: emptyToNull(input.data.notes),
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
  });
}

export async function patchChecklistItem(
  db: Db,
  input: { tenantId: string; id: string; data: ChecklistItemPatchInput },
) {
  const row = await db.employeeChecklistItem.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new HrError("Το βήμα δεν βρέθηκε", 404);
  const status = input.data.status ?? row.status;
  return db.employeeChecklistItem.update({
    where: { id: row.id },
    data: {
      status,
      title: input.data.title?.trim() || row.title,
      dueDate:
        input.data.dueDate !== undefined
          ? parseDate(input.data.dueDate)
          : row.dueDate,
      notes:
        input.data.notes !== undefined
          ? emptyToNull(input.data.notes)
          : row.notes,
      sortOrder: input.data.sortOrder ?? row.sortOrder,
      completedAt:
        status === "DONE"
          ? row.completedAt ?? new Date()
          : status === "TODO"
            ? null
            : row.completedAt,
    },
    include: {
      employee: {
        select: { id: true, code: true, firstName: true, lastName: true },
      },
    },
  });
}

export async function updateLeaveType(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    data: {
      name?: string;
      daysPerYear?: number;
      isPaid?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    };
  },
) {
  const row = await db.leaveType.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new HrError("Ο τύπος άδειας δεν βρέθηκε", 404);
  return db.leaveType.update({
    where: { id: row.id },
    data: {
      name: input.data.name?.trim() || row.name,
      daysPerYear: input.data.daysPerYear ?? row.daysPerYear,
      isPaid: input.data.isPaid ?? row.isPaid,
      isActive: input.data.isActive ?? row.isActive,
      sortOrder: input.data.sortOrder ?? row.sortOrder,
    },
  });
}

/** Έλεγχος επικάλυψης / blackout για νέα αίτηση */
export async function assertLeaveRequestAllowed(
  db: Db,
  input: {
    tenantId: string;
    employeeId: string;
    fromDate: Date;
    toDate: Date;
    leaveTypeId: string;
    days: number;
    year: number;
  },
) {
  const overlap = await db.leaveRequest.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      fromDate: { lte: input.toDate },
      toDate: { gte: input.fromDate },
    },
    select: { id: true, fromDate: true, toDate: true, status: true },
  });
  if (overlap) {
    throw new HrError(
      `Υπάρχει ήδη αίτηση (${overlap.status}) που επικαλύπτεται: ${ymd(overlap.fromDate)} – ${ymd(overlap.toDate)}`,
    );
  }

  const blackouts = await db.companyHoliday.findMany({
    where: {
      tenantId: input.tenantId,
      isBlackout: true,
      date: { gte: input.fromDate, lte: input.toDate },
    },
    select: { name: true, date: true },
    take: 5,
  });
  if (blackouts.length) {
    throw new HrError(
      `Η περίοδος καλύπτει αργία/blackout: ${blackouts.map((b) => `${b.name} (${ymd(b.date)})`).join(", ")}`,
    );
  }

  const type = await db.leaveType.findFirst({
    where: { id: input.leaveTypeId, tenantId: input.tenantId },
  });
  if (!type) throw new HrError("Ο τύπος άδειας δεν βρέθηκε", 404);

  const [approved, adjustments] = await Promise.all([
    db.leaveRequest.findMany({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        status: "APPROVED",
        fromDate: {
          gte: utcDate(input.year, 0, 1),
          lte: new Date(Date.UTC(input.year, 11, 31, 23, 59, 59, 999)),
        },
      },
      select: { days: true },
    }),
    db.leaveBalanceAdjustment.findMany({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        year: input.year,
      },
      select: { days: true },
    }),
  ]);
  const used = approved.reduce((s, r) => s + Number(r.days), 0);
  const adj = adjustments.reduce((s, r) => s + Number(r.days), 0);
  const remaining = type.daysPerYear + adj - used;
  if (input.days > remaining + 0.001) {
    throw new HrError(
      `Ανεπαρκές υπόλοιπο «${type.name}»: απομένουν ${Math.max(0, Math.round(remaining * 100) / 100)} ημέρες`,
    );
  }
}
