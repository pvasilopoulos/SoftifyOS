import type { PrismaClient } from "@/generated/prisma/client";
import { toNumber } from "@/modules/sales/invoice-utils";
import { loadApRows, loadArRows } from "@/modules/finance/analytics";
import { resolvePeriod } from "./period";
import type { ReportResult, ReportTableColumn } from "./engine";

function money(n: number) {
  return n.toLocaleString("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  });
}

function dateLabel(d: Date | string | null | undefined) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("el-GR", { timeZone: "UTC" });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function invoiceSign(kind: string) {
  return kind === "SALES_CREDIT" ? -1 : 1;
}

function kindLabel(kind: string) {
  switch (kind) {
    case "SALES_CREDIT":
      return "Πιστωτικό";
    case "RETAIL_RECEIPT":
      return "ΑΠΥ";
    default:
      return "Τιμολόγιο";
  }
}

function sumCol(
  rows: Array<Record<string, string | number | null>>,
  key: string,
) {
  return round2(
    rows.reduce((a, r) => a + (typeof r[key] === "number" ? (r[key] as number) : 0), 0),
  );
}

function gridResult(opts: {
  id: string;
  title: string;
  description: string;
  periodLabel: string;
  columns: ReportTableColumn[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, string | number | null>;
  kpis?: ReportResult["kpis"];
  pageSize?: number;
}): ReportResult {
  return {
    id: opts.id,
    title: opts.title,
    description: opts.description,
    periodLabel: opts.periodLabel,
    presentation: "table",
    chart: null,
    kpis: opts.kpis,
    table: {
      columns: opts.columns,
      rows: opts.rows,
      totals: opts.totals,
      pageSize: opts.pageSize ?? 25,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function runGridInvoiceRegister(
  db: PrismaClient,
  tenantId: string,
  period: "mtd" | "qtd" | "ytd" | "12m",
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period);
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issuedAt: { gte: start, lte: end },
    },
    orderBy: [{ issuedAt: "desc" }, { number: "desc" }],
    take: 500,
    select: {
      number: true,
      kind: true,
      status: true,
      issuedAt: true,
      dueAt: true,
      subtotal: true,
      vatAmount: true,
      total: true,
      paidAmount: true,
      customer: { select: { code: true, name: true } },
    },
  });

  const rows = invoices.map((inv) => {
    const sign = invoiceSign(inv.kind);
    const total = round2(sign * toNumber(inv.total));
    const paid = round2(toNumber(inv.paidAmount));
    const balance = round2(Math.max(0, Math.abs(total) - paid) * (total < 0 ? -1 : 1));
    return {
      number: inv.number,
      kind: kindLabel(inv.kind),
      customerCode: inv.customer.code,
      customer: inv.customer.name,
      issuedAt: dateLabel(inv.issuedAt),
      dueAt: dateLabel(inv.dueAt),
      status: inv.status,
      net: round2(sign * toNumber(inv.subtotal)),
      vat: round2(sign * toNumber(inv.vatAmount)),
      total,
      paid,
      balance,
    };
  });

  return gridResult({
    id: "grid-invoice-register",
    title: "Μητρώο τιμολογίων",
    description: "Αναλυτικός πίνακας παραστατικών πώλησης",
    periodLabel: label,
    pageSize: 50,
    kpis: [
      { label: "Παραστατικά", value: rows.length },
      { label: "Καθαρά", value: money(sumCol(rows, "net")) },
      { label: "ΦΠΑ", value: money(sumCol(rows, "vat")) },
      { label: "Σύνολο", value: money(sumCol(rows, "total")) },
    ],
    columns: [
      { key: "number", label: "Αριθμός", type: "string", sortable: true },
      { key: "kind", label: "Είδος", type: "string", sortable: true },
      { key: "customerCode", label: "Κωδ. πελάτη", type: "string", sortable: true },
      { key: "customer", label: "Πελάτης", type: "string", sortable: true },
      { key: "issuedAt", label: "Έκδοση", type: "date", sortable: true },
      { key: "dueAt", label: "Λήξη", type: "date", sortable: true },
      { key: "status", label: "Κατάσταση", type: "string", sortable: true },
      { key: "net", label: "Καθαρά", type: "currency", align: "end", sortable: true },
      { key: "vat", label: "ΦΠΑ", type: "currency", align: "end", sortable: true },
      { key: "total", label: "Σύνολο", type: "currency", align: "end", sortable: true },
      { key: "paid", label: "Εισπραχθέντα", type: "currency", align: "end", sortable: true },
      { key: "balance", label: "Υπόλοιπο", type: "currency", align: "end", sortable: true },
    ],
    rows,
    totals: {
      number: `${rows.length} εγγραφές`,
      net: sumCol(rows, "net"),
      vat: sumCol(rows, "vat"),
      total: sumCol(rows, "total"),
      paid: sumCol(rows, "paid"),
      balance: sumCol(rows, "balance"),
    },
  });
}

export async function runGridSalesLines(
  db: PrismaClient,
  tenantId: string,
  period: "mtd" | "qtd" | "ytd" | "12m",
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period);
  const lines = await db.invoiceLine.findMany({
    where: {
      tenantId,
      invoice: {
        tenantId,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        issuedAt: { gte: start, lte: end },
      },
    },
    orderBy: [{ invoice: { issuedAt: "desc" } }, { position: "asc" }],
    take: 800,
    select: {
      description: true,
      quantity: true,
      unitPrice: true,
      vatRate: true,
      lineTotal: true,
      product: { select: { sku: true, name: true } },
      invoice: {
        select: {
          number: true,
          kind: true,
          issuedAt: true,
          customer: { select: { name: true } },
        },
      },
    },
  });

  const rows = lines.map((ln) => {
    const sign = invoiceSign(ln.invoice.kind);
    const lineTotal = round2(sign * toNumber(ln.lineTotal));
    const qty = round2(sign * toNumber(ln.quantity));
    const vatRate = toNumber(ln.vatRate);
    const net = round2(lineTotal / (1 + vatRate / 100));
    const vat = round2(lineTotal - net);
    return {
      invoice: ln.invoice.number,
      issuedAt: dateLabel(ln.invoice.issuedAt),
      customer: ln.invoice.customer.name,
      productCode: ln.product?.sku ?? "—",
      product: ln.product?.name ?? ln.description,
      qty,
      unitPrice: round2(toNumber(ln.unitPrice)),
      vatRate,
      net,
      vat,
      total: lineTotal,
    };
  });

  return gridResult({
    id: "grid-sales-lines",
    title: "Γραμμές πωλήσεων",
    description: "Ανάλυση ανά γραμμή τιμολογίου",
    periodLabel: label,
    pageSize: 50,
    kpis: [
      { label: "Γραμμές", value: rows.length },
      { label: "Ποσότητα", value: sumCol(rows, "qty") },
      { label: "Καθαρά", value: money(sumCol(rows, "net")) },
      { label: "Σύνολο", value: money(sumCol(rows, "total")) },
    ],
    columns: [
      { key: "invoice", label: "Παραστατικό", type: "string", sortable: true },
      { key: "issuedAt", label: "Ημ/νία", type: "date", sortable: true },
      { key: "customer", label: "Πελάτης", type: "string", sortable: true },
      { key: "productCode", label: "Κωδικός", type: "string", sortable: true },
      { key: "product", label: "Είδος", type: "string", sortable: true },
      { key: "qty", label: "Ποσότητα", type: "number", align: "end", sortable: true },
      { key: "unitPrice", label: "Τιμή", type: "currency", align: "end", sortable: true },
      { key: "vatRate", label: "ΦΠΑ %", type: "percent", align: "end", sortable: true },
      { key: "net", label: "Καθαρά", type: "currency", align: "end", sortable: true },
      { key: "vat", label: "ΦΠΑ", type: "currency", align: "end", sortable: true },
      { key: "total", label: "Σύνολο", type: "currency", align: "end", sortable: true },
    ],
    rows,
    totals: {
      invoice: `${rows.length} γραμμές`,
      qty: sumCol(rows, "qty"),
      net: sumCol(rows, "net"),
      vat: sumCol(rows, "vat"),
      total: sumCol(rows, "total"),
    },
  });
}

