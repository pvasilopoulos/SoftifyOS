import type { HandlerKey } from "./schemas";
import type { DocumentKind } from "@/generated/prisma/client";

export type HandlerMeta = {
  key: HandlerKey;
  label: string;
  description: string;
  sourceKind: DocumentKind;
  targetKind: DocumentKind;
  defaultCoverage: "FULL_COPY" | "QUANTITY";
  defaultAllowPartial: boolean;
};

export const HANDLER_CATALOG: HandlerMeta[] = [
  {
    key: "quote_to_order",
    label: "Προσφορά → Παραγγελία",
    description: "Πλήρης αντιγραφή γραμμών σε νέα παραγγελία.",
    sourceKind: "SALES_QUOTE",
    targetKind: "SALES_ORDER",
    defaultCoverage: "FULL_COPY",
    defaultAllowPartial: false,
  },
  {
    key: "order_to_invoice",
    label: "Παραγγελία → Τιμολόγιο",
    description: "Τιμολόγηση υπολοίπων γραμμών (quantityInvoiced).",
    sourceKind: "SALES_ORDER",
    targetKind: "SALES_INVOICE",
    defaultCoverage: "QUANTITY",
    defaultAllowPartial: true,
  },
  {
    key: "order_to_delivery",
    label: "Παραγγελία → Δελτίο αποστολής",
    description: "Αποστολή υπολοίπων γραμμών (quantityDelivered).",
    sourceKind: "SALES_ORDER",
    targetKind: "DELIVERY_NOTE",
    defaultCoverage: "QUANTITY",
    defaultAllowPartial: true,
  },
  {
    key: "invoice_to_credit",
    label: "Τιμολόγιο → Πιστωτικό",
    description: "Πίστωση με κάλυψη quantityCredited ανά γραμμή.",
    sourceKind: "SALES_INVOICE",
    targetKind: "SALES_CREDIT",
    defaultCoverage: "QUANTITY",
    defaultAllowPartial: true,
  },
  {
    key: "invoice_to_delivery",
    label: "Τιμολόγιο → Δελτίο αποστολής",
    description: "Αποστολή από γραμμές τιμολογίου.",
    sourceKind: "SALES_INVOICE",
    targetKind: "DELIVERY_NOTE",
    defaultCoverage: "QUANTITY",
    defaultAllowPartial: true,
  },
  {
    key: "delivery_to_invoice",
    label: "Δελτίο → Τιμολόγιο",
    description: "Τιμολόγηση παραδοθέντων από δελτίο αποστολής.",
    sourceKind: "DELIVERY_NOTE",
    targetKind: "SALES_INVOICE",
    defaultCoverage: "QUANTITY",
    defaultAllowPartial: true,
  },
];

export function getHandlerMeta(key: string): HandlerMeta | null {
  return HANDLER_CATALOG.find((h) => h.key === key) ?? null;
}
