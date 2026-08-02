import type { PrismaClient } from "@/generated/prisma/client";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  loadApRows,
  loadArRows,
  loadVatSummary,
} from "@/modules/finance/analytics";
import {
  getReportDefinition,
  type ChartKind,
  type ReportDefinition,
} from "./catalog";
import {
  runSalesAov,
  runSalesByKind,
  runSalesBySite,
  runSalesCollectionEfficiency,
  runSalesCreditRatio,
  runSalesCustomerGrowth,
  runSalesNewVsReturning,
  runSalesPareto,
  runSalesPeriodCompare,
  runSalesProductVelocity,
  runSalesQuarterly,
  runSalesQuoteConversion,
  runSalesRepeatRate,
  runSalesTtm,
  runSalesWeekday,
  runSalesYoY,
} from "./advanced-sales";
import {
  runGridApOpen,
  runGridArOpen,
  runGridCollections,
  runGridCustomerAnalysis,
  runGridInvoiceRegister,
  runGridSalesLines,
  runGridStockBalances,
  runGridVatRegister,
} from "./grid-reports";
import { resolvePeriod } from "./period";
import type { ReportRunInput } from "./schemas";

export type ReportKpi = {
  label: string;
  value: string | number;
  hint?: string;
};

export type ReportColumnType =
  | "string"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "int";

export type ReportTableColumn = {
  key: string;
  label: string;
  type?: ReportColumnType;
  align?: "start" | "end" | "center";
  sortable?: boolean;
};

export type ReportTable = {
  columns: ReportTableColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** Footer aggregates keyed by column */
  totals?: Record<string, string | number | null>;
  /** Preferred page size for grid UI */
  pageSize?: number;
};

export type ReportChartPayload = {
  type: ChartKind;
  series: Array<{ name: string; data: number[] }> | number[];
  categories?: string[];
  labels?: string[];
};

export type ReportResult = {
  id: string;
  title: string;
  description?: string;
  periodLabel: string;
  /** Omitted or type=table → grid-first presentation */
  chart?: ReportChartPayload | null;
  presentation?: "chart" | "table" | "both";
  kpis?: ReportKpi[];
  table?: ReportTable;
  generatedAt: string;
};