export async function runGridCustomerAnalysis(
  db: PrismaClient,
  tenantId: string,
  period: "mtd" | "qtd" | "ytd" | "12m",
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period);
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issuedAt: { gte: start, lte: end },
    },
    select: {
      customerId: true,
      kind: true,
      issuedAt: true,
      subtotal: true,
      vatAmount: true,
      total: true,
      customer: { select: { code: true, name: true } },
    },
  });

  type Agg = {
    code: string;
    name: string;
    count: number;
    net: number;
    vat: number;
    total: number;
    lastBuy: Date | null;
  };
  const map = new Map<string, Agg>();
  for (const inv of invoices) {
    const sign = invoiceSign(inv.kind);
    const cur = map.get(inv.customerId) ?? {
      code: inv.customer.code,
      name: inv.customer.name,
      count: 0,
      net: 0,
      vat: 0,
      total: 0,
      lastBuy: null,
    };
    cur.count += 1;
    cur.net += sign * toNumber(inv.subtotal);
    cur.vat += sign * toNumber(inv.vatAmount);
    cur.total += sign * toNumber(inv.total);
    if (inv.issuedAt && (!cur.lastBuy || inv.issuedAt > cur.lastBuy)) {
      cur.lastBuy = inv.issuedAt;
    }
    map.set(inv.customerId, cur);
  }

  const rows = [...map.values()]
    .map((a) => ({
      code: a.code,
      customer: a.name,
      invoices: a.count,
      net: round2(a.net),
      vat: round2(a.vat),
      total: round2(a.total),
      aov: a.count ? round2(a.total / a.count) : 0,
      lastBuy: dateLabel(a.lastBuy),
    }))
    .sort((a, b) => b.total - a.total);

  return gridResult({
    id: "grid-customer-analysis",
    title: "Ανάλυση πελατών (grid)",
    description: "Συγκεντρωτικά ανά πελάτη",
    periodLabel: label,
    pageSize: 50,
    kpis: [
      { label: "Πελάτες", value: rows.length },
      { label: "Παραστατικά", value: sumCol(rows, "invoices") },
      { label: "Κύκλος", value: money(sumCol(rows, "total")) },
    ],
    columns: [
      { key: "code", label: "Κωδικός", type: "string", sortable: true },
      { key: "customer", label: "Πελάτης", type: "string", sortable: true },
      { key: "invoices", label: "Παραστατικά", type: "int", align: "end", sortable: true },
      { key: "net", label: "Καθαρά", type: "currency", align: "end", sortable: true },
      { key: "vat", label: "ΦΠΑ", type: "currency", align: "end", sortable: true },
      { key: "total", label: "Σύνολο", type: "currency", align: "end", sortable: true },
      { key: "aov", label: "Μέσο παραστ.", type: "currency", align: "end", sortable: true },
      { key: "lastBuy", label: "Τελευταία αγορά", type: "date", sortable: true },
    ],
    rows,
    totals: {
      customer: `${rows.length} πελάτες`,
      invoices: sumCol(rows, "invoices"),
      net: sumCol(rows, "net"),
      vat: sumCol(rows, "vat"),
      total: sumCol(rows, "total"),
    },
  });
}

