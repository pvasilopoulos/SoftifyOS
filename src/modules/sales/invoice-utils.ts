export const invoiceStatusLabel = {
  DRAFT: "Πρόχειρο",
  ISSUED: "Εκδομένο",
  PARTIAL: "Μερική εξόφληση",
  PAID: "Πληρωμένο",
  OVERDUE: "Ληξιπρόθεσμο",
  CANCELLED: "Ακυρωμένο",
} as const;

export const invoiceStatusTone = {
  DRAFT: "slate",
  ISSUED: "teal",
  PARTIAL: "amber",
  PAID: "emerald",
  OVERDUE: "rose",
  CANCELLED: "slate",
} as const;

export type InvoiceStatusKey = keyof typeof invoiceStatusLabel;

export function formatEUR(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat("el-GR", {
      style: "currency",
      currency: "EUR",
    }).format(amount);
  } catch {
    return `€${amount.toFixed(2)}`;
  }
}

export function paidRatio(paidAmount: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.min(1, Math.max(0, paidAmount / total));
}

export function toNumber(value: unknown) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return Number(value);
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calcLineTotals(input: {
  quantity: number;
  unitPrice: number;
  vatRate: number;
}) {
  const net = input.quantity * input.unitPrice;
  const vat = net * (input.vatRate / 100);
  return {
    net: roundMoney(net),
    vat: roundMoney(vat),
    lineTotal: roundMoney(net + vat),
  };
}

export function calcInvoiceTotals(
  lines: Array<{ quantity: number; unitPrice: number; vatRate: number }>,
) {
  let subtotal = 0;
  let vatAmount = 0;
  const prepared = lines.map((line, idx) => {
    const { net, vat, lineTotal } = calcLineTotals(line);
    subtotal += net;
    vatAmount += vat;
    return {
      position: idx + 1,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      lineTotal,
    };
  });
  return {
    lines: prepared,
    subtotal: roundMoney(subtotal),
    vatAmount: roundMoney(vatAmount),
    total: roundMoney(subtotal + vatAmount),
  };
}