function money(n: number) {
  return n.toLocaleString("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
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

export { resolvePeriod };

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

function invoiceSign(kind: string) {
  return kind === "SALES_CREDIT" ? -1 : 1;
}

async function runSalesTrend(
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
      issuedAt: { gte: start, lte: end },
    },
    select: { issuedAt: true, total: true, vatAmount: true, kind: true },
  });
  const salesMap = new Map(buckets.map((k) => [k, 0]));
  const vatMap = new Map(buckets.map((k) => [k, 0]));
  for (const inv of invoices) {
    if (!inv.issuedAt) continue;
    const k = monthKey(inv.issuedAt);
    if (!salesMap.has(k)) continue;
    const sign = invoiceSign(inv.kind);
    salesMap.set(k, (salesMap.get(k) ?? 0) + sign * toNumber(inv.total));
    vatMap.set(k, (vatMap.get(k) ?? 0) + sign * toNumber(inv.vatAmount));
  }
  const sales = buckets.map((k) =>
    Math.round((salesMap.get(k) ?? 0) * 100) / 100,
  );
  const vat = buckets.map((k) => Math.round((vatMap.get(k) ?? 0) * 100) / 100);
  const total = sales.reduce((a, b) => a + b, 0);
  return {
    id: "sales-trend",
    title: "Τάση πωλήσεων",
    description: "Καθαρές πωλήσεις και ΦΠΑ ανά μήνα",
    periodLabel: label,
    chart: {
      type: "area",
      categories: buckets.map(monthLabel),
      series: [
        { name: "Πωλήσεις", data: sales },
        { name: "ΦΠΑ", data: vat },
      ],
    },
    kpis: [
      { label: "Σύνολο περιόδου", value: money(total) },
      {
        label: "Μέσος μήνας",
        value: money(buckets.length ? total / buckets.length : 0),
      },
    ],
    table: {
      columns: [
        { key: "month", label: "Μήνας" },
        { key: "sales", label: "Πωλήσεις" },
        { key: "vat", label: "ΦΠΑ" },
      ],
      rows: buckets.map((k, i) => ({
        month: monthLabel(k),
        sales: sales[i]!,
        vat: vat[i]!,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runSalesByCustomer(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
  limit: number,
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const grouped = await db.invoice.groupBy({
    by: ["customerId"],
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issuedAt: { gte: start, lte: end },
      kind: { not: "SALES_CREDIT" },
    },
    _sum: { total: true },
    orderBy: { _sum: { total: "desc" } },
    take: limit,
  });
  const customers = await db.customer.findMany({
    where: { tenantId, id: { in: grouped.map((g) => g.customerId) } },
    select: { id: true, code: true, name: true },
  });
  const map = new Map(customers.map((c) => [c.id, c]));
  const categories = grouped.map((g) => {
    const c = map.get(g.customerId);
    return c ? c.name : g.customerId.slice(0, 8);
  });
  const data = grouped.map(
    (g) => Math.round(toNumber(g._sum.total ?? 0) * 100) / 100,
  );
  const total = data.reduce((a, b) => a + b, 0);
  return {
    id: "sales-by-customer",
    title: "Top πελάτες",
    periodLabel: label,
    chart: {
      type: "bar",
      categories,
      series: [{ name: "Κύκλος εργασιών", data }],
    },
    kpis: [
      { label: "Top σύνολο", value: money(total) },
      { label: "Πελάτες", value: grouped.length },
    ],
    table: {
      columns: [
        { key: "customer", label: "Πελάτης" },
        { key: "code", label: "Κωδικός" },
        { key: "total", label: "Σύνολο" },
      ],
      rows: grouped.map((g, i) => {
        const c = map.get(g.customerId);
        return {
          customer: c?.name ?? "—",
          code: c?.code ?? "—",
          total: data[i]!,
        };
      }),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runSalesByProduct(
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
        issuedAt: { gte: start, lte: end },
        kind: { not: "SALES_CREDIT" },
      },
    },
    select: {
      productId: true,
      lineTotal: true,
      quantity: true,
      product: { select: { sku: true, name: true } },
    },
    take: 5000,
  });
  const agg = new Map<
    string,
    { label: string; code: string; total: number; qty: number }
  >();
  for (const line of lines) {
    if (!line.productId) continue;
    const cur = agg.get(line.productId) ?? {
      label: line.product?.name ?? line.productId,
      code: line.product?.sku ?? "—",
      total: 0,
      qty: 0,
    };
    cur.total += toNumber(line.lineTotal);
    cur.qty += toNumber(line.quantity);
    agg.set(line.productId, cur);
  }
  const ranked = [...agg.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  return {
    id: "sales-by-product",
    title: "Top είδη",
    periodLabel: label,
    chart: {
      type: "bar",
      categories: ranked.map((r) => r.label),
      series: [
        {
          name: "Πωλήσεις",
          data: ranked.map((r) => Math.round(r.total * 100) / 100),
        },
      ],
    },
    kpis: [
      {
        label: "Top σύνολο",
        value: money(ranked.reduce((s, r) => s + r.total, 0)),
      },
    ],
    table: {
      columns: [
        { key: "code", label: "Κωδικός" },
        { key: "name", label: "Είδος" },
        { key: "qty", label: "Ποσότητα" },
        { key: "total", label: "Αξία" },
      ],
      rows: ranked.map((r) => ({
        code: r.code,
        name: r.label,
        qty: Math.round(r.qty * 1000) / 1000,
        total: Math.round(r.total * 100) / 100,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runArAging(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const rows = await loadArRows(db, tenantId);
  const buckets = ["current", "1-30", "31-60", "61-90", "90+"] as const;
  const labels = ["Τρέχον", "1–30", "31–60", "61–90", "90+"];
  const totals = buckets.map((b) =>
    Math.round(
      rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.balance, 0) *
        100,
    ) / 100,
  );
  const total = totals.reduce((a, b) => a + b, 0);
  return {
    id: "ar-aging",
    title: "Aging απαιτήσεων (AR)",
    periodLabel: "Ανοιχτά υπόλοιπα",
    chart: {
      type: "donut",
      labels,
      series: totals,
    },
    kpis: [
      { label: "Open AR", value: money(total) },
      { label: "Παραστατικά", value: rows.length },
      {
        label: "90+",
        value: money(totals[4]!),
        hint: "Κρίσιμο",
      },
    ],
    table: {
      columns: [
        { key: "number", label: "Παραστατικό" },
        { key: "customer", label: "Πελάτης" },
        { key: "bucket", label: "Bucket" },
        { key: "balance", label: "Υπόλοιπο" },
      ],
      rows: rows.slice(0, 40).map((r) => ({
        number: r.number,
        customer: r.customer.name,
        bucket: r.bucket,
        balance: r.balance,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runVatBreakdown(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "ytd");
  const vat = await loadVatSummary(db, tenantId, start, end);
  const rates = [...vat.byRate].sort((a, b) => a.vatRate - b.vatRate);
  const data = rates.map((r) => Math.round(r.vat * 100) / 100);
  return {
    id: "vat-breakdown",
    title: "Ανάλυση ΦΠΑ",
    periodLabel: label,
    chart: {
      type: "bar",
      categories: rates.map((r) => `${r.vatRate}%`),
      series: [{ name: "ΦΠΑ", data }],
    },
    kpis: [
      { label: "ΦΠΑ πωλήσεων", value: money(vat.salesVat) },
      { label: "Καθαρό πληρωτέο", value: money(vat.netVatPayable) },
    ],
    table: {
      columns: [
        { key: "rate", label: "Συντελεστής" },
        { key: "base", label: "Βάση" },
        { key: "vat", label: "ΦΠΑ" },
      ],
      rows: rates.map((r) => ({
        rate: `${r.vatRate}%`,
        base: Math.round(r.net * 100) / 100,
        vat: Math.round(r.vat * 100) / 100,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runCashCollections(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "12m");
  const buckets = buildMonthBuckets(start, end);
  const payments = await db.invoicePayment.findMany({
    where: { tenantId, createdAt: { gte: start, lte: end } },
    select: { createdAt: true, amount: true },
    take: 10000,
  });
  const map = new Map(buckets.map((k) => [k, 0]));
  for (const p of payments) {
    const k = monthKey(p.createdAt);
    if (!map.has(k)) continue;
    map.set(k, (map.get(k) ?? 0) + toNumber(p.amount));
  }
  const data = buckets.map(
    (k) => Math.round((map.get(k) ?? 0) * 100) / 100,
  );
  const total = data.reduce((a, b) => a + b, 0);
  return {
    id: "cash-collections",
    title: "Εισπράξεις",
    periodLabel: label,
    chart: {
      type: "line",
      categories: buckets.map(monthLabel),
      series: [{ name: "Εισπράξεις", data }],
    },
    kpis: [{ label: "Σύνολο", value: money(total) }],
    table: {
      columns: [
        { key: "month", label: "Μήνας" },
        { key: "amount", label: "Ποσό" },
      ],
      rows: buckets.map((k, i) => ({
        month: monthLabel(k),
        amount: data[i]!,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runStockBySite(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const rows = await db.stockBalance.groupBy({
    by: ["siteId"],
    where: { tenantId },
    _sum: { qtyOnHand: true },
  });
  const sites = await db.site.findMany({
    where: { tenantId, id: { in: rows.map((r) => r.siteId) } },
    select: { id: true, code: true, name: true },
  });
  const map = new Map(sites.map((s) => [s.id, s]));
  const ordered = [...rows].sort(
    (a, b) => toNumber(b._sum.qtyOnHand ?? 0) - toNumber(a._sum.qtyOnHand ?? 0),
  );
  const categories = ordered.map((r) => {
    const s = map.get(r.siteId);
    return s ? s.name : r.siteId.slice(0, 8);
  });
  const data = ordered.map(
    (r) => Math.round(toNumber(r._sum.qtyOnHand ?? 0) * 1000) / 1000,
  );
  return {
    id: "stock-by-site",
    title: "Απόθεμα ανά εγκατάσταση",
    periodLabel: "Τρέχον",
    chart: {
      type: "bar",
      categories,
      series: [{ name: "Ποσότητα", data }],
    },
    kpis: [
      {
        label: "Σύνολο qty",
        value: Math.round(data.reduce((a, b) => a + b, 0) * 1000) / 1000,
      },
    ],
    table: {
      columns: [
        { key: "site", label: "Εγκατάσταση" },
        { key: "code", label: "Κωδικός" },
        { key: "qty", label: "Ποσότητα" },
      ],
      rows: ordered.map((r, i) => {
        const s = map.get(r.siteId);
        return {
          site: s?.name ?? "—",
          code: s?.code ?? "—",
          qty: data[i]!,
        };
      }),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runLowStock(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const rows = await db.stockBalance.findMany({
    where: { tenantId, qtyOnHand: { lte: 5 } },
    orderBy: { qtyOnHand: "asc" },
    take: 20,
    include: {
      product: { select: { sku: true, name: true } },
      site: { select: { code: true, name: true } },
    },
  });
  return {
    id: "low-stock",
    title: "Χαμηλό απόθεμα",
    periodLabel: "qty ≤ 5",
    chart: {
      type: "bar",
      categories: rows.map((r) => r.product.name),
      series: [
        {
          name: "On hand",
          data: rows.map((r) => toNumber(r.qtyOnHand)),
        },
      ],
    },
    kpis: [{ label: "Είδη σε κίνδυνο", value: rows.length }],
    table: {
      columns: [
        { key: "product", label: "Είδος" },
        { key: "site", label: "Εγκατάσταση" },
        { key: "qty", label: "Qty" },
      ],
      rows: rows.map((r) => ({
        product: `${r.product.sku} · ${r.product.name}`,
        site: r.site.name,
        qty: toNumber(r.qtyOnHand),
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runOrdersPipeline(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const grouped = await db.order.groupBy({
    by: ["status"],
    where: { tenantId },
    _count: { _all: true },
  });
  const labels = grouped.map((g) => g.status);
  const data = grouped.map((g) => g._count._all);
  return {
    id: "orders-pipeline",
    title: "Pipeline παραγγελιών",
    periodLabel: "Όλες",
    chart: { type: "donut", labels, series: data },
    kpis: [
      { label: "Σύνολο", value: data.reduce((a, b) => a + b, 0) },
      {
        label: "Ανοιχτές",
        value: grouped
          .filter((g) => ["DRAFT", "CONFIRMED", "PARTIAL_INVOICED"].includes(g.status))
          .reduce((s, g) => s + g._count._all, 0),
      },
    ],
    table: {
      columns: [
        { key: "status", label: "Κατάσταση" },
        { key: "count", label: "Πλήθος" },
      ],
      rows: grouped.map((g) => ({
        status: g.status,
        count: g._count._all,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runDeliveryVolume(
  db: PrismaClient,
  tenantId: string,
  period: ReportRunInput["period"],
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period ?? "12m");
  const buckets = buildMonthBuckets(start, end);
  const notes = await db.deliveryNote.findMany({
    where: {
      tenantId,
      status: "ISSUED",
      issuedAt: { gte: start, lte: end },
    },
    select: { issuedAt: true },
  });
  const map = new Map(buckets.map((k) => [k, 0]));
  for (const n of notes) {
    if (!n.issuedAt) continue;
    const k = monthKey(n.issuedAt);
    if (!map.has(k)) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const data = buckets.map((k) => map.get(k) ?? 0);
  return {
    id: "delivery-volume",
    title: "Δελτία αποστολής",
    periodLabel: label,
    chart: {
      type: "area",
      categories: buckets.map(monthLabel),
      series: [{ name: "Δελτία", data }],
    },
    kpis: [{ label: "Σύνολο", value: data.reduce((a, b) => a + b, 0) }],
    generatedAt: new Date().toISOString(),
  };
}

async function runHrHeadcount(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const [active, inactive, terminated, pendingLeave, activeCards] =
    await Promise.all([
      db.employee.count({ where: { tenantId, status: "ACTIVE" } }),
      db.employee.count({ where: { tenantId, status: "INACTIVE" } }),
      db.employee.count({ where: { tenantId, status: "TERMINATED" } }),
      db.leaveRequest.count({ where: { tenantId, status: "PENDING" } }),
      db.workCard.count({ where: { tenantId, status: "ACTIVE" } }),
    ]);
  const total = active + inactive + terminated;
  return {
    id: "hr-headcount",
    title: "Προσωπικό & άδειες",
    periodLabel: "Τρέχον",
    chart: {
      type: "radialBar",
      labels: ["Ενεργοί", "Κάρτες", "Άδειες"],
      series: [
        total ? Math.round((active / total) * 100) : 0,
        active ? Math.min(100, Math.round((activeCards / active) * 100)) : 0,
        Math.min(100, pendingLeave * 10),
      ],
    },
    kpis: [
      { label: "Ενεργοί", value: active },
      { label: "Κάρτες", value: activeCards },
      { label: "Άδειες σε αναμονή", value: pendingLeave },
    ],
    table: {
      columns: [
        { key: "metric", label: "Μετρική" },
        { key: "value", label: "Τιμή" },
      ],
      rows: [
        { metric: "Ενεργοί", value: active },
        { metric: "Ανενεργοί", value: inactive },
        { metric: "Αποχωρήσεις", value: terminated },
        { metric: "Ενεργές κάρτες", value: activeCards },
        { metric: "Άδειες PENDING", value: pendingLeave },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runBuilder(
  db: PrismaClient,
  tenantId: string,
  input: ReportRunInput,
): Promise<ReportResult> {
  const period = input.period ?? "ytd";
  const groupBy = input.groupBy ?? "month";
  const metrics = input.metrics ?? ["revenue"];
  const viewMode = input.viewMode ?? "both";
  const includeTotals = input.includeTotals !== false;
  const chartType = (input.chartType ??
    (viewMode === "table"
      ? "table"
      : groupBy === "month"
        ? "area"
        : "bar")) as ChartKind;
  const { start, end, label } = resolvePeriod(period);
  const limit = input.limit ?? (viewMode === "table" ? 100 : 12);

  const series: Array<{ name: string; data: number[] }> = [];
  let categories: string[] = [];
  const tableRows: Array<Record<string, string | number | null>> = [];

  if (groupBy === "month") {
    const buckets = buildMonthBuckets(start, end);
    categories = buckets.map(monthLabel);

    if (metrics.includes("revenue") || metrics.includes("vat") || metrics.includes("invoices")) {
      const invoices = await db.invoice.findMany({
        where: {
          tenantId,
          status: { notIn: ["DRAFT", "CANCELLED"] },
          issuedAt: { gte: start, lte: end },
        },
        select: { issuedAt: true, total: true, vatAmount: true, kind: true },
      });
      const rev = new Map(buckets.map((k) => [k, 0]));
      const vat = new Map(buckets.map((k) => [k, 0]));
      const cnt = new Map(buckets.map((k) => [k, 0]));
      for (const inv of invoices) {
        if (!inv.issuedAt) continue;
        const k = monthKey(inv.issuedAt);
        if (!rev.has(k)) continue;
        const sign = invoiceSign(inv.kind);
        rev.set(k, (rev.get(k) ?? 0) + sign * toNumber(inv.total));
        vat.set(k, (vat.get(k) ?? 0) + sign * toNumber(inv.vatAmount));
        cnt.set(k, (cnt.get(k) ?? 0) + 1);
      }
      if (metrics.includes("revenue")) {
        series.push({
          name: "Έσοδα",
          data: buckets.map((k) => Math.round((rev.get(k) ?? 0) * 100) / 100),
        });
      }
      if (metrics.includes("vat")) {
        series.push({
          name: "ΦΠΑ",
          data: buckets.map((k) => Math.round((vat.get(k) ?? 0) * 100) / 100),
        });
      }
      if (metrics.includes("invoices")) {
        series.push({
          name: "Τιμολόγια",
          data: buckets.map((k) => cnt.get(k) ?? 0),
        });
      }
    }

    if (metrics.includes("orders")) {
      const orders = await db.order.findMany({
        where: { tenantId, createdAt: { gte: start, lte: end } },
        select: { createdAt: true },
      });
      const map = new Map(buckets.map((k) => [k, 0]));
      for (const o of orders) {
        const k = monthKey(o.createdAt);
        if (!map.has(k)) continue;
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      series.push({
        name: "Παραγγελίες",
        data: buckets.map((k) => map.get(k) ?? 0),
      });
    }

    if (metrics.includes("cash")) {
      const payments = await db.invoicePayment.findMany({
        where: { tenantId, createdAt: { gte: start, lte: end } },
        select: { createdAt: true, amount: true },
      });
      const map = new Map(buckets.map((k) => [k, 0]));
      for (const p of payments) {
        const k = monthKey(p.createdAt);
        if (!map.has(k)) continue;
        map.set(k, (map.get(k) ?? 0) + toNumber(p.amount));
      }
      series.push({
        name: "Ταμείο",
        data: buckets.map(
          (k) => Math.round((map.get(k) ?? 0) * 100) / 100,
        ),
      });
    }

    if (metrics.includes("stock")) {
      const movements = await db.stockMovement.findMany({
        where: { tenantId, createdAt: { gte: start, lte: end } },
        select: { createdAt: true, qty: true, type: true },
        take: 10000,
      });
      const map = new Map(buckets.map((k) => [k, 0]));
      for (const m of movements) {
        const k = monthKey(m.createdAt);
        if (!map.has(k)) continue;
        const qty = toNumber(m.qty);
        const signed = m.type === "OUT" ? -Math.abs(qty) : Math.abs(qty);
        map.set(k, (map.get(k) ?? 0) + signed);
      }
      series.push({
        name: "Κινήσεις αποθήκης",
        data: buckets.map(
          (k) => Math.round((map.get(k) ?? 0) * 1000) / 1000,
        ),
      });
    }

    for (let i = 0; i < buckets.length; i++) {
      const row: Record<string, string | number | null> = {
        dim: categories[i]!,
      };
      for (const s of series) row[s.name] = s.data[i] ?? 0;
      tableRows.push(row);
    }
  } else if (groupBy === "customer") {
    const grouped = await db.invoice.groupBy({
      by: ["customerId"],
      where: {
        tenantId,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        issuedAt: { gte: start, lte: end },
        kind: { not: "SALES_CREDIT" },
      },
      _sum: { total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: "desc" } },
      take: limit,
    });
    const customers = await db.customer.findMany({
      where: { tenantId, id: { in: grouped.map((g) => g.customerId) } },
      select: { id: true, name: true },
    });
    const map = new Map(customers.map((c) => [c.id, c.name]));
    categories = grouped.map((g) => map.get(g.customerId) ?? "—");
    if (metrics.includes("revenue")) {
      series.push({
        name: "Έσοδα",
        data: grouped.map(
          (g) => Math.round(toNumber(g._sum.total ?? 0) * 100) / 100,
        ),
      });
    }
    if (metrics.includes("invoices")) {
      series.push({
        name: "Τιμολόγια",
        data: grouped.map((g) => g._count._all),
      });
    }
    grouped.forEach((g, i) => {
      tableRows.push({
        dim: categories[i]!,
        revenue: Math.round(toNumber(g._sum.total ?? 0) * 100) / 100,
        invoices: g._count._all,
      });
    });
  } else if (groupBy === "product") {
    const productReport = await runSalesByProduct(db, tenantId, period, limit);
    const presentation =
      viewMode === "table"
        ? "table"
        : viewMode === "chart"
          ? "chart"
          : "both";
    return {
      ...productReport,
      id: "builder",
      title: "Προσαρμοσμένη αναφορά",
      description: `Μετρήσεις: ${metrics.join(", ")} · Ομαδοποίηση: είδος`,
      presentation,
      chart:
        presentation === "table"
          ? null
          : {
              ...productReport.chart!,
              type:
                chartType === "donut" || chartType === "table"
                  ? "bar"
                  : chartType,
            },
    };
  } else if (groupBy === "site") {
    const stock = await runStockBySite(db, tenantId);
    const presentation =
      viewMode === "table"
        ? "table"
        : viewMode === "chart"
          ? "chart"
          : "both";
    return {
      ...stock,
      id: "builder",
      title: "Προσαρμοσμένη αναφορά",
      description: `Μετρήσεις: ${metrics.join(", ")} · Ομαδοποίηση: εγκατάσταση`,
      periodLabel: label,
      presentation,
      chart:
        presentation === "table"
          ? null
          : {
              ...stock.chart!,
              type:
                chartType === "donut" || chartType === "table"
                  ? "bar"
                  : chartType,
            },
    };
  }

  if (series.length === 0) {
    series.push({ name: "—", data: categories.map(() => 0) });
  }

  const moneyMetric = (name: string) =>
    name.includes("Έσοδα") ||
    name.includes("ΦΠΑ") ||
    name.includes("Ταμείο");

  const columns: ReportTableColumn[] = [
    { key: "dim", label: "Διάσταση", type: "string", sortable: true },
    ...series.map((s) => ({
      key: s.name,
      label: s.name,
      type: (moneyMetric(s.name) ? "currency" : "number") as ReportColumnType,
      align: "end" as const,
      sortable: true,
    })),
  ];

  const totals: Record<string, string | number | null> | undefined =
    includeTotals
      ? {
          dim: `${tableRows.length} γραμμές`,
          ...Object.fromEntries(
            series.map((s) => [
              s.name,
              Math.round(s.data.reduce((a, b) => a + b, 0) * 1000) / 1000,
            ]),
          ),
        }
      : undefined;

  const presentation =
    viewMode === "table"
      ? "table"
      : viewMode === "chart"
        ? "chart"
        : "both";

  return {
    id: "builder",
    title: "Προσαρμοσμένη αναφορά",
    description: `Μετρήσεις: ${metrics.join(", ")} · ${groupBy}`,
    periodLabel: label,
    presentation,
    chart:
      presentation === "table" || chartType === "table"
        ? null
        : {
            type: chartType,
            categories,
            series,
          },
    kpis: series.map((s) => ({
      label: s.name,
      value: moneyMetric(s.name)
        ? money(s.data.reduce((a, b) => a + b, 0))
        : Math.round(s.data.reduce((a, b) => a + b, 0) * 1000) / 1000,
    })),
    table: {
      columns,
      rows: tableRows,
      totals,
      pageSize: viewMode === "table" ? 50 : 25,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function runReport(
  db: PrismaClient,
  tenantId: string,
  input: ReportRunInput,
): Promise<ReportResult> {
  if (!input.reportId) {
    return runBuilder(db, tenantId, input);
  }

  const def = getReportDefinition(input.reportId);
  if (!def) throw new Error(`Άγνωστη αναφορά: ${input.reportId}`);
  const period = input.period ?? def.defaultPeriod ?? "ytd";
  const limit = input.limit ?? 12;

  switch (def.id) {
    case "sales-trend":
      return runSalesTrend(db, tenantId, period);
    case "sales-by-customer":
      return runSalesByCustomer(db, tenantId, period, limit);
    case "sales-by-product":
      return runSalesByProduct(db, tenantId, period, limit);
    case "sales-by-site":
      return runSalesBySite(db, tenantId, period);
    case "sales-by-kind":
      return runSalesByKind(db, tenantId, period);
    case "sales-yoy":
      return runSalesYoY(db, tenantId);
    case "sales-period-compare":
      return runSalesPeriodCompare(db, tenantId, period);
    case "sales-ttm":
      return runSalesTtm(db, tenantId);
    case "sales-quarterly":
      return runSalesQuarterly(db, tenantId);
    case "sales-pareto":
      return runSalesPareto(db, tenantId, period);
    case "sales-aov":
      return runSalesAov(db, tenantId, period);
    case "sales-new-vs-returning":
      return runSalesNewVsReturning(db, tenantId, period);
    case "sales-customer-growth":
      return runSalesCustomerGrowth(db, tenantId, period);
    case "sales-credit-ratio":
      return runSalesCreditRatio(db, tenantId, period);
    case "sales-weekday":
      return runSalesWeekday(db, tenantId, period);
    case "sales-collection-efficiency":
      return runSalesCollectionEfficiency(db, tenantId, period);
    case "sales-quote-conversion":
      return runSalesQuoteConversion(db, tenantId, period);
    case "sales-product-velocity":
      return runSalesProductVelocity(db, tenantId, period, limit);
    case "sales-repeat-rate":
      return runSalesRepeatRate(db, tenantId, period);
    case "ar-aging":
      return runArAging(db, tenantId);
    case "vat-breakdown":
      return runVatBreakdown(db, tenantId, period);
    case "cash-collections":
      return runCashCollections(db, tenantId, period);
    case "stock-by-site":
      return runStockBySite(db, tenantId);
    case "low-stock":
      return runLowStock(db, tenantId);
    case "orders-pipeline":
      return runOrdersPipeline(db, tenantId);
    case "delivery-volume":
      return runDeliveryVolume(db, tenantId, period);
    case "hr-headcount":
      return runHrHeadcount(db, tenantId);
    case "grid-invoice-register":
      return runGridInvoiceRegister(db, tenantId, period);
    case "grid-sales-lines":
      return runGridSalesLines(db, tenantId, period);
    case "grid-customer-analysis":
      return runGridCustomerAnalysis(db, tenantId, period);
    case "grid-ar-open":
      return runGridArOpen(db, tenantId);
    case "grid-ap-open":
      return runGridApOpen(db, tenantId);
    case "grid-vat-register":
      return runGridVatRegister(db, tenantId, period);
    case "grid-collections":
      return runGridCollections(db, tenantId, period);
    case "grid-stock-balances":
      return runGridStockBalances(db, tenantId);
    default:
      throw new Error(`Μη υλοποιημένη αναφορά: ${def.id}`);
  }
}

export async function loadDashboardBundle(
  db: PrismaClient,
  tenantId: string,
): Promise<{
  kpis: ReportKpi[];
  reports: ReportResult[];
  catalog: ReportDefinition[];
}> {
  const { start: monthStart } = resolvePeriod("mtd");
  const now = new Date();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  const [
    salesTrend,
    salesYoY,
    periodCompare,
    arAging,
    topCustomers,
    pareto,
    arRows,
    apRows,
    vat,
    issuedMonth,
  ] = await Promise.all([
    runSalesTrend(db, tenantId, "12m"),
    runSalesYoY(db, tenantId),
    runSalesPeriodCompare(db, tenantId, "ytd"),
    runArAging(db, tenantId),
    runSalesByCustomer(db, tenantId, "mtd", 8),
    runSalesPareto(db, tenantId, "ytd"),
    loadArRows(db, tenantId),
    loadApRows(db, tenantId),
    loadVatSummary(db, tenantId, yearStart, now),
    db.invoice.findMany({
      where: {
        tenantId,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        issuedAt: { gte: monthStart },
      },
      select: { total: true, kind: true },
    }),
  ]);

  let monthSales = 0;
  for (const inv of issuedMonth) {
    monthSales += invoiceSign(inv.kind) * toNumber(inv.total);
  }

  return {
    kpis: [
      { label: "Πωλήσεις μήνα", value: money(monthSales) },
      {
        label: "Open AR",
        value: money(arRows.reduce((s, r) => s + r.balance, 0)),
      },
      {
        label: "Open AP",
        value: money(apRows.reduce((s, r) => s + r.balance, 0)),
      },
      { label: "ΦΠΑ χρήσης", value: money(vat.netVatPayable) },
    ],
    reports: [
      salesTrend,
      salesYoY,
      periodCompare,
      pareto,
      arAging,
      topCustomers,
    ],
    catalog: (await import("./catalog")).REPORT_CATALOG,
  };
}
