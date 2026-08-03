export const myDataStatusLabel: Record<string, string> = {
  PENDING: "Εκκρεμεί",
  SENT: "Στάλθηκε",
  ACCEPTED: "Αποδοχή",
  REJECTED: "Απόρριψη",
  CANCELLED: "Ακυρωμένη",
};

export const myDataEntityTypeLabel: Record<string, string> = {
  invoice: "Τιμολόγιο πώλησης",
  delivery_note: "Δελτίο αποστολής",
  deliveryNote: "Δελτίο αποστολής",
  purchase_invoice: "Τιμολόγιο αγοράς",
  purchaseInvoice: "Τιμολόγιο αγοράς",
};

export function entityHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "invoice":
      return `/invoices/${entityId}`;
    case "delivery_note":
    case "deliveryNote":
      return `/delivery-notes/${entityId}`;
    case "purchase_invoice":
    case "purchaseInvoice":
      return `/purchasing`;
    default:
      return null;
  }
}