export async function runGridArOpen(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const ar = await loadArRows(db, tenantId);
  const rows = ar.map((r) => ({
    number: r.number,
    customerCode: r.customer.code,
    customer: r.customer.name,
    issuedAt: dateLabel(r.issuedAt),
    dueAt: dateLabel(r.dueAt),
    status: r.status,
    bucket: r.bucket,
    daysPastDue: r.daysPastDue,
    total: r.total,
    paid: r.paid,
    balance: r.balance,
  }));

  return gridResult({
    id: "grid-ar-open",
    title: "Ανοιχτές απαιτήσεις (AR grid)",
    description: "Υπόλοιπα πελατών με aging",
    periodLabel: "Τρέχοντα υπόλοιπα",
    pageSize: 50,
    kpis: [
      { label: "Ανοιχτά", value: rows.length },
      { label: "Υπόλοιπο", value: money(sumCol(rows, "balance")) },
      {
        label: "Ληξιπρόθεσμα",
        value: money(
          sumCol(
            rows.filter((r) => Number(r.daysPastDue) > 0),
            "balance",
          ),
        ),
      },
    ],
    columns: [
      { key: "number", label: "Παραστατικό", type: "string", sortable: true },
      { key: "customerCode", label: "Κωδικός", type: "string", sortable: true },
      { key: "customer", label: "Πελάτης", type: "string", sortable: true },
      { key: "issuedAt", label: "Έκδοση", type: "date", sortable: true },
      { key: "dueAt", label: "Λήξη", type: "date", sortable: true },
      { key: "status", label: "Κατάσταση", type: "string", sortable: true },
      { key: "bucket", label: "Aging", type: "string", sortable: true },
      { key: "daysPastDue", label: "Ημέρες", type: "int", align: "end", sortable: true },
      { key: "total", label: "Αξία", type: "currency", align: "end", sortable: true },
      { key: "paid", label: "Εισπραχθέντα", type: "currency", align: "end", sortable: true },
      { key: "balance", label: "Υπόλοιπο", type: "currency", align: "end", sortable: true },
    ],
    rows,
    totals: {
      number: `${rows.length} εγγραφές`,
      total: sumCol(rows, "total"),
      paid: sumCol(rows, "paid"),
      balance: sumCol(rows, "balance"),
    },
  });
}

