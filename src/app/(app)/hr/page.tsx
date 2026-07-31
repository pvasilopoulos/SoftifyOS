import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { HrClient } from "./hr-client";

export const metadata = { title: "HR" };
export const dynamic = "force-dynamic";

export default async function HrPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const employees = await prisma.employee.findMany({
    where: { tenantId: session.tenantId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">HR</h1>
        <p className="mt-1 text-sm text-slate-600">
          Μητρώο εργαζομένων · άδειες και μισθοδοσία σε επόμενη φάση.
        </p>
      </div>
      <HrClient
        initialEmployees={employees.map((e) => ({
          id: e.id,
          code: e.code,
          firstName: e.firstName,
          lastName: e.lastName,
          email: e.email,
          phone: e.phone,
          title: e.title,
          department: e.department,
          hireDate: e.hireDate?.toISOString() ?? null,
          status: e.status,
        }))}
      />
    </div>
  );
}
