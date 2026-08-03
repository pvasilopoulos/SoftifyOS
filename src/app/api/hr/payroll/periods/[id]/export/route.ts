import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

function csvEscape(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Array<Array<string | number | null | undefined>>) {
  return rows.map((r) => r.map(csvEscape).join(";")).join("\n") + "\n";
}

/**
 * Payroll exports:
 * - ?format=bank → SEPA-lite CSV (IBAN, name, net, remittance)
 * - ?format=fmy → ΦΜΥ/ΑΠΔ lite CSV for accountant
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await context.params;
    const format = new URL(request.url).searchParams.get("format") || "bank";

    const period = await prisma.payrollPeriod.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        lines: {
          include: {
            employee: {
              select: {
                code: true,
                firstName: true,
                lastName: true,
                vatNumber: true,
                amka: true,
                ama: true,
                iban: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!period) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    if (format === "fmy") {
      const rows: Array<Array<string | number | null>> = [
        [
          "period",
          "employeeCode",
          "lastName",
          "firstName",
          "afm",
          "amka",
          "ama",
          "gross",
          "employeeEfka",
          "employerEfka",
          "tax",
          "net",
        ],
      ];
      for (const l of period.lines) {
        rows.push([
          period.code,
          l.employee.code,
          l.employee.lastName,
          l.employee.firstName,
          l.employee.vatNumber,
          l.employee.amka,
          l.employee.ama,
          toNumber(l.gross).toFixed(2),
          toNumber(l.employeeEfka).toFixed(2),
          toNumber(l.employerEfka).toFixed(2),
          toNumber(l.tax).toFixed(2),
          toNumber(l.net).toFixed(2),
        ]);
      }
      const body = toCsv(rows);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="fmy-lite-${period.code}.csv"`,
        },
      });
    }

    // bank / SEPA-lite
    const rows: Array<Array<string | number | null>> = [
      ["iban", "beneficiary", "amount", "currency", "remittance", "employeeCode"],
    ];
    for (const l of period.lines) {
      const net = toNumber(l.net);
      if (net <= 0) continue;
      rows.push([
        l.employee.iban || "",
        `${l.employee.lastName} ${l.employee.firstName}`.trim(),
        net.toFixed(2),
        "EUR",
        `Μισθοδοσία ${period.code}`,
        l.employee.code,
      ]);
    }
    const body = toCsv(rows);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payroll-bank-${period.code}.csv"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Export failed") },
      { status: 500 },
    );
  }
}