export async function runGridApOpen(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const ap = await loadApRows(db, tenantId);
  const rows = ap.map((r) => ({
    number: r.number,
    supplierCode: r.supplier.code,
    supplier: r.supplier.name,
    issueDate: dateLabel(r.issueDate ?? r.orderedAt),
    dueAt: r.dueAt ? dateLabel(r.dueAt) : "—",
    bucket: r.bucket,
    status: r.status,
    total: r.total,
    paid: r.paid,
    balance: r.balance,
  }));

  return gridResult({
    id: "grid-ap-open",
    title: "Ανοιχτές υποχρεώσεις (AP grid)",
    description: "Ανοιχτά τιμολόγια αγοράς με aging",
    periodLabel: "Τρέχοντα PI",
    pageSize: 50,
    kpis: [
      { label: "Τιμολόγια", value: rows.length },
      { label: "Υπόλοιπο", value: money(sumCol(rows, "balance")) },
    ],
    columns: [
      { key: "number", label: "Αρ.", type: "string", sortable: true },
      { key: "supplierCode", label: "Κωδ. προμηθ.", type: "string", sortable: true },
      { key: "supplier", label: "Προμηθευτής", type: "string", sortable: true },
      { key: "issueDate", label: "Έκδοση", type: "date", sortable: true },
      { key: "dueAt", label: "Λήξη", type: "date", sortable: true },
      { key: "bucket", label: "Aging", type: "string", sortable: true },
      { key: "status", label: "Κατάσταση", type: "string", sortable: true },
      { key: "balance", label: "Υπόλοιπο", type: "currency", align: "end", sortable: true },
    ],
    rows,
    totals: {
      number: `${rows.length} τιμ.`,
      balance: sumCol(rows, "balance"),
      total: sumCol(rows, "total"),
      paid: sumCol(rows, "paid"),
    },
  });
}

