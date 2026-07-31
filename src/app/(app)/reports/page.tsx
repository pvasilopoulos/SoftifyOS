import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  loadApRows,
  loadArRows,
  loadVatSummary,
} from "@/modules/finance/analytics";

export const metadata = { title: "Αναφορές" };
export const dynamic = "force-dynamic";

function money(n: number) {
  return n.toLocaleString("el-GR", { style: "currency", currency: "EUR" });
}

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenantId = session.tenantId;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const yearStart = new Date(`${startOfMonth.getFullYear()}-01-01T00:00:00.000Z`);
  const now = new Date();

  const [
    issuedMonth,
    openOrders,
    lowStock,
    arRows,
    apRows,
    vat,
    topCustomers,
    deliveryCount,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        tenantId,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        issuedAt: { gte: startOfMonth },
      },
      select: { total: true, vatAmount: true, kind: true },
    }),
    prisma.order.count({
      where: { tenantId, status: { in: ["DRAFT", "CONFIRMED"] } },
    }),
    prisma.stockBalance.count({
      where: { tenantId, qtyOnHand: { lte: 5 } },
    }),
    loadArRows(prisma, tenantId),
    loadApRows(prisma, tenantId),
    loadVatSummary(prisma, tenantId, yearStart, now),
    prisma.invoice.groupBy({
      by: ["customerId"],
      where: {
        tenantId,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        issuedAt: { gte: startOfMonth },
      },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 5,
    }),
    prisma.deliveryNote.count({
      where: { tenantId, status: "ISSUED", issuedAt: { gte: startOfMonth } },
    }),
  ]);

  let monthSales = 0;
  let monthVat = 0;
  for (const inv of issuedMonth) {
    const sign = inv.kind === "SALES_CREDIT" ? -1 : 1;
    monthSales += sign * toNumber(inv.total);
    monthVat += sign * toNumber(inv.vatAmount);
  }

  const customerIds = topCustomers.map((c) => c.customerId);
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { tenantId, id: { in: customerIds } },
        select: { id: true, name: true, code: true },
      })
    : [];
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  const arTotal = arRows.reduce((s, r) => s + r.balance, 0);
  const apTotal = apRows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Αναφορές"
        description="Ζωντανά aggregates από τιμολόγια, αγορές, απόθεμα και ΦΠΑ."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ["Πωλήσεις μήνα", money(monthSales)],
            ["Open AR", money(arTotal)],
            ["Open AP (PO)", money(apTotal)],
            ["ΦΠΑ χρήσης", money(vat.netVatPayable)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="soft-panel px-4 py-4">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">
              {value}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="soft-panel p-4 sm:p-5">
          <h2 className="text-base font-semibold text-ink-950">
            Top πελάτες μήνα
          </h2>
          <ul className="mt-3 space-y-2">
            {topCustomers.map((row) => {
              const c = customerMap.get(row.customerId);
              return (
                <li
                  key={row.customerId}
                  className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="truncate font-medium">
                    {c ? `${c.code} · ${c.name}` : row.customerId}
                  </span>
                  <span className="tabular-nums font-semibold">
                    {money(toNumber(row._sum.total ?? 0))}
                  </span>
                </li>
              );
            })}
            {topCustomers.length === 0 ? (
              <li className="py-6 text-center text-sm text-slate-500">
                Δεν υπάρχουν εκδόσεις αυτόν τον μήνα.
              </li>
            ) : null}
          </ul>
        </section>

        <section className="soft-panel p-4 sm:p-5">
          <h2 className="text-base font-semibold text-ink-950">
            Λειτουργικοί δείκτες
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span>Ανοιχτές παραγγελίες</span>
              <span className="font-semibold">{openOrders}</span>
            </li>
            <li className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span>Χαμηλό απόθεμα (≤5)</span>
              <span className="font-semibold">{lowStock}</span>
            </li>
            <li className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span>Δελτία αποστολής μήνα</span>
              <span className="font-semibold">{deliveryCount}</span>
            </li>
            <li className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span>ΦΠΑ πωλήσεων (χρήση)</span>
              <span className="font-semibold">{money(vat.salesVat)}</span>
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/finance" className="font-medium text-teal-700 hover:underline">
              Οικονομικά / AR-AP
            </Link>
            <Link href="/inventory" className="font-medium text-teal-700 hover:underline">
              Αποθήκη
            </Link>
            <Link href="/invoices" className="font-medium text-teal-700 hover:underline">
              Τιμολόγια
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
