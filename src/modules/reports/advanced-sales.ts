import type { PrismaClient } from "@/generated/prisma/client";
import { toNumber } from "@/modules/sales/invoice-utils";
import type { ReportResult } from "./engine";
import { resolvePeriod } from "./period";
import type { ReportRunInput } from "./schemas";

function money(n: number) {
  return n.toLocaleString("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function pct(n: number) {
  if (!Number.isFinite(n)) return "—";
  const v = Math.round(n * 10) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("el-GR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function invoiceSign(kind: string) {
  return kind === "SALES_CREDIT" ? -1 : 1;
}

function buildMonthBuckets(start: Date, end: Date) {
  const keys: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    keys.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

async function loadIssuedInvoices(
  db: PrismaClient,
  tenantId: string,
  start: Date,
  end: Date,
) {
  return db.invoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issuedAt: { gte: start, lte: end },
    },
    select: {
      id: true,
      customerId: true,
      kind: true,
      total: true,
      paidAmount: true,
      issuedAt: true,
      siteId: true,
    },
  });
}

function netSales(
  invoices: Array<{ kind: string; total: unknown }>,
) {
  let sum = 0;
  for (const inv of invoices) {
    sum += invoiceSign(inv.kind) * toNumber(inv.total);
  }
  return Math.round(sum * 100) / 100;
}