export async function runGridVatRegister(
  db: PrismaClient,
  tenantId: string,
  period: "mtd" | "qtd" | "ytd" | "12m",
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period);
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issuedAt: { gte: start, lte: end },
    },
    orderBy: [{ issuedAt: "asc" }],
    take: 500,
    select: {
      number: true,
      kind: true,
      issuedAt: true,
      subtotal: true,
      vatAmount: true,
      total: true,
      customer: { select: { name: true, vatNumber: true } },
      lines: { select: { vatRate: true, lineTotal: true } },
    },
  });

  const rows: Array<Record<string, string | number | null>> = [];
  for (const inv of invoices) {
    const sign = invoiceSign(inv.kind);
    const byRate = new Map<number, number>();
    for (const ln of inv.lines) {
      const rate = toNumber(ln.vatRate);
      byRate.set(rate, (byRate.get(rate) ?? 0) + sign * toNumber(ln.lineTotal));
    }
    if (byRate.size === 0) {
      rows.push({
        number: inv.number,
        kind: kindLabel(inv.kind),
        issuedAt: dateLabel(inv.issuedAt),
        customer: inv.customer.name,
        vatNumber: inv.customer.vatNumber ?? "—",
        vatRate: null,
        taxable: round2(sign * toNumber(inv.subtotal)),
        vat: round2(sign * toNumber(inv.vatAmount)),
        total: round2(sign * toNumber(inv.total)),
      });
      continue;
    }
    for (const [rate, gross] of byRate) {
      const taxable = round2(gross / (1 + rate / 100));
      const vat = round2(gross - taxable);
      rows.push({
        number: inv.number,
        kind: kindLabel(inv.kind),
        issuedAt: dateLabel(inv.issuedAt),
        customer: inv.customer.name,
        vatNumber: inv.customer.vatNumber ?? "—",
        vatRate: rate,
        taxable,
        vat,
        total: round2(gross),
      });
    }
  }

  return gridResult({
    id: "grid-vat-register",
    title: "Μητρώο ΦΠΑ",
    description: "ΦΠΑ ανά παραστατικό / συντελεστή",
    periodLabel: label,
    pageSize: 50,
    kpis: [
      { label: "Γραμμές", value: rows.length },
      { label: "Φορολογητέα", value: money(sumCol(rows, "taxable")) },
      { label: "ΦΠΑ", value: money(sumCol(rows, "vat")) },
    ],
    columns: [
      { key: "number", label: "Παραστατικό", type: "string", sortable: true },
      { key: "kind", label: "Είδος", type: "string", sortable: true },
      { key: "issuedAt", label: "Ημ/νία", type: "date", sortable: true },
      { key: "customer", label: "Πελάτης", type: "string", sortable: true },
      { key: "vatNumber", label: "ΑΦΜ", type: "string", sortable: true },
      { key: "vatRate", label: "Συντ. %", type: "percent", align: "end", sortable: true },
      { key: "taxable", label: "Φορολογητέα", type: "currency", align: "end", sortable: true },
      { key: "vat", label: "ΦΠΑ", type: "currency", align: "end", sortable: true },
      { key: "total", label: "Σύνολο", type: "currency", align: "end", sortable: true },
    ],
    rows,
    totals: {
      number: `${rows.length} γραμμές`,
      taxable: sumCol(rows, "taxable"),
      vat: sumCol(rows, "vat"),
      total: sumCol(rows, "total"),
    },
  });
}

