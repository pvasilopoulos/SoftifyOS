import { toNumber } from "@/modules/sales/invoice-utils";

type OrderLike = {
  id: string;
  number: string;
  kind: string;
  status: string;
  customerId: string;
  branchId: string | null;
  spaceId: string | null;
  seriesId: string | null;
  notes: string | null;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  lines?: Array<{
    id?: string;
    position: number;
    description: string;
    quantity: unknown;
    unitPrice: unknown;
    vatRate: unknown;
    lineTotal: unknown;
    quantityInvoiced?: unknown;
    productId?: string | null;
  }>;
};

/** Compact snapshot for audit before/after. */
export function orderAuditSnapshot(order: OrderLike): Record<string, unknown> {
  return {
    id: order.id,
    number: order.number,
    kind: order.kind,
    status: order.status,
    customerId: order.customerId,
    branchId: order.branchId,
    spaceId: order.spaceId,
    seriesId: order.seriesId,
    notes: order.notes,
    subtotal: toNumber(order.subtotal),
    vatAmount: toNumber(order.vatAmount),
    total: toNumber(order.total),
    lineCount: order.lines?.length ?? 0,
    lines: (order.lines ?? []).map((line) => ({
      id: line.id ?? null,
      position: line.position,
      description: line.description,
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPrice),
      vatRate: toNumber(line.vatRate),
      lineTotal: toNumber(line.lineTotal),
      quantityInvoiced:
        line.quantityInvoiced == null
          ? undefined
          : toNumber(line.quantityInvoiced),
      productId: line.productId ?? null,
    })),
  };
}
