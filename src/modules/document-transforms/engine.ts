import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  allocateFromSeries,
  resolveDefaultSeries,
} from "@/modules/documents/series";
import { calcInvoiceTotals, toNumber } from "@/modules/sales/invoice-utils";

function roundQty(n: number) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
import {
  InvoiceStatusOptionError,
  resolveInvoiceStatusOption,
} from "@/modules/sales/invoice-status-options";
import { issueDeliveryNote } from "@/modules/delivery-notes/service";
import { getHandlerMeta } from "./handlers";
import { getTransformRule, listTransformRules } from "./rules";
import type { HandlerKey } from "./schemas";

type Db = PrismaClient;

export class TransformError extends Error {
  constructor(
    message: string,
    public status = 400,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type CoverageLine = {
  sourceLineId: string;
  description: string;
  productId: string | null;
  quantity: number;
  covered: number;
  remaining: number;
  unitPrice: number;
  vatRate: number;
  selected: number;
};

export type TransformPreview = {
  rule: {
    id: string;
    code: string;
    name: string;
    handlerKey: string;
    sourceKind: string;
    targetKind: string;
    allowPartial: boolean;
    coverageMode: string;
    issueMode: string;
    copyNotes: boolean;
    defaultSeriesId: string | null;
  };
  source: {
    id: string;
    number: string;
    kind: string;
    status: string;
  };
  lines: CoverageLine[];
  canExecute: boolean;
  blockingReason?: string;
};

type LineSel = { sourceLineId: string; quantity: number };

function eps(a: number, b: number) {
  return Math.abs(a - b) < 0.0001;
}

function resolveSelections(
  lines: CoverageLine[],
  input?: LineSel[],
  allowPartial = true,
): CoverageLine[] {
  if (!input || input.length === 0) {
    return lines
      .filter((l) => l.remaining > 0.0001)
      .map((l) => ({ ...l, selected: l.remaining }));
  }
  const out: CoverageLine[] = [];
  for (const sel of input) {
    const line = lines.find((l) => l.sourceLineId === sel.sourceLineId);
    if (!line) throw new TransformError("Μη έγκυρη γραμμή πηγής");
    if (sel.quantity > line.remaining + 0.0001) {
      throw new TransformError(
        `Υπερβαίνει το υπόλοιπο (${line.remaining}) · ${line.description}`,
      );
    }
    if (sel.quantity <= 0) continue;
    out.push({ ...line, selected: sel.quantity });
  }
  if (!allowPartial) {
    const full = lines.every((l) => {
      const sel = out.find((s) => s.sourceLineId === l.sourceLineId);
      return sel && eps(sel.selected, l.remaining);
    });
    if (!full) {
      throw new TransformError("Ο κανόνας δεν επιτρέπει μερικό μετασχηματισμό");
    }
  }
  return out;
}

async function loadQuoteCoverage(db: Db, tenantId: string, sourceId: string) {
  const quote = await db.order.findFirst({
    where: { id: sourceId, tenantId, kind: "SALES_QUOTE" },
    include: {
      lines: { orderBy: { position: "asc" } },
      convertedOrders: {
        where: { kind: "SALES_ORDER" },
        select: { id: true, number: true },
        take: 1,
      },
    },
  });
  if (!quote) throw new TransformError("Δεν βρέθηκε προσφορά", 404);
  if (quote.status === "CANCELLED") {
    throw new TransformError("Η προσφορά είναι ακυρωμένη");
  }
  const converted = Boolean(quote.convertedOrders[0]);
  const lines: CoverageLine[] = quote.lines.map((l) => {
    const qty = toNumber(l.quantity);
    return {
      sourceLineId: l.id,
      description: l.description,
      productId: l.productId,
      quantity: qty,
      covered: converted ? qty : 0,
      remaining: converted ? 0 : qty,
      unitPrice: toNumber(l.unitPrice),
      vatRate: toNumber(l.vatRate),
      selected: 0,
    };
  });
  return {
    source: {
      id: quote.id,
      number: quote.number,
      kind: "SALES_QUOTE",
      status: quote.status,
    },
    lines,
    blockingReason: converted
      ? `Ήδη μετατράπηκε σε ${quote.convertedOrders[0]!.number}`
      : undefined,
    raw: quote,
  };
}

async function loadOrderCoverage(
  db: Db,
  tenantId: string,
  sourceId: string,
  mode: "invoice" | "delivery",
) {
  const order = await db.order.findFirst({
    where: { id: sourceId, tenantId, kind: "SALES_ORDER" },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!order) throw new TransformError("Δεν βρέθηκε παραγγελία", 404);
  if (order.status === "CANCELLED") {
    throw new TransformError("Η παραγγελία είναι ακυρωμένη");
  }
  const lines: CoverageLine[] = order.lines.map((l) => {
    const qty = toNumber(l.quantity);
    const covered =
      mode === "invoice"
        ? toNumber(l.quantityInvoiced)
        : toNumber(l.quantityDelivered);
    return {
      sourceLineId: l.id,
      description: l.description,
      productId: l.productId,
      quantity: qty,
      covered,
      remaining: Math.max(0, roundQty(qty - covered)),
      unitPrice: toNumber(l.unitPrice),
      vatRate: toNumber(l.vatRate),
      selected: 0,
    };
  });
  const remainingTotal = lines.reduce((s, l) => s + l.remaining, 0);
  return {
    source: {
      id: order.id,
      number: order.number,
      kind: "SALES_ORDER",
      status: order.status,
    },
    lines,
    blockingReason:
      remainingTotal <= 0.0001
        ? mode === "invoice"
          ? "Δεν απομένουν ποσότητες προς τιμολόγηση"
          : "Δεν απομένουν ποσότητες προς αποστολή"
        : undefined,
    raw: order,
  };
}

async function loadInvoiceCoverage(
  db: Db,
  tenantId: string,
  sourceId: string,
  mode: "credit" | "delivery",
) {
  const invoice = await db.invoice.findFirst({
    where: {
      id: sourceId,
      tenantId,
      kind: { in: ["SALES_INVOICE", "RETAIL_RECEIPT"] },
    },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!invoice) throw new TransformError("Δεν βρέθηκε τιμολόγιο", 404);
  if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
    throw new TransformError("Το τιμολόγιο πρέπει να είναι εκδομένο");
  }

  let deliveredByLine = new Map<string, number>();
  if (mode === "delivery") {
    const dnLines = await db.deliveryNoteLine.findMany({
      where: {
        tenantId,
        invoiceLineId: { in: invoice.lines.map((l) => l.id) },
        deliveryNote: { status: { not: "CANCELLED" } },
      },
      select: { invoiceLineId: true, quantity: true },
    });
    deliveredByLine = new Map();
    for (const l of dnLines) {
      if (!l.invoiceLineId) continue;
      deliveredByLine.set(
        l.invoiceLineId,
        (deliveredByLine.get(l.invoiceLineId) ?? 0) + toNumber(l.quantity),
      );
    }
  }

  const lines: CoverageLine[] = invoice.lines.map((l) => {
    const qty = toNumber(l.quantity);
    const covered =
      mode === "credit"
        ? toNumber(l.quantityCredited)
        : (deliveredByLine.get(l.id) ?? 0);
    return {
      sourceLineId: l.id,
      description: l.description,
      productId: l.productId,
      quantity: qty,
      covered,
      remaining: Math.max(0, roundQty(qty - covered)),
      unitPrice: toNumber(l.unitPrice),
      vatRate: toNumber(l.vatRate),
      selected: 0,
    };
  });
  const remainingTotal = lines.reduce((s, l) => s + l.remaining, 0);
  return {
    source: {
      id: invoice.id,
      number: invoice.number,
      kind: invoice.kind,
      status: invoice.status,
    },
    lines,
    blockingReason:
      remainingTotal <= 0.0001
        ? mode === "credit"
          ? "Δεν απομένουν ποσότητες προς πίστωση"
          : "Δεν απομένουν ποσότητες προς αποστολή"
        : undefined,
    raw: invoice,
  };
}

async function loadDeliveryCoverage(db: Db, tenantId: string, sourceId: string) {
  const note = await db.deliveryNote.findFirst({
    where: { id: sourceId, tenantId },
    include: {
      lines: { orderBy: { position: "asc" } },
      order: {
        include: { lines: true },
      },
    },
  });
  if (!note) throw new TransformError("Δεν βρέθηκε δελτίο", 404);
  if (note.status === "CANCELLED") {
    throw new TransformError("Το δελτίο είναι ακυρωμένο");
  }
  const lines: CoverageLine[] = note.lines.map((l) => {
    const qty = toNumber(l.quantity);
    const covered = toNumber(l.quantityInvoiced);
    const orderLine = l.orderLineId
      ? note.order?.lines.find((ol) => ol.id === l.orderLineId)
      : null;
    return {
      sourceLineId: l.id,
      description: l.description,
      productId: l.productId,
      quantity: qty,
      covered,
      remaining: Math.max(0, roundQty(qty - covered)),
      unitPrice: orderLine ? toNumber(orderLine.unitPrice) : 0,
      vatRate: orderLine ? toNumber(orderLine.vatRate) : 24,
      selected: 0,
    };
  });
  const remainingTotal = lines.reduce((s, l) => s + l.remaining, 0);
  return {
    source: {
      id: note.id,
      number: note.number,
      kind: "DELIVERY_NOTE",
      status: note.status,
    },
    lines,
    blockingReason:
      remainingTotal <= 0.0001
        ? "Δεν απομένουν ποσότητες προς τιμολόγηση"
        : undefined,
    raw: note,
  };
}

async function buildCoverage(
  db: Db,
  tenantId: string,
  handlerKey: HandlerKey,
  sourceId: string,
) {
  switch (handlerKey) {
    case "quote_to_order":
      return loadQuoteCoverage(db, tenantId, sourceId);
    case "order_to_invoice":
      return loadOrderCoverage(db, tenantId, sourceId, "invoice");
    case "order_to_delivery":
      return loadOrderCoverage(db, tenantId, sourceId, "delivery");
    case "invoice_to_credit":
      return loadInvoiceCoverage(db, tenantId, sourceId, "credit");
    case "invoice_to_delivery":
      return loadInvoiceCoverage(db, tenantId, sourceId, "delivery");
    case "delivery_to_invoice":
      return loadDeliveryCoverage(db, tenantId, sourceId);
    default:
      throw new TransformError("Άγνωστος handler");
  }
}

export async function listAvailableTransforms(
  db: Db,
  tenantId: string,
  sourceKind: string,
  sourceId: string,
) {
  const rules = await listTransformRules(db, tenantId, {
    sourceKind,
    activeOnly: true,
  });
  const available = [];
  for (const rule of rules) {
    const meta = getHandlerMeta(rule.handlerKey);
    if (!meta) continue;
    try {
      const cov = await buildCoverage(
        db,
        tenantId,
        rule.handlerKey as HandlerKey,
        sourceId,
      );
      const remaining = cov.lines.reduce((s, l) => s + l.remaining, 0);
      available.push({
        id: rule.id,
        code: rule.code,
        name: rule.name,
        description: rule.description,
        handlerKey: rule.handlerKey,
        sourceKind: rule.sourceKind,
        targetKind: rule.targetKind,
        allowPartial: rule.allowPartial,
        coverageMode: rule.coverageMode,
        issueMode: rule.issueMode,
        remainingQty: remaining,
        canExecute: !cov.blockingReason && remaining > 0.0001,
        blockingReason: cov.blockingReason,
      });
    } catch (e) {
      available.push({
        id: rule.id,
        code: rule.code,
        name: rule.name,
        description: rule.description,
        handlerKey: rule.handlerKey,
        sourceKind: rule.sourceKind,
        targetKind: rule.targetKind,
        allowPartial: rule.allowPartial,
        coverageMode: rule.coverageMode,
        issueMode: rule.issueMode,
        remainingQty: 0,
        canExecute: false,
        blockingReason:
          e instanceof TransformError ? e.message : "Μη διαθέσιμο",
      });
    }
  }
  return available;
}

export async function previewTransform(
  db: Db,
  tenantId: string,
  input: { ruleId: string; sourceId: string; lines?: LineSel[] },
): Promise<TransformPreview> {
  const rule = await getTransformRule(db, tenantId, input.ruleId);
  if (!rule || !rule.isActive) {
    throw new TransformError("Ο κανόνας δεν βρέθηκε ή είναι ανενεργός", 404);
  }
  const meta = getHandlerMeta(rule.handlerKey);
  if (!meta) throw new TransformError("Μη υποστηριζόμενος handler");

  const cov = await buildCoverage(
    db,
    tenantId,
    rule.handlerKey as HandlerKey,
    input.sourceId,
  );

  let selectedLines = cov.lines;
  try {
    if (input.lines) {
      selectedLines = resolveSelections(
        cov.lines,
        input.lines,
        rule.allowPartial,
      );
    } else {
      selectedLines = resolveSelections(cov.lines, undefined, rule.allowPartial);
    }
  } catch {
    selectedLines = cov.lines.map((l) => ({ ...l, selected: 0 }));
  }

  const merged = cov.lines.map((l) => {
    const sel = selectedLines.find((s) => s.sourceLineId === l.sourceLineId);
    return { ...l, selected: sel?.selected ?? 0 };
  });

  const canExecute =
    !cov.blockingReason && merged.some((l) => l.selected > 0.0001);

  return {
    rule: {
      id: rule.id,
      code: rule.code,
      name: rule.name,
      handlerKey: rule.handlerKey,
      sourceKind: rule.sourceKind,
      targetKind: rule.targetKind,
      allowPartial: rule.allowPartial,
      coverageMode: rule.coverageMode,
      issueMode: rule.issueMode,
      copyNotes: rule.copyNotes,
      defaultSeriesId: rule.defaultSeriesId,
    },
    source: cov.source,
    lines: merged,
    canExecute,
    blockingReason: cov.blockingReason,
  };
}

async function resolveSeries(
  db: Db,
  tenantId: string,
  targetKind: string,
  seriesId?: string | null,
  defaultSeriesId?: string | null,
  legalEntityId?: string | null,
) {
  const companyFilter = legalEntityId ? { legalEntityId } : {};
  if (seriesId) {
    const s = await db.documentSeries.findFirst({
      where: {
        id: seriesId,
        tenantId,
        kind: targetKind as never,
        isActive: true,
        ...companyFilter,
      },
    });
    if (s) return s;
  }
  if (defaultSeriesId) {
    const s = await db.documentSeries.findFirst({
      where: {
        id: defaultSeriesId,
        tenantId,
        kind: targetKind as never,
        isActive: true,
        ...companyFilter,
      },
    });
    if (s) return s;
  }
  return resolveDefaultSeries(
    db,
    tenantId,
    targetKind as never,
    null,
    legalEntityId,
  );
}

export async function executeTransform(
  db: Db,
  ctx: {
    tenantId: string;
    userId: string;
    ruleId: string;
    sourceId: string;
    seriesId?: string | null;
    notes?: string | null;
    lines?: LineSel[];
    issueMode?: "DRAFT" | "ISSUE_NOW";
  },
) {
  const rule = await getTransformRule(db, ctx.tenantId, ctx.ruleId);
  if (!rule || !rule.isActive) {
    throw new TransformError("Ο κανόνας δεν βρέθηκε ή είναι ανενεργός", 404);
  }
  const handlerKey = rule.handlerKey as HandlerKey;
  const meta = getHandlerMeta(handlerKey);
  if (!meta) throw new TransformError("Μη υποστηριζόμενος handler");

  const cov = await buildCoverage(db, ctx.tenantId, handlerKey, ctx.sourceId);
  if (cov.blockingReason) {
    throw new TransformError(cov.blockingReason, 409);
  }
  const selected = resolveSelections(cov.lines, ctx.lines, rule.allowPartial);
  if (selected.length === 0) {
    throw new TransformError("Δεν επιλέχθηκαν γραμμές με υπόλοιπο");
  }

  const issueMode = ctx.issueMode ?? rule.issueMode;
  const sourceLegalEntityId =
    cov.raw &&
    typeof cov.raw === "object" &&
    "legalEntityId" in cov.raw &&
    typeof (cov.raw as { legalEntityId?: unknown }).legalEntityId === "string"
      ? (cov.raw as { legalEntityId: string }).legalEntityId
      : null;
  const series = await resolveSeries(
    db,
    ctx.tenantId,
    rule.targetKind,
    ctx.seriesId,
    rule.defaultSeriesId,
    sourceLegalEntityId,
  );
  if (!series && handlerKey !== "quote_to_order") {
    // quote_to_order also needs series
  }
  if (!series) {
    throw new TransformError(
      `Δεν υπάρχει ενεργή σειρά για ${rule.targetKind}`,
    );
  }

  if (!series.allowPartial && rule.allowPartial) {
    // series forbids partial — enforce full remaining for selected set
    const needsFull = selected.some((s) => {
      const line = cov.lines.find((l) => l.sourceLineId === s.sourceLineId)!;
      return !eps(s.selected, line.remaining);
    });
    if (needsFull) {
      throw new TransformError("Η σειρά δεν επιτρέπει μερικό μετασχηματισμό");
    }
  }

  switch (handlerKey) {
    case "quote_to_order":
      return execQuoteToOrder(db, ctx, rule, cov.raw as never, selected, series, issueMode);
    case "order_to_invoice":
      return execOrderToInvoice(db, ctx, rule, cov.raw as never, selected, series, issueMode);
    case "order_to_delivery":
      return execOrderToDelivery(db, ctx, rule, cov.raw as never, selected, series, issueMode);
    case "invoice_to_credit":
      return execInvoiceToCredit(db, ctx, rule, cov.raw as never, selected, series, issueMode);
    case "invoice_to_delivery":
      return execInvoiceToDelivery(db, ctx, rule, cov.raw as never, selected, series, issueMode);
    case "delivery_to_invoice":
      return execDeliveryToInvoice(db, ctx, rule, cov.raw as never, selected, series, issueMode);
    default:
      throw new TransformError("Handler δεν υλοποιήθηκε");
  }
}

type RuleRow = NonNullable<Awaited<ReturnType<typeof getTransformRule>>>;
type SeriesRow = NonNullable<Awaited<ReturnType<typeof resolveSeries>>>;
type ExecCtx = {
  tenantId: string;
  userId: string;
  notes?: string | null;
};

async function execQuoteToOrder(
  db: Db,
  ctx: ExecCtx,
  rule: RuleRow,
  quote: {
    id: string;
    number: string;
    legalEntityId: string;
    customerId: string;
    branchId: string | null;
    spaceId: string | null;
    currency: string;
    subtotal: unknown;
    vatAmount: unknown;
    total: unknown;
    notes: string | null;
    lines: Array<{
      productId: string | null;
      position: number;
      description: string;
      quantity: unknown;
      unitPrice: unknown;
      vatRate: unknown;
      lineTotal: unknown;
    }>;
  },
  _selected: CoverageLine[],
  series: SeriesRow,
  issueMode: string,
) {
  const status = issueMode === "DRAFT" ? "DRAFT" : "CONFIRMED";
  const notes =
    ctx.notes?.trim() ||
    (rule.copyNotes
      ? `Από προσφορά ${quote.number}${quote.notes ? `\n${quote.notes}` : ""}`
      : `Από προσφορά ${quote.number}`);

  const order = await db.$transaction(async (tx) => {
    const allocated = await allocateFromSeries(tx, {
      tenantId: ctx.tenantId,
      seriesId: series.id,
      kind: "SALES_ORDER",
      legalEntityId: quote.legalEntityId,
    });
    const created = await tx.order.create({
      data: {
        tenantId: ctx.tenantId,
        legalEntityId: quote.legalEntityId,
        customerId: quote.customerId,
        branchId: quote.branchId,
        spaceId: quote.spaceId,
        seriesId: allocated.seriesId,
        siteId: allocated.siteId,
        sourceQuoteId: quote.id,
        kind: "SALES_ORDER",
        number: allocated.number,
        status,
        currency: quote.currency,
        subtotal: quote.subtotal as Prisma.Decimal,
        vatAmount: quote.vatAmount as Prisma.Decimal,
        total: quote.total as Prisma.Decimal,
        notes,
        lines: {
          create: quote.lines.map((line) => ({
            tenantId: ctx.tenantId,
            productId: line.productId,
            position: line.position,
            description: line.description,
            quantity: line.quantity as Prisma.Decimal,
            unitPrice: line.unitPrice as Prisma.Decimal,
            vatRate: line.vatRate as Prisma.Decimal,
            lineTotal: line.lineTotal as Prisma.Decimal,
          })),
        },
      },
    });
    await tx.order.update({
      where: { id: quote.id },
      data: { status: "CONFIRMED" },
    });
    return created;
  });

  return {
    targetKind: "SALES_ORDER" as const,
    targetId: order.id,
    targetNumber: order.number,
    href: `/orders/${order.id}`,
  };
}

async function execOrderToInvoice(
  db: Db,
  ctx: ExecCtx,
  rule: RuleRow,
  order: {
    id: string;
    number: string;
    legalEntityId: string;
    customerId: string;
    branchId: string | null;
    spaceId: string | null;
    currency: string;
    notes: string | null;
  },
  selected: CoverageLine[],
  series: SeriesRow,
  issueMode: string,
) {
  const prepared = selected.map((l) => ({
    orderLineId: l.sourceLineId,
    productId: l.productId,
    description: l.description,
    quantity: l.selected,
    unitPrice: l.unitPrice,
    vatRate: l.vatRate,
  }));
  const totals = calcInvoiceTotals(prepared);
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 30);
  const status = issueMode === "DRAFT" ? "DRAFT" : "ISSUED";
  const notes =
    ctx.notes?.trim() ||
    (rule.copyNotes
      ? `Από παραγγελία ${order.number}${order.notes ? `\n${order.notes}` : ""}`
      : `Από παραγγελία ${order.number}`);

  const invoice = await db.$transaction(async (tx) => {
    const allocated = await allocateFromSeries(tx, {
      tenantId: ctx.tenantId,
      seriesId: series.id,
      kind: "SALES_INVOICE",
      legalEntityId: order.legalEntityId,
    });
    const created = await tx.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        legalEntityId: order.legalEntityId,
        customerId: order.customerId,
        branchId: order.branchId,
        spaceId: order.spaceId,
        orderId: order.id,
        seriesId: allocated.seriesId,
        siteId: allocated.siteId,
        kind: "SALES_INVOICE",
        number: allocated.number,
        status,
        issuedAt: status === "ISSUED" ? new Date() : null,
        dueAt,
        currency: order.currency,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        paidAmount: 0,
        notes,
        lines: {
          create: prepared.map((line, idx) => ({
            tenantId: ctx.tenantId,
            productId: line.productId,
            orderLineId: line.orderLineId,
            position: idx + 1,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
            lineTotal: totals.lines[idx]!.lineTotal,
          })),
        },
      },
    });
    for (const line of prepared) {
      await tx.orderLine.update({
        where: { id: line.orderLineId },
        data: { quantityInvoiced: { increment: line.quantity } },
      });
    }
    const refreshed = await tx.orderLine.findMany({ where: { orderId: order.id } });
    const fully = refreshed.every(
      (l) => toNumber(l.quantityInvoiced) >= toNumber(l.quantity) - 0.0001,
    );
    await tx.order.update({
      where: { id: order.id },
      data: { status: fully ? "INVOICED" : "PARTIAL_INVOICED" },
    });
    return created;
  });

  return {
    targetKind: "SALES_INVOICE" as const,
    targetId: invoice.id,
    targetNumber: invoice.number,
    href: `/invoices/${invoice.id}`,
  };
}

