import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  PackageMinus,
  Receipt,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { toNumber } from "@/modules/sales/invoice-utils";
import { loadArRows } from "@/modules/finance/analytics";

export const metadata = { title: "Πίνακας ελέγχου" };
export const dynamic = "force-dynamic";

function money(n: number) {
  return n.toLocaleString("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

const statusLabel: Record<string, string> = {
  DRAFT: "Πρόχειρο",
  ISSUED: "Εκδομένο",
  PARTIAL: "Μερικό",
  PAID: "Εξοφλημένο",
  OVERDUE: "Ληξιπρόθεσμο",
  CANCELLED: "Ακυρωμένο",
};

const statusTone: Record<string, "slate" | "teal" | "amber" | "rose" | "emerald"> = {
  DRAFT: "slate",
  ISSUED: "teal",
  PARTIAL: "amber",
  PAID: "emerald",
  OVERDUE: "rose",
  CANCELLED: "rose",
};

export default async function DashboardPage() {
  const session = await getSession();
  const firstName = session?.name?.split(/\s+/)[0] ?? "εκεί";

  if (!session) {
    return (
      <div className="space-y-6">
        <PageHeader title="Καλημέρα" description="Συνδεθείτε για ζωντανά δεδομένα." />
      </div>
    );
  }

  const tenantId = session.tenantId;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    monthPayments,
    arRows,
    ordersToday,
    stockRows,
    overdueInvoices,
    lowStock,
    draftPos,
    recentInvoices,
    recentAudits,
  ] = await Promise.all([
    prisma.invoicePayment.aggregate({
      where: { tenantId, paidAt: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    loadArRows(prisma, tenantId),
    prisma.order.count({
      where: { tenantId, createdAt: { gte: startOfDay } },
    }),
    prisma.stockBalance.findMany({
      where: { tenantId },
      select: { qtyOnHand: true },
      take: 5000,
    }),
    prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
        dueAt: { lt: new Date() },
      },
      take: 5,
      orderBy: { dueAt: "asc" },
      include: { customer: { select: { name: true } } },
    }),
    prisma.stockBalance.findMany({
      where: { tenantId, qtyOnHand: { lte: 5 } },
      take: 3,
      orderBy: { qtyOnHand: "asc" },
      include: {
        product: { select: { sku: true, name: true } },
        site: { select: { name: true } },
      },
    }),
    prisma.purchaseOrder.count({
      where: { tenantId, status: "DRAFT" },
    }),
    prisma.invoice.findMany({
      where: { tenantId, status: { not: "DRAFT" } },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: { customer: { select: { name: true, code: true } } },
    }),
    prisma.auditEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const collections = toNumber(monthPayments._sum.amount ?? 0);
  const openAr = arRows.reduce((s, r) => s + r.balance, 0);
  const positiveStock = stockRows.filter((r) => Number(r.qtyOnHand) > 0).length;
  const stockHealth =
    stockRows.length === 0
      ? 100
      : Math.round((positiveStock / stockRows.length) * 100);

  const kpis = [
    {
      label: "Εισπράξεις μήνα",
      value: money(collections),
      delta: `${startOfMonth.toLocaleDateString("el-GR", { month: "short" })}`,
    },
    {
      label: "Open AR",
      value: money(openAr),
      delta: `${arRows.length} ανοιχτά`,
    },
    {
      label: "Παραγγελίες σήμερα",
      value: String(ordersToday),
      delta: "live",
    },
    {
      label: "Υγεία stock",
      value: `${stockHealth}%`,
      delta: `${stockRows.length} θέσεις`,
    },
  ];

  const workQueue: Array<{
    id: string;
    title: string;
    meta: string;
    tone: "rose" | "amber" | "teal";
    icon: typeof Receipt;
    href: string;
  }> = [];

  if (overdueInvoices.length) {
    workQueue.push({
      id: "overdue",
      title: `${overdueInvoices.length} ληξιπρόθεσμα τιμολόγια`,
      meta: overdueInvoices.map((i) => i.customer.name).slice(0, 2).join(" · "),
      tone: "rose",
      icon: Receipt,
      href: "/finance",
    });
  }
  if (lowStock.length) {
    const first = lowStock[0]!;
    workQueue.push({
      id: "stock",
      title: `Χαμηλό απόθεμα · ${first.product.sku}`,
      meta: `${first.site.name} · ${Number(first.qtyOnHand)} τεμ.`,
      tone: "amber",
      icon: PackageMinus,
      href: "/inventory",
    });
  }
  if (draftPos > 0) {
    workQueue.push({
      id: "po",
      title: `${draftPos} πρόχειρες παραγγελίες αγοράς`,
      meta: "Αναμονή επιβεβαίωσης",
      tone: "teal",
      icon: Clock3,
      href: "/purchasing",
    });
  }
  if (workQueue.length === 0) {
    workQueue.push({
      id: "ok",
      title: "Καμία επείγουσα ενέργεια",
      meta: "Το σύστημα είναι σε καλή κατάσταση",
      tone: "teal",
      icon: CheckCircle2,
      href: "/reports",
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Καλημέρα, ${firstName}`}
        description={`Τι χρειάζεται ενέργεια σήμερα στην ${session.tenantName}.`}
        actions={
          <Link
            href="/invoices/new"
            className="hidden h-10 items-center justify-center rounded-xl bg-teal-600 px-4 text-sm font-medium text-white shadow-sm shadow-teal-900/10 hover:bg-teal-700 sm:inline-flex"
          >
            Νέο τιμολόγιο
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi, i) => (
          <div
            key={kpi.label}
            className="soft-panel animate-rise px-4 py-4"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="text-2xl font-semibold tracking-tight text-ink-950">
                {kpi.value}
              </p>
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-teal-700">
                <ArrowUpRight size={12} />
                {kpi.delta}
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-teal-500/80"
                style={{ width: `${55 + i * 10}%` }}
              />
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="soft-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-ink-950">
                Χρειάζεται ενέργεια
              </h2>
              <p className="text-sm text-slate-500">Work queue · live</p>
            </div>
            <Badge tone="amber">{workQueue.length} ανοιχτά</Badge>
          </div>
          <ul className="space-y-2.5">
            {workQueue.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 px-3.5 py-3 hover:bg-slate-50"
                  >
                    <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-900">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-500">{item.meta}</p>
                    </div>
                    <Badge tone={item.tone}>ενέργεια</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="soft-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink-950">
                Πρόσφατη δραστηριότητα
              </h2>
              <p className="text-sm text-slate-500">Τελευταία παραστατικά</p>
            </div>
            <Link
              href="/invoices"
              className="text-sm font-medium text-teal-700 hover:text-teal-800"
            >
              Όλα
            </Link>
          </div>
          <ul className="space-y-2">
            {recentInvoices.map((inv) => {
              const initials = inv.customer.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() ?? "")
                .join("");
              return (
                <li key={inv.id}>
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-slate-50"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 text-[11px] font-semibold text-white">
                      {initials || "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {inv.number}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {inv.customer.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {toNumber(inv.total).toLocaleString("el-GR", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </p>
                      <Badge
                        tone={statusTone[inv.status] ?? "slate"}
                        className="mt-1"
                      >
                        {statusLabel[inv.status] ?? inv.status}
                      </Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
            {recentInvoices.length === 0 ? (
              <li className="px-2 py-8 text-center text-sm text-slate-500">
                Δεν υπάρχουν ακόμη τιμολόγια.
              </li>
            ) : null}
          </ul>
        </section>
      </div>

      <section className="soft-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <p className="font-medium text-ink-950">Live ERP δεδομένα</p>
            <p className="text-sm text-slate-500">
              Audit: {recentAudits.length} πρόσφατα · role {session.role}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <AlertTriangle size={14} className="text-amber-500" />
          myDATA σε simulator mode · χωρίς live AADE ακόμη
        </div>
      </section>
    </div>
  );
}
