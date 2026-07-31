import type { EntityModule } from "@/generated/prisma/client";

export type FieldSource = "system" | "custom";

export type BuiltinFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "select"
  | "email"
  | "phone"
  | "textarea"
  | "money"
  | "badge";

export type BuiltinField = {
  key: string;
  label: string;
  type: BuiltinFieldType;
  required?: boolean;
  /** Can appear as list column */
  listable?: boolean;
  /** Can appear on forms */
  formable?: boolean;
  /** Can be used in saved filters */
  filterable?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export type EntityMeta = {
  entity: EntityModule;
  label: string;
  labelSingular: string;
  href: string;
  builtins: BuiltinField[];
};

const statusActiveInactive = [
  { value: "ACTIVE", label: "Ενεργό" },
  { value: "INACTIVE", label: "Ανενεργό" },
];

export const ENTITY_MODULES: EntityModule[] = [
  "CUSTOMERS",
  "PRODUCTS",
  "INVOICES",
  "ORDERS",
  "QUOTES",
  "GIFT_CARDS",
];

export const ENTITY_REGISTRY: Record<EntityModule, EntityMeta> = {
  CUSTOMERS: {
    entity: "CUSTOMERS",
    label: "Πελάτες",
    labelSingular: "Πελάτης",
    href: "/customers",
    builtins: [
      { key: "code", label: "Κωδικός", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "name", label: "Επωνυμία", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "vatNumber", label: "ΑΦΜ", type: "text", listable: true, formable: true, filterable: true },
      { key: "email", label: "Email", type: "email", listable: true, formable: true },
      { key: "phone", label: "Τηλέφωνο", type: "phone", listable: true, formable: true },
      { key: "status", label: "Κατάσταση", type: "select", listable: true, formable: true, filterable: true, options: statusActiveInactive },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "branchCount", label: "Υποκαταστήματα", type: "number", listable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true, filterable: true },
    ],
  },
  PRODUCTS: {
    entity: "PRODUCTS",
    label: "Προϊόντα",
    labelSingular: "Προϊόν",
    href: "/products",
    builtins: [
      { key: "sku", label: "SKU", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "barcode", label: "Barcode", type: "text", listable: true, formable: true, filterable: true },
      { key: "name", label: "Όνομα", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "unit", label: "Μονάδα", type: "text", listable: true, formable: true },
      { key: "price", label: "Τιμή", type: "money", listable: true, formable: true, filterable: true },
      { key: "vatRate", label: "ΦΠΑ %", type: "number", listable: true, formable: true },
      { key: "status", label: "Κατάσταση", type: "select", listable: true, formable: true, filterable: true, options: statusActiveInactive },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  INVOICES: {
    entity: "INVOICES",
    label: "Τιμολόγια",
    labelSingular: "Τιμολόγιο",
    href: "/invoices",
    builtins: [
      { key: "number", label: "Αριθμός", type: "text", listable: true, filterable: true },
      { key: "kind", label: "Είδος", type: "select", listable: true, filterable: true, options: [
        { value: "SALES_INVOICE", label: "Τιμολόγιο" },
        { value: "SALES_CREDIT", label: "Πιστωτικό" },
        { value: "RETAIL_RECEIPT", label: "ΑΠΥ" },
      ] },
      { key: "customerName", label: "Πελάτης", type: "text", listable: true, filterable: true },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, filterable: true, options: [
        { value: "DRAFT", label: "Πρόχειρο" },
        { value: "ISSUED", label: "Εκδομένο" },
        { value: "PARTIAL", label: "Μερικό" },
        { value: "PAID", label: "Εξοφλημένο" },
        { value: "OVERDUE", label: "Ληξιπρόθεσμο" },
        { value: "CANCELLED", label: "Ακυρωμένο" },
      ] },
      { key: "total", label: "Σύνολο", type: "money", listable: true, filterable: true },
      { key: "paidAmount", label: "Εξοφλημένα", type: "money", listable: true },
      { key: "dueAt", label: "Λήξη", type: "date", listable: true, filterable: true },
      { key: "issuedAt", label: "Έκδοση", type: "date", listable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  ORDERS: {
    entity: "ORDERS",
    label: "Παραγγελίες",
    labelSingular: "Παραγγελία",
    href: "/orders",
    builtins: [
      { key: "number", label: "Αριθμός", type: "text", listable: true, filterable: true },
      { key: "customerName", label: "Πελάτης", type: "text", listable: true, filterable: true },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, filterable: true },
      { key: "total", label: "Σύνολο", type: "money", listable: true },
      { key: "orderedAt", label: "Ημ/νία", type: "date", listable: true, filterable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  QUOTES: {
    entity: "QUOTES",
    label: "Προσφορές",
    labelSingular: "Προσφορά",
    href: "/quotes",
    builtins: [
      { key: "number", label: "Αριθμός", type: "text", listable: true, filterable: true },
      { key: "customerName", label: "Πελάτης", type: "text", listable: true, filterable: true },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, filterable: true },
      { key: "total", label: "Σύνολο", type: "money", listable: true },
      { key: "orderedAt", label: "Ημ/νία", type: "date", listable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  GIFT_CARDS: {
    entity: "GIFT_CARDS",
    label: "Δωροκάρτες",
    labelSingular: "Δωροκάρτα",
    href: "/gift-cards",
    builtins: [
      { key: "code", label: "Κωδικός", type: "text", listable: true, filterable: true },
      { key: "balance", label: "Υπόλοιπο", type: "money", listable: true },
      { key: "initialBalance", label: "Αρχικό", type: "money", listable: true },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, filterable: true },
      { key: "expiresAt", label: "Λήξη", type: "date", listable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
};

export function getEntityMeta(entity: EntityModule): EntityMeta {
  return ENTITY_REGISTRY[entity];
}

export function entityLabel(entity: EntityModule): string {
  return ENTITY_REGISTRY[entity].label;
}