async function execOrderToDelivery(
  db: Db,
  ctx: ExecCtx,
  rule: RuleRow,
  order: {
    id: string;
    number: string;
    legalEntityId: string;
    customerId: string;
    siteId: string | null;
    notes: string | null;
  },
  selected: CoverageLine[],
  series: SeriesRow,
  issueMode: string,
) {
  const notes =
    ctx.notes?.trim() ||
    (rule.copyNotes
      ? `Από παραγγελία ${order.number}${order.notes ? `\n${order.notes}` : ""}`
      : `Από παραγγελία ${order.number}`);

  const note = await db.$transaction(async (tx) => {
    const allocated = await allocateFromSeries(tx, {
      tenantId: ctx.tenantId,
      seriesId: series.id,
      kind: "DELIVERY_NOTE",
      legalEntityId: order.legalEntityId,
    });
    const created = await tx.deliveryNote.create({
      data: {
        tenantId: ctx.tenantId,
        legalEntityId: order.legalEntityId,
        customerId: order.customerId,
        orderId: order.id,
        seriesId: allocated.seriesId,
        siteId: allocated.siteId ?? order.siteId,
        number: allocated.number,
        status: "DRAFT",
        notes,
        lines: {
          create: selected.map((line, idx) => ({
            tenantId: ctx.tenantId,
            productId: line.productId,
            orderLineId: line.sourceLineId,
            position: idx + 1,
            description: line.description,
            quantity: line.selected,
          })),
        },
      },
    });
    for (const line of selected) {
      await tx.orderLine.update({
        where: { id: line.sourceLineId },
        data: { quantityDelivered: { increment: line.selected } },
      });
    }
    return created;
  });

  if (issueMode === "ISSUE_NOW") {
    await issueDeliveryNote(db, {
      tenantId: ctx.tenantId,
      deliveryNoteId: note.id,
      userId: ctx.userId,
      allowNegative: true,
    });
  }

  return {
    targetKind: "DELIVERY_NOTE" as const,
    targetId: note.id,
    targetNumber: note.number,
    href: `/delivery-notes/${note.id}`,
  };
}