export async function runGridCollections(
  db: PrismaClient,
  tenantId: string,
  period: "mtd" | "qtd" | "ytd" | "12m",
): Promise<ReportResult> {
  const { start, end, label } = resolvePeriod(period);
  const payments = await db.invoicePayment.findMany({
    where: {
      tenantId,
      paidAt: { gte: start, lte: end },
    },
    orderBy: [{ paidAt: "desc" }],
    take: 500,
    select: {
      amount: true,
      method: true,
      paidAt: true,
      note: true,
      paymentMethod: { select: { name: true } },
      invoice: {
        select: {
          number: true,
          customer: { select: { code: true, name: true } },
        },
      },
    },
  });

  const rows = payments.map((p) => ({
    paidAt: dateLabel(p.paidAt),
    invoice: p.invoice.number,
    customerCode: p.invoice.customer.code,
    customer: p.invoice.customer.name,
    method: p.paymentMethod?.name ?? p.method,
    amount: round2(toNumber(p.amount)),
    note: p.note ?? "—",
  }));

  return gridResult({
    id: "grid-collections",
    title: "Εισπράξεις αναλυτικά",
    description: "Κάθε είσπραξη τιμολογίου",
    periodLabel: label,
    pageSize: 50,
    kpis: [
      { label: "Κινήσεις", value: rows.length },
      { label: "Σύνολο", value: money(sumCol(rows, "amount")) },
    ],
    columns: [
      { key: "paidAt", label: "Ημ/νία", type: "date", sortable: true },
      { key: "invoice", label: "Παραστατικό", type: "string", sortable: true },
      { key: "customerCode", label: "Κωδικός", type: "string", sortable: true },
      { key: "customer", label: "Πελάτης", type: "string", sortable: true },
      { key: "method", label: "Μέθοδος", type: "string", sortable: true },
      { key: "amount", label: "Ποσό", type: "currency", align: "end", sortable: true },
      { key: "note", label: "Σημείωση", type: "string" },
    ],
    rows,
    totals: {
      invoice: `${rows.length} κινήσεις`,
      amount: sumCol(rows, "amount"),
    },
  });
}

export async function runGridStockBalances(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportResult> {
  const balances = await db.stockBalance.findMany({
    where: { tenantId },
    orderBy: [{ product: { sku: "asc" } }],
    take: 800,
    select: {
      qtyOnHand: true,
      site: { select: { code: true, name: true } },
      product: {
        select: { sku: true, name: true, price: true, unit: true },
      },
    },
  });

  const rows = balances
    .map((b) => {
      const qty = round2(toNumber(b.qtyOnHand));
      const price = round2(toNumber(b.product.price ?? 0));
      return {
        productCode: b.product.sku,
        product: b.product.name,
        siteCode: b.site.code,
        site: b.site.name,
        unit: b.product.unit ?? "—",
        qty,
        unitPrice: price,
        value: round2(qty * price),
      };
    })
    .filter((r) => Math.abs(Number(r.qty)) > 0.0005)
    .sort((a, b) => b.value - a.value);

  return gridResult({
    id: "grid-stock-balances",
    title: "Υπόλοιπα αποθήκης (grid)",
    description: "On-hand ανά είδος × εγκατάσταση (αξία σε τιμή πώλησης)",
    periodLabel: "Τρέχοντα υπόλοιπα",
    pageSize: 50,
    kpis: [
      { label: "Γραμμές", value: rows.length },
      { label: "Ποσότητα", value: sumCol(rows, "qty") },
      { label: "Αξία (τιμή)", value: money(sumCol(rows, "value")) },
    ],
    columns: [
      { key: "productCode", label: "Κωδικός", type: "string", sortable: true },
      { key: "product", label: "Είδος", type: "string", sortable: true },
      { key: "siteCode", label: "Site", type: "string", sortable: true },
      { key: "site", label: "Εγκατάσταση", type: "string", sortable: true },
      { key: "unit", label: "ΜΜ", type: "string" },
      { key: "qty", label: "Υπόλοιπο", type: "number", align: "end", sortable: true },
      { key: "unitPrice", label: "Τιμή", type: "currency", align: "end", sortable: true },
      { key: "value", label: "Αξία", type: "currency", align: "end", sortable: true },
    ],
    rows,
    totals: {
      product: `${rows.length} γραμμές`,
      qty: sumCol(rows, "qty"),
      value: sumCol(rows, "value"),
    },
  });
}