/** YoY: current year months vs prior year same months */
export async function runSalesYoY(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const currentStart = new Date(Date.UTC(year, 0, 1));
  const currentEnd = now;
  const priorStart = new Date(Date.UTC(year - 1, 0, 1));
  const priorEnd = new Date(
    Date.UTC(year - 1, now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  );

  const months = Array.from({ length: now.getUTCMonth() + 1 }, (_, i) =>
    String(i + 1).padStart(2, "0"),
  );
  const labels = months.map((m) =>
    new Date(Date.UTC(year, Number(m) - 1, 1)).toLocaleDateString("el-GR", {
      month: "short",
      timeZone: "UTC",
    }),
  );

  const [current, prior] = await Promise.all([
    loadIssuedInvoices(db, tenantId, currentStart, currentEnd),
    loadIssuedInvoices(db, tenantId, priorStart, priorEnd),
  ]);

  const curMap = new Map(months.map((m) => [m, 0]));
  const priMap = new Map(months.map((m) => [m, 0]));
  for (const inv of current) {
    if (!inv.issuedAt) continue;
    const m = String(inv.issuedAt.getUTCMonth() + 1).padStart(2, "0");
    if (!curMap.has(m)) continue;
    curMap.set(
      m,
      (curMap.get(m) ?? 0) + invoiceSign(inv.kind) * toNumber(inv.total),
    );
  }
  for (const inv of prior) {
    if (!inv.issuedAt) continue;
    const m = String(inv.issuedAt.getUTCMonth() + 1).padStart(2, "0");
    if (!priMap.has(m)) continue;
    priMap.set(
      m,
      (priMap.get(m) ?? 0) + invoiceSign(inv.kind) * toNumber(inv.total),
    );
  }

  const curData = months.map((m) => Math.round((curMap.get(m) ?? 0) * 100) / 100);
  const priData = months.map((m) => Math.round((priMap.get(m) ?? 0) * 100) / 100);
  const curTotal = curData.reduce((a, b) => a + b, 0);
  const priTotal = priData.reduce((a, b) => a + b, 0);
  const yoy =
    priTotal > 0 ? ((curTotal - priTotal) / priTotal) * 100 : Number.NaN;

  return {
    id: "sales-yoy",
    title: "YoY · Σύγκριση ετών",
    description: `${year} vs ${year - 1} (ίδιοι μήνες έως σήμερα)`,
    periodLabel: `YTD ${year}`,
    chart: {
      type: "line",
      categories: labels,
      series: [
        { name: String(year), data: curData },
        { name: String(year - 1), data: priData },
      ],
    },
    kpis: [
      { label: String(year), value: money(curTotal) },
      { label: String(year - 1), value: money(priTotal) },
      { label: "YoY", value: pct(yoy), hint: "μεταβολή" },
    ],
    table: {
      columns: [
        { key: "month", label: "Μήνας" },
        { key: "current", label: String(year) },
        { key: "prior", label: String(year - 1) },
        { key: "delta", label: "Δ %" },
      ],
      rows: months.map((m, i) => {
        const c = curData[i]!;
        const p = priData[i]!;
        const d = p > 0 ? ((c - p) / p) * 100 : null;
        return {
          month: labels[i]!,
          current: c,
          prior: p,
          delta: d == null ? "—" : Math.round(d * 10) / 10,
        };
      }),
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Current period total vs previous equivalent window */
export async function runSalesPeriodCompare(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);

  const [cur, prev] = await Promise.all([
    loadIssuedInvoices(db, tenantId, start, end),
    loadIssuedInvoices(db, tenantId, prevStart, prevEnd),
  ]);
  const curSales = netSales(cur);
  const prevSales = netSales(prev);
  const curCount = cur.filter((i) => i.kind !== "SALES_CREDIT").length;
  const prevCount = prev.filter((i) => i.kind !== "SALES_CREDIT").length;
  const delta =
    prevSales > 0 ? ((curSales - prevSales) / prevSales) * 100 : Number.NaN;

  return {
    id: "sales-period-compare",
    title: "Σύγκριση περιόδων",
    description: `${label} έναντι προηγούμενης ισοδύναμης περιόδου`,
    periodLabel: label,
    chart: {
      type: "bar",
      categories: ["Πωλήσεις", "Παραστατικά", "AOV"],
      series: [
        {
          name: "Τρέχουσα",
          data: [
            curSales,
            curCount,
            curCount ? Math.round((curSales / curCount) * 100) / 100 : 0,
          ],
        },
        {
          name: "Προηγούμενη",
          data: [
            prevSales,
            prevCount,
            prevCount ? Math.round((prevSales / prevCount) * 100) / 100 : 0,
          ],
        },
      ],
    },
    kpis: [
      { label: "Τρέχουσα", value: money(curSales) },
      { label: "Προηγούμενη", value: money(prevSales) },
      { label: "Μεταβολή", value: pct(delta) },
    ],
    table: {
      columns: [
        { key: "metric", label: "Μετρική" },
        { key: "current", label: "Τρέχουσα" },
        { key: "prior", label: "Προηγούμενη" },
      ],
      rows: [
        { metric: "Πωλήσεις", current: curSales, prior: prevSales },
        { metric: "Παραστατικά", current: curCount, prior: prevCount },
        {
          metric: "AOV",
          current: curCount ? Math.round((curSales / curCount) * 100) / 100 : 0,
          prior: prevCount
            ? Math.round((prevSales / prevCount) * 100) / 100
            : 0,
        },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Trailing twelve-month rolling sum */
export async function runSalesTtm(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 23, 1));
  const invoices = await loadIssuedInvoices(db, tenantId, start, now);
  const buckets = buildMonthBuckets(start, now);
  const monthly = new Map(buckets.map((k) => [k, 0]));
  for (const inv of invoices) {
    if (!inv.issuedAt) continue;
    const k = monthKey(inv.issuedAt);
    if (!monthly.has(k)) continue;
    monthly.set(
      k,
      (monthly.get(k) ?? 0) + invoiceSign(inv.kind) * toNumber(inv.total),
    );
  }
  const monthVals = buckets.map((k) => monthly.get(k) ?? 0);
  // TTM points for last 12 months of the 24-month window
  const ttmKeys = buckets.slice(-12);
  const ttmData = ttmKeys.map((_, idx) => {
    const endIdx = buckets.length - 12 + idx;
    const window = monthVals.slice(endIdx - 11, endIdx + 1);
    return Math.round(window.reduce((a, b) => a + b, 0) * 100) / 100;
  });
  const latest = ttmData[ttmData.length - 1] ?? 0;
  const prev = ttmData[ttmData.length - 2] ?? 0;
  const mom = prev > 0 ? ((latest - prev) / prev) * 100 : Number.NaN;

  return {
    id: "sales-ttm",
    title: "TTM · Rolling 12 μήνες",
    periodLabel: "Κυλιόμενο 12μηνο",
    chart: {
      type: "area",
      categories: ttmKeys.map(monthLabel),
      series: [{ name: "TTM πωλήσεις", data: ttmData }],
    },
    kpis: [
      { label: "Τρέχον TTM", value: money(latest) },
      { label: "vs προηγ. μήνα", value: pct(mom) },
    ],
    table: {
      columns: [
        { key: "month", label: "Μήνας" },
        { key: "ttm", label: "TTM" },
      ],
      rows: ttmKeys.map((k, i) => ({
        month: monthLabel(k),
        ttm: ttmData[i]!,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesQuarterly(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const start = new Date(Date.UTC(year - 2, 0, 1));
  const invoices = await loadIssuedInvoices(db, tenantId, start, now);
  const years = [year - 2, year - 1, year];
  const quarters = ["Q1", "Q2", "Q3", "Q4"];
  const series = years.map((y) => ({
    name: String(y),
    data: quarters.map((_, qi) => {
      let sum = 0;
      for (const inv of invoices) {
        if (!inv.issuedAt) continue;
        if (inv.issuedAt.getUTCFullYear() !== y) continue;
        if (Math.floor(inv.issuedAt.getUTCMonth() / 3) !== qi) continue;
        sum += invoiceSign(inv.kind) * toNumber(inv.total);
      }
      return Math.round(sum * 100) / 100;
    }),
  }));

  return {
    id: "sales-quarterly",
    title: "Τριμηνιαία απόδοση",
    periodLabel: `${year - 2}–${year}`,
    chart: { type: "bar", categories: quarters, series },
    kpis: years.map((y, yi) => ({
      label: String(y),
      value: money(series[yi]!.data.reduce((a, b) => a + b, 0)),
    })),
    table: {
      columns: [
        { key: "q", label: "Τρίμηνο" },
        ...years.map((y) => ({ key: String(y), label: String(y) })),
      ],
      rows: quarters.map((q, qi) => {
        const row: Record<string, string | number | null> = { q };
        years.forEach((y, yi) => {
          row[String(y)] = series[yi]!.data[qi]!;
        });
        return row;
      }),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesPareto(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const invoices = await loadIssuedInvoices(db, tenantId, start, end);
  const byCustomer = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.kind === "SALES_CREDIT") continue;
    byCustomer.set(
      inv.customerId,
      (byCustomer.get(inv.customerId) ?? 0) + toNumber(inv.total),
    );
  }
  const ranked = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  let cum = 0;
  let customersFor80 = ranked.length;
  const top = ranked.slice(0, 15);
  const ids = top.map(([id]) => id);
  const customers = await db.customer.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, name: true, code: true },
  });
  const nameMap = new Map(customers.map((c) => [c.id, c]));

  const categories: string[] = [];
  const salesData: number[] = [];
  const cumPct: number[] = [];
  for (const [id, val] of top) {
    cum += val;
    const c = nameMap.get(id);
    categories.push(c?.name ?? id.slice(0, 8));
    salesData.push(Math.round(val * 100) / 100);
    cumPct.push(total > 0 ? Math.round((cum / total) * 1000) / 10 : 0);
  }
  for (let i = 0; i < ranked.length; i++) {
    const running = ranked.slice(0, i + 1).reduce((s, [, v]) => s + v, 0);
    if (total > 0 && running / total >= 0.8) {
      customersFor80 = i + 1;
      break;
    }
  }

  return {
    id: "sales-pareto",
    title: "Pareto πελατών (80/20)",
    periodLabel: label,
    chart: {
      type: "bar",
      categories,
      series: [
        { name: "Πωλήσεις", data: salesData },
        { name: "Αθροιστικό %", data: cumPct },
      ],
    },
    kpis: [
      { label: "Πελάτες για 80%", value: customersFor80 },
      {
        label: "% πελατών",
        value:
          ranked.length > 0
            ? `${Math.round((customersFor80 / ranked.length) * 1000) / 10}%`
            : "—",
      },
      { label: "Σύνολο", value: money(total) },
    ],
    table: {
      columns: [
        { key: "customer", label: "Πελάτης" },
        { key: "sales", label: "Πωλήσεις" },
        { key: "share", label: "Μερίδιο %" },
        { key: "cum", label: "Αθροιστικό %" },
      ],
      rows: top.map(([id, val], i) => ({
        customer: nameMap.get(id)?.name ?? id,
        sales: Math.round(val * 100) / 100,
        share: total > 0 ? Math.round((val / total) * 1000) / 10 : 0,
        cum: cumPct[i]!,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesAov(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "12m");
  const buckets = buildMonthBuckets(start, end);
  const invoices = await loadIssuedInvoices(db, tenantId, start, end);
  const salesMap = new Map(buckets.map((k) => [k, 0]));
  const countMap = new Map(buckets.map((k) => [k, 0]));
  for (const inv of invoices) {
    if (!inv.issuedAt || inv.kind === "SALES_CREDIT") continue;
    const k = monthKey(inv.issuedAt);
    if (!salesMap.has(k)) continue;
    salesMap.set(k, (salesMap.get(k) ?? 0) + toNumber(inv.total));
    countMap.set(k, (countMap.get(k) ?? 0) + 1);
  }
  const aov = buckets.map((k) => {
    const c = countMap.get(k) ?? 0;
    const s = salesMap.get(k) ?? 0;
    return c ? Math.round((s / c) * 100) / 100 : 0;
  });
  const counts = buckets.map((k) => countMap.get(k) ?? 0);
  const totalSales = [...salesMap.values()].reduce((a, b) => a + b, 0);
  const totalCount = [...countMap.values()].reduce((a, b) => a + b, 0);

  return {
    id: "sales-aov",
    title: "AOV · Μέση αξία παραστατικού",
    periodLabel: label,
    chart: {
      type: "line",
      categories: buckets.map(monthLabel),
      series: [
        { name: "AOV €", data: aov },
        { name: "Πλήθος", data: counts },
      ],
    },
    kpis: [
      {
        label: "Μέσο AOV",
        value: money(totalCount ? totalSales / totalCount : 0),
      },
      { label: "Παραστατικά", value: totalCount },
    ],
    table: {
      columns: [
        { key: "month", label: "Μήνας" },
        { key: "aov", label: "AOV" },
        { key: "count", label: "Πλήθος" },
        { key: "sales", label: "Πωλήσεις" },
      ],
      rows: buckets.map((k, i) => ({
        month: monthLabel(k),
        aov: aov[i]!,
        count: counts[i]!,
        sales: Math.round((salesMap.get(k) ?? 0) * 100) / 100,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesNewVsReturning(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "12m");
  // First-ever invoice per customer (any time)
  const firsts = await db.invoice.groupBy({
    by: ["customerId"],
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      kind: { not: "SALES_CREDIT" },
      issuedAt: { not: null },
    },
    _min: { issuedAt: true },
  });
  const firstMap = new Map(
    firsts.map((f) => [f.customerId, f._min.issuedAt?.getTime() ?? 0]),
  );

  const buckets = buildMonthBuckets(start, end);
  const newMap = new Map(buckets.map((k) => [k, 0]));
  const retMap = new Map(buckets.map((k) => [k, 0]));
  const invoices = await loadIssuedInvoices(db, tenantId, start, end);
  for (const inv of invoices) {
    if (!inv.issuedAt || inv.kind === "SALES_CREDIT") continue;
    const k = monthKey(inv.issuedAt);
    if (!newMap.has(k)) continue;
    const first = firstMap.get(inv.customerId) ?? 0;
    const isNew =
      first > 0 && monthKey(new Date(first)) === k;
    const amt = toNumber(inv.total);
    if (isNew) newMap.set(k, (newMap.get(k) ?? 0) + amt);
    else retMap.set(k, (retMap.get(k) ?? 0) + amt);
  }
  const newData = buckets.map(
    (k) => Math.round((newMap.get(k) ?? 0) * 100) / 100,
  );
  const retData = buckets.map(
    (k) => Math.round((retMap.get(k) ?? 0) * 100) / 100,
  );

  return {
    id: "sales-new-vs-returning",
    title: "Νέοι vs υπάρχοντες πελάτες",
    periodLabel: label,
    chart: {
      type: "area",
      categories: buckets.map(monthLabel),
      series: [
        { name: "Νέοι", data: newData },
        { name: "Υπάρχοντες", data: retData },
      ],
    },
    kpis: [
      { label: "Νέοι", value: money(newData.reduce((a, b) => a + b, 0)) },
      {
        label: "Υπάρχοντες",
        value: money(retData.reduce((a, b) => a + b, 0)),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesCustomerGrowth(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  const [cur, prev] = await Promise.all([
    loadIssuedInvoices(db, tenantId, start, end),
    loadIssuedInvoices(db, tenantId, prevStart, prevEnd),
  ]);
  const curMap = new Map<string, number>();
  const prevMap = new Map<string, number>();
  for (const inv of cur) {
    if (inv.kind === "SALES_CREDIT") continue;
    curMap.set(
      inv.customerId,
      (curMap.get(inv.customerId) ?? 0) + toNumber(inv.total),
    );
  }
  for (const inv of prev) {
    if (inv.kind === "SALES_CREDIT") continue;
    prevMap.set(
      inv.customerId,
      (prevMap.get(inv.customerId) ?? 0) + toNumber(inv.total),
    );
  }
  const ids = new Set([...curMap.keys(), ...prevMap.keys()]);
  const deltas = [...ids].map((id) => {
    const c = curMap.get(id) ?? 0;
    const p = prevMap.get(id) ?? 0;
    return { id, current: c, prior: p, delta: c - p };
  });
  const growers = [...deltas].sort((a, b) => b.delta - a.delta).slice(0, 8);
  const decliners = [...deltas].sort((a, b) => a.delta - b.delta).slice(0, 8);
  const mixed = [...growers, ...decliners.filter((d) => !growers.includes(d))];
  const cust = await db.customer.findMany({
    where: { tenantId, id: { in: mixed.map((m) => m.id) } },
    select: { id: true, name: true },
  });
  const names = new Map(cust.map((c) => [c.id, c.name]));

  const show = [...growers.slice(0, 5), ...decliners.slice(0, 5)];
  return {
    id: "sales-customer-growth",
    title: "Ανάπτυξη / πτώση πελατών",
    periodLabel: label,
    chart: {
      type: "bar",
      categories: show.map((s) => names.get(s.id) ?? s.id.slice(0, 8)),
      series: [
        {
          name: "Μεταβολή €",
          data: show.map((s) => Math.round(s.delta * 100) / 100),
        },
      ],
    },
    kpis: [
      {
        label: "Top grower",
        value: growers[0]
          ? `${names.get(growers[0].id) ?? "—"} · ${money(growers[0].delta)}`
          : "—",
      },
      {
        label: "Top decliner",
        value: decliners[0]
          ? `${names.get(decliners[0].id) ?? "—"} · ${money(decliners[0].delta)}`
          : "—",
      },
    ],
    table: {
      columns: [
        { key: "customer", label: "Πελάτης" },
        { key: "current", label: "Τρέχουσα" },
        { key: "prior", label: "Προηγ." },
        { key: "delta", label: "Δ €" },
      ],
      rows: show.map((s) => ({
        customer: names.get(s.id) ?? s.id,
        current: Math.round(s.current * 100) / 100,
        prior: Math.round(s.prior * 100) / 100,
        delta: Math.round(s.delta * 100) / 100,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesCreditRatio(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "12m");
  const buckets = buildMonthBuckets(start, end);
  const invoices = await loadIssuedInvoices(db, tenantId, start, end);
  const salesMap = new Map(buckets.map((k) => [k, 0]));
  const creditMap = new Map(buckets.map((k) => [k, 0]));
  for (const inv of invoices) {
    if (!inv.issuedAt) continue;
    const k = monthKey(inv.issuedAt);
    if (!salesMap.has(k)) continue;
    const amt = toNumber(inv.total);
    if (inv.kind === "SALES_CREDIT") {
      creditMap.set(k, (creditMap.get(k) ?? 0) + amt);
    } else {
      salesMap.set(k, (salesMap.get(k) ?? 0) + amt);
    }
  }
  const ratio = buckets.map((k) => {
    const s = salesMap.get(k) ?? 0;
    const c = creditMap.get(k) ?? 0;
    return s > 0 ? Math.round((c / s) * 1000) / 10 : 0;
  });
  const totalSales = [...salesMap.values()].reduce((a, b) => a + b, 0);
  const totalCredits = [...creditMap.values()].reduce((a, b) => a + b, 0);

  return {
    id: "sales-credit-ratio",
    title: "Credit note ratio",
    periodLabel: label,
    chart: {
      type: "line",
      categories: buckets.map(monthLabel),
      series: [
        { name: "Credit %", data: ratio },
        {
          name: "Πιστωτικά €",
          data: buckets.map(
            (k) => Math.round((creditMap.get(k) ?? 0) * 100) / 100,
          ),
        },
      ],
    },
    kpis: [
      {
        label: "Μέσο ratio",
        value:
          totalSales > 0
            ? `${Math.round((totalCredits / totalSales) * 1000) / 10}%`
            : "—",
      },
      { label: "Πιστωτικά", value: money(totalCredits) },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesWeekday(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const invoices = await loadIssuedInvoices(db, tenantId, start, end);
  const days = ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"];
  const data = new Array(7).fill(0) as number[];
  for (const inv of invoices) {
    if (!inv.issuedAt || inv.kind === "SALES_CREDIT") continue;
    const day = inv.issuedAt.getUTCDay();
    data[day] = (data[day] ?? 0) + toNumber(inv.total);
  }
  const rounded = data.map((v) => Math.round(v * 100) / 100);
  return {
    id: "sales-weekday",
    title: "Εποχικότητα ανά ημέρα",
    periodLabel: label,
    chart: {
      type: "bar",
      categories: days,
      series: [{ name: "Πωλήσεις", data: rounded }],
    },
    kpis: [
      {
        label: "Καλύτερη ημέρα",
        value: days[rounded.indexOf(Math.max(...rounded))] ?? "—",
      },
      { label: "Σύνολο", value: money(rounded.reduce((a, b) => a + b, 0)) },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesCollectionEfficiency(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "12m");
  const buckets = buildMonthBuckets(start, end);
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      kind: { not: "SALES_CREDIT" },
      issuedAt: { gte: start, lte: end },
      paidAmount: { gt: 0 },
    },
    select: {
      issuedAt: true,
      total: true,
      paidAmount: true,
      payments: {
        select: { paidAt: true, amount: true },
        orderBy: { paidAt: "asc" },
        take: 1,
      },
    },
  });
  const sumMap = new Map(buckets.map((k) => [k, 0]));
  const cntMap = new Map(buckets.map((k) => [k, 0]));
  for (const inv of invoices) {
    if (!inv.issuedAt || !inv.payments[0]) continue;
    const k = monthKey(inv.issuedAt);
    if (!sumMap.has(k)) continue;
    const days = Math.max(
      0,
      Math.round(
        (inv.payments[0].paidAt.getTime() - inv.issuedAt.getTime()) /
          86_400_000,
      ),
    );
    sumMap.set(k, (sumMap.get(k) ?? 0) + days);
    cntMap.set(k, (cntMap.get(k) ?? 0) + 1);
  }
  const avgDays = buckets.map((k) => {
    const c = cntMap.get(k) ?? 0;
    return c ? Math.round(((sumMap.get(k) ?? 0) / c) * 10) / 10 : 0;
  });
  const overallCnt = [...cntMap.values()].reduce((a, b) => a + b, 0);
  const overallSum = [...sumMap.values()].reduce((a, b) => a + b, 0);

  return {
    id: "sales-collection-efficiency",
    title: "Ταχύτητα είσπραξης (DSO proxy)",
    periodLabel: label,
    chart: {
      type: "line",
      categories: buckets.map(monthLabel),
      series: [{ name: "Μέρες έως 1η είσπραξη", data: avgDays }],
    },
    kpis: [
      {
        label: "Μέσος όρος",
        value: overallCnt
          ? `${Math.round((overallSum / overallCnt) * 10) / 10} ημ.`
          : "—",
      },
      { label: "Δείγμα", value: overallCnt },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesQuoteConversion(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const quotes = await db.order.findMany({
    where: {
      tenantId,
      kind: "SALES_QUOTE",
      createdAt: { gte: start, lte: end },
    },
    select: { id: true, status: true, total: true },
  });
  const converted = quotes.filter(
    (q) => q.status === "INVOICED" || q.status === "CONFIRMED" || q.status === "PARTIAL_INVOICED",
  );
  // Also count quotes that became orders via sourceQuoteId
  const linked = await db.order.count({
    where: {
      tenantId,
      kind: "SALES_ORDER",
      sourceQuoteId: { in: quotes.map((q) => q.id) },
    },
  });
  const won = Math.max(converted.length, linked);
  const lost = Math.max(0, quotes.length - won);
  const open = quotes.filter((q) => q.status === "DRAFT").length;
  const winRate = quotes.length ? (won / quotes.length) * 100 : 0;
  const quoteValue = quotes.reduce((s, q) => s + toNumber(q.total), 0);

  return {
    id: "sales-quote-conversion",
    title: "Conversion προσφορών",
    periodLabel: label,
    chart: {
      type: "donut",
      labels: ["Κερδισμένες", "Ανοιχτές", "Χαμένες/άλλες"],
      series: [won, open, Math.max(0, lost - open)],
    },
    kpis: [
      { label: "Win rate", value: `${Math.round(winRate * 10) / 10}%` },
      { label: "Προσφορές", value: quotes.length },
      { label: "Αξία pipeline", value: money(quoteValue) },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesProductVelocity(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
  limit: number,
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const lines = await db.invoiceLine.findMany({
    where: {
      tenantId,
      productId: { not: null },
      invoice: {
        tenantId,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        kind: { not: "SALES_CREDIT" },
        issuedAt: { gte: start, lte: end },
      },
    },
    select: {
      productId: true,
      quantity: true,
      lineTotal: true,
      invoiceId: true,
      product: { select: { sku: true, name: true } },
    },
    take: 8000,
  });
  const agg = new Map<
    string,
    { name: string; sku: string; qty: number; value: number; docs: Set<string> }
  >();
  for (const line of lines) {
    if (!line.productId) continue;
    const cur = agg.get(line.productId) ?? {
      name: line.product?.name ?? line.productId,
      sku: line.product?.sku ?? "—",
      qty: 0,
      value: 0,
      docs: new Set<string>(),
    };
    cur.qty += toNumber(line.quantity);
    cur.value += toNumber(line.lineTotal);
    cur.docs.add(line.invoiceId);
    agg.set(line.productId, cur);
  }
  const ranked = [...agg.values()]
    .map((r) => ({
      ...r,
      velocity: r.docs.size * r.qty,
      docCount: r.docs.size,
    }))
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, limit);

  return {
    id: "sales-product-velocity",
    title: "Ταχύτητα ειδών",
    periodLabel: label,
    chart: {
      type: "bar",
      categories: ranked.map((r) => r.name),
      series: [
        {
          name: "Velocity",
          data: ranked.map((r) => Math.round(r.velocity * 100) / 100),
        },
      ],
    },
    kpis: [
      { label: "Top είδος", value: ranked[0]?.name ?? "—" },
      { label: "Είδη", value: ranked.length },
    ],
    table: {
      columns: [
        { key: "sku", label: "SKU" },
        { key: "name", label: "Είδος" },
        { key: "qty", label: "Qty" },
        { key: "docs", label: "Παραστατικά" },
        { key: "value", label: "Αξία" },
      ],
      rows: ranked.map((r) => ({
        sku: r.sku,
        name: r.name,
        qty: Math.round(r.qty * 1000) / 1000,
        docs: r.docCount,
        value: Math.round(r.value * 100) / 100,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesRepeatRate(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const invoices = await loadIssuedInvoices(db, tenantId, start, end);
  const counts = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.kind === "SALES_CREDIT") continue;
    counts.set(inv.customerId, (counts.get(inv.customerId) ?? 0) + 1);
  }
  const total = counts.size;
  const repeat = [...counts.values()].filter((c) => c >= 2).length;
  const once = total - repeat;
  const rate = total ? Math.round((repeat / total) * 1000) / 10 : 0;

  return {
    id: "sales-repeat-rate",
    title: "Repeat purchase rate",
    periodLabel: label,
    chart: {
      type: "radialBar",
      labels: ["Repeat %", "Once %", "Coverage"],
      series: [rate, total ? Math.round((once / total) * 1000) / 10 : 0, 100],
    },
    kpis: [
      { label: "Repeat rate", value: `${rate}%` },
      { label: "Επαναλαμβανόμενοι", value: repeat },
      { label: "Μία αγορά", value: once },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesBySite(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const invoices = await loadIssuedInvoices(db, tenantId, start, end);
  const map = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.kind === "SALES_CREDIT") continue;
    const key = inv.siteId ?? "__none__";
    map.set(key, (map.get(key) ?? 0) + toNumber(inv.total));
  }
  const siteIds = [...map.keys()].filter((k) => k !== "__none__");
  const sites = await db.site.findMany({
    where: { tenantId, id: { in: siteIds } },
    select: { id: true, code: true, name: true },
  });
  const nameMap = new Map(sites.map((s) => [s.id, s]));
  const ranked = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return {
    id: "sales-by-site",
    title: "Πωλήσεις ανά εγκατάσταση",
    periodLabel: label,
    chart: {
      type: "bar",
      categories: ranked.map(([id]) =>
        id === "__none__" ? "Χωρίς site" : nameMap.get(id)?.name ?? id.slice(0, 8),
      ),
      series: [
        {
          name: "Πωλήσεις",
          data: ranked.map(([, v]) => Math.round(v * 100) / 100),
        },
      ],
    },
    kpis: [
      {
        label: "Σύνολο",
        value: money(ranked.reduce((s, [, v]) => s + v, 0)),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function runSalesByKind(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const invoices = await loadIssuedInvoices(db, tenantId, start, end);
  const kinds = ["SALES_INVOICE", "SALES_CREDIT", "RETAIL_RECEIPT"] as const;
  const labels = ["Τιμολόγια", "Πιστωτικά", "ΑΠΥ"];
  const totals = kinds.map((k) =>
    Math.round(
      invoices
        .filter((i) => i.kind === k)
        .reduce((s, i) => s + toNumber(i.total), 0) * 100,
    ) / 100,
  );
  return {
    id: "sales-by-kind",
    title: "Μείγμα παραστατικών",
    periodLabel: label,
    chart: { type: "donut", labels, series: totals },
    kpis: labels.map((l, i) => ({ label: l, value: money(totals[i]!) })),
    generatedAt: new Date().toISOString(),
  };
}