async function execInvoiceToCredit(
  db: Db,
  ctx: ExecCtx,
  rule: RuleRow,
  source: {
    id: string;
    number: string;
    legalEntityId: string;
    customerId: string;
    branchId: string | null;
    spaceId: string | null;
    currency: string;
    dueAt: Date | null;
  },
  selected: CoverageLine[],
  series: SeriesRow,
  issueMode: string,
) {
  const prepared = selected.map((l) => ({
    sourceLineId: l.sourceLineId,
    productId: l.productId,
    description: l.description,
    quantity: l.selected,
    unitPrice: l.unitPrice,
    vatRate: l.vatRate,
  }));
  const totals = calcInvoiceTotals(prepared);
  let statusOption;
  try {
    statusOption = await resolveInvoiceStatusOption(db, ctx.tenantId, {
      statusCode: issueMode === "ISSUE_NOW" ? "ISSUE_NOW" : "DRAFT",
      forCreate: true,
    });
  } catch (err) {
    if (err instanceof InvoiceStatusOptionError) {
      throw new TransformError(err.message, err.status);
    }
    throw err;
  }
  const status = statusOption.workflow === "ISSUED" ? "ISSUED" : "DRAFT";
  const notes =
    ctx.notes?.trim() || `Πιστωτικό για ${source.number}`;

  const credit = await db.$transaction(async (tx) => {
    const allocated = await allocateFromSeries(tx, {
      tenantId: ctx.tenantId,
      seriesId: series.id,
      kind: "SALES_CREDIT",
      legalEntityId: source.legalEntityId,
    });
    const created = await tx.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        legalEntityId: source.legalEntityId,
        customerId: source.customerId,
        branchId: source.branchId,
        spaceId: source.spaceId,
        seriesId: allocated.seriesId,
        siteId: allocated.siteId,
        relatedInvoiceId: source.id,
        kind: "SALES_CREDIT",
        number: allocated.number,
        status,
        statusOptionId: statusOption.id,
        issuedAt: status === "ISSUED" ? new Date() : null,
        dueAt: source.dueAt,
        currency: source.currency,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        paidAmount: 0,
        notes,
        lines: {
          create: prepared.map((line, idx) => ({
            tenantId: ctx.tenantId,
            productId: line.productId,
            sourceInvoiceLineId: line.sourceLineId,
            position: idx + 1,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
            lineTotal: totals.lines[idx]!.lineTotal,
          })),
        },
      },
    });
    for (const line of prepared) {
      await tx.invoiceLine.update({
        where: { id: line.sourceLineId },
        data: { quantityCredited: { increment: line.quantity } },
      });
    }
    return created;
  });

  return {
    targetKind: "SALES_CREDIT" as const,
    targetId: credit.id,
    targetNumber: credit.number,
    href: `/invoices/${credit.id}`,
  };
}

