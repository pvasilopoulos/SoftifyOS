import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import {
  ensureLeaveTypes,
  listEmployees,
  listErganiSubmissions,
  listLeaveRequests,
  listLeaveTypes,
  listPayrollPeriods,
  listWorkCardEvents,
  listWorkCards,
  serializeEmployee,
} from "@/modules/hr/service";
import { HrClient } from "./hr-client";

export const metadata = { title: "HR" };
export const dynamic = "force-dynamic";

export default async function HrPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenantId = session.tenantId;
  await ensureLeaveTypes(prisma, tenantId);

  const [
    employees,
    leaveTypes,
    leaveRequests,
    workCards,
    events,
    ergani,
    payroll,
    sites,
  ] = await Promise.all([
    listEmployees(prisma, tenantId),
    listLeaveTypes(prisma, tenantId),
    listLeaveRequests(prisma, tenantId),
    listWorkCards(prisma, tenantId),
    listWorkCardEvents(prisma, tenantId),
    listErganiSubmissions(prisma, tenantId),
    listPayrollPeriods(prisma, tenantId),
    prisma.site.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
      take: 100,
    }),
  ]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          HR
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Μητρώο εργαζομένων · άδειες · ψηφιακή κάρτα εργασίας · Εργάνη ·
          μισθοδοσία (ελληνικά πρότυπα).
        </p>
      </div>
      <HrClient
        sites={sites}
        initialEmployees={employees.map(serializeEmployee)}
        initialLeaveTypes={leaveTypes.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          daysPerYear: t.daysPerYear,
          isPaid: t.isPaid,
        }))}
        initialLeaveRequests={leaveRequests.map((r) => ({
          id: r.id,
          days: Number(r.days),
          status: r.status,
          fromDate: r.fromDate.toISOString(),
          toDate: r.toDate.toISOString(),
          notes: r.notes,
          employee: r.employee,
          leaveType: r.leaveType,
        }))}
        initialWorkCards={workCards.map((c) => ({
          id: c.id,
          cardNumber: c.cardNumber,
          status: c.status,
          issuedAt: c.issuedAt.toISOString(),
          employee: c.employee,
        }))}
        initialEvents={events.map((e) => ({
          id: e.id,
          type: e.type,
          source: e.source,
          occurredAt: e.occurredAt.toISOString(),
          erganiStatus: e.erganiStatus,
          employee: e.employee,
          workCard: e.workCard,
        }))}
        initialErgani={ergani.map((i) => ({
          id: i.id,
          entityType: i.entityType,
          eventKind: i.eventKind,
          status: i.status,
          externalRef: i.externalRef,
          attempts: i.attempts,
          lastError: i.lastError,
          createdAt: i.createdAt.toISOString(),
        }))}
        initialPayroll={payroll.map((p) => {
          const totals = p.lines.reduce(
            (acc, l) => {
              acc.gross += Number(l.gross);
              acc.net += Number(l.net);
              acc.employeeEfka += Number(l.employeeEfka);
              acc.employerEfka += Number(l.employerEfka);
              acc.tax += Number(l.tax);
              return acc;
            },
            { gross: 0, net: 0, employeeEfka: 0, employerEfka: 0, tax: 0 },
          );
          return {
            id: p.id,
            code: p.code,
            year: p.year,
            month: p.month,
            status: p.status,
            lineCount: p._count.lines,
            totals,
          };
        })}
      />
    </div>
  );
}
