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