async function execInvoiceToDelivery(
  db: Db,
  ctx: ExecCtx,
  rule: RuleRow,
  source: {
    id: string;
    number: string;
    legalEntityId: string;
    customerId: string;
    siteId: string | null;
    orderId: string | null;
    notes: string | null;
    lines: Array<{ id: string; orderLineId: string | null }>;
  },
  selected: CoverageLine[],
  series: SeriesRow,
  issueMode: string,
) {
  const notes =
    ctx.notes?.trim() ||
    (rule.copyNotes
      ? `Από τιμολόγιο ${source.number}`
      : `Από τιμολόγιο ${source.number}`);

  const note = await db.$transaction(async (tx) => {
    const allocated = await allocateFromSeries(tx, {
      tenantId: ctx.tenantId,
      seriesId: series.id,
      kind: "DELIVERY_NOTE",
      legalEntityId: source.legalEntityId,
    });
    return tx.deliveryNote.create({
      data: {
        tenantId: ctx.tenantId,
        legalEntityId: source.legalEntityId,
        customerId: source.customerId,
        invoiceId: source.id,
        orderId: source.orderId,
        seriesId: allocated.seriesId,
        siteId: allocated.siteId ?? source.siteId,
        number: allocated.number,
        status: "DRAFT",
        notes,
        lines: {
          create: selected.map((line, idx) => {
            const src = source.lines.find((l) => l.id === line.sourceLineId);
            return {
              tenantId: ctx.tenantId,
              productId: line.productId,
              invoiceLineId: line.sourceLineId,
              orderLineId: src?.orderLineId ?? null,
              position: idx + 1,
              description: line.description,
              quantity: line.selected,
            };
          }),
        },
      },
    });
  });

  if (issueMode === "ISSUE_NOW") {
    await issueDeliveryNote(db, {
      tenantId: ctx.tenantId,
      deliveryNoteId: note.id,
      userId: ctx.userId,
      allowNegative: true,
    });
  }

  return {
    targetKind: "DELIVERY_NOTE" as const,
    targetId: note.id,
    targetNumber: note.number,
    href: `/delivery-notes/${note.id}`,
  };
}

async function execDeliveryToInvoice(
  db: Db,
  ctx: ExecCtx,
  rule: RuleRow,
  note: {
    id: string;
    number: string;
    legalEntityId: string;
    customerId: string;
    siteId: string | null;
    orderId: string | null;
    notes: string | null;
    lines: Array<{
      id: string;
      orderLineId: string | null;
      productId: string | null;
    }>;
    order: {
      id: string;
      branchId: string | null;
      spaceId: string | null;
      currency: string;
      lines: Array<{
        id: string;
        unitPrice: unknown;
        vatRate: unknown;
      }>;
    } | null;
  },
  selected: CoverageLine[],
  series: SeriesRow,
  issueMode: string,
) {
  const prepared = selected.map((l) => {
    const dnLine = note.lines.find((x) => x.id === l.sourceLineId);
    const orderLine = dnLine?.orderLineId
      ? note.order?.lines.find((ol) => ol.id === dnLine.orderLineId)
      : null;
    return {
      deliveryLineId: l.sourceLineId,
      orderLineId: dnLine?.orderLineId ?? null,
      productId: l.productId,
      description: l.description,
      quantity: l.selected,
      unitPrice: orderLine ? toNumber(orderLine.unitPrice) : l.unitPrice,
      vatRate: orderLine ? toNumber(orderLine.vatRate) : l.vatRate,
    };
  });
  if (prepared.some((p) => p.unitPrice <= 0 && !p.orderLineId)) {
    throw new TransformError(
      "Για τιμολόγηση από δελτίο απαιτούνται τιμές από συνδεδεμένη παραγγελία",
    );
  }
  const totals = calcInvoiceTotals(prepared);
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 30);
  const status = issueMode === "DRAFT" ? "DRAFT" : "ISSUED";
  const notes =
    ctx.notes?.trim() ||
    (rule.copyNotes
      ? `Από δελτίο ${note.number}${note.notes ? `\n${note.notes}` : ""}`
      : `Από δελτίο ${note.number}`);

  const invoice = await db.$transaction(async (tx) => {
    const allocated = await allocateFromSeries(tx, {
      tenantId: ctx.tenantId,
      seriesId: series.id,
      kind: "SALES_INVOICE",
      legalEntityId: note.legalEntityId,
    });
    const created = await tx.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        legalEntityId: note.legalEntityId,
        customerId: note.customerId,
        branchId: note.order?.branchId ?? null,
        spaceId: note.order?.spaceId ?? null,
        orderId: note.orderId,
        seriesId: allocated.seriesId,
        siteId: allocated.siteId ?? note.siteId,
        kind: "SALES_INVOICE",
        number: allocated.number,
        status,
        issuedAt: status === "ISSUED" ? new Date() : null,
        dueAt,
        currency: note.order?.currency ?? "EUR",
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        paidAmount: 0,
        notes,
        lines: {
          create: prepared.map((line, idx) => ({
            tenantId: ctx.tenantId,
            productId: line.productId,
            orderLineId: line.orderLineId,
            position: idx + 1,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
            lineTotal: totals.lines[idx]!.lineTotal,
          })),
        },
      },
    });

    for (const line of prepared) {
      await tx.deliveryNoteLine.update({
        where: { id: line.deliveryLineId },
        data: { quantityInvoiced: { increment: line.quantity } },
      });
      if (line.orderLineId) {
        await tx.orderLine.update({
          where: { id: line.orderLineId },
          data: { quantityInvoiced: { increment: line.quantity } },
        });
      }
    }

    if (note.orderId) {
      const refreshed = await tx.orderLine.findMany({
        where: { orderId: note.orderId },
      });
      const fully = refreshed.every(
        (l) => toNumber(l.quantityInvoiced) >= toNumber(l.quantity) - 0.0001,
      );
      await tx.order.update({
        where: { id: note.orderId },
        data: { status: fully ? "INVOICED" : "PARTIAL_INVOICED" },
      });
    }

    await tx.deliveryNote.update({
      where: { id: note.id },
      data: { invoiceId: created.id },
    });

    return created;
  });

  return {
    targetKind: "SALES_INVOICE" as const,
    targetId: invoice.id,
    targetNumber: invoice.number,
    href: `/invoices/${invoice.id}`,
  };
}
