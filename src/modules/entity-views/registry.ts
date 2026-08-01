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

const customerLegalFormOptions = [
  { value: "AE", label: "Α.Ε." },
  { value: "OE", label: "Ο.Ε." },
  { value: "EE", label: "Ε.Ε." },
  { value: "IKE", label: "Ι.Κ.Ε." },
  { value: "EPE", label: "Ε.Π.Ε." },
  { value: "INDIVIDUAL", label: "Φυσικό πρόσωπο" },
  { value: "PUBLIC", label: "Δημόσιο / ΝΠΔΔ" },
  { value: "NGO", label: "ΜΚΟ / Σωματείο" },
  { value: "OTHER", label: "Άλλο" },
];

const customerVatStatusOptions = [
  { value: "NORMAL", label: "Κανονικό ΦΠΑ" },
  { value: "EXEMPT", label: "Απαλλαγή" },
  { value: "INTRA_EU", label: "Ενδοκοινοτικό" },
  { value: "EXPORT", label: "Εξαγωγή" },
  { value: "OSS", label: "OSS" },
];

const customerCategoryOptions = [
  { value: "RETAIL", label: "Λιανική" },
  { value: "WHOLESALE", label: "Χονδρική" },
  { value: "DISTRIBUTOR", label: "Διανομέας" },
  { value: "PUBLIC", label: "Δημόσιο" },
  { value: "INTERNAL", label: "Εσωτερικός" },
  { value: "OTHER", label: "Άλλο" },
];

const countryOptions = [
  { value: "GR", label: "Ελλάδα" },
  { value: "CY", label: "Κύπρος" },
  { value: "BG", label: "Βουλγαρία" },
  { value: "RO", label: "Ρουμανία" },
  { value: "DE", label: "Γερμανία" },
  { value: "IT", label: "Ιταλία" },
  { value: "FR", label: "Γαλλία" },
  { value: "GB", label: "Ην. Βασίλειο" },
  { value: "US", label: "ΗΠΑ" },
  { value: "OTHER", label: "Άλλη" },
];

const currencyOptions = [
  { value: "EUR", label: "EUR" },
  { value: "USD", label: "USD" },
  { value: "GBP", label: "GBP" },
  { value: "CHF", label: "CHF" },
];

const localeOptions = [
  { value: "el-GR", label: "Ελληνικά" },
  { value: "en-GB", label: "English" },
  { value: "de-DE", label: "Deutsch" },
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
      { key: "tradeName", label: "Διακριτικός τίτλος", type: "text", listable: true, formable: true, filterable: true },
      { key: "legalForm", label: "Νομική μορφή", type: "select", listable: true, formable: true, filterable: true, options: customerLegalFormOptions },
      { key: "isPerson", label: "Φυσικό πρόσωπο", type: "boolean", formable: true, filterable: true },
      { key: "vatNumber", label: "ΑΦΜ", type: "text", listable: true, formable: true, filterable: true },
      { key: "taxOffice", label: "ΔΟΥ", type: "text", listable: true, formable: true, filterable: true },
      { key: "gemhNumber", label: "ΓΕΜΗ", type: "text", formable: true, filterable: true },
      { key: "eoriNumber", label: "EORI", type: "text", formable: true },
      { key: "vatStatus", label: "Καθεστώς ΦΠΑ", type: "select", listable: true, formable: true, filterable: true, options: customerVatStatusOptions },
      { key: "profession", label: "Επάγγελμα", type: "text", formable: true },
      { key: "email", label: "Email", type: "email", listable: true, formable: true, filterable: true },
      { key: "phone", label: "Τηλέφωνο", type: "phone", listable: true, formable: true },
      { key: "mobile", label: "Κινητό", type: "phone", listable: true, formable: true },
      { key: "fax", label: "Fax", type: "phone", formable: true },
      { key: "website", label: "Ιστότοπος", type: "text", formable: true },
      { key: "address", label: "Διεύθυνση", type: "text", listable: true, formable: true },
      { key: "address2", label: "Διεύθυνση 2", type: "text", formable: true },
      { key: "city", label: "Πόλη", type: "text", listable: true, formable: true, filterable: true },
      { key: "postalCode", label: "Τ.Κ.", type: "text", listable: true, formable: true },
      { key: "region", label: "Νομός / Περιοχή", type: "text", formable: true, filterable: true },
      { key: "country", label: "Χώρα", type: "select", listable: true, formable: true, filterable: true, options: countryOptions },
      { key: "shippingAddress", label: "Διεύθυνση αποστολής", type: "text", formable: true },
      { key: "shippingAddress2", label: "Διεύθυνση αποστολής 2", type: "text", formable: true },
      { key: "shippingCity", label: "Πόλη αποστολής", type: "text", formable: true },
      { key: "shippingPostalCode", label: "Τ.Κ. αποστολής", type: "text", formable: true },
      { key: "shippingRegion", label: "Νομός αποστολής", type: "text", formable: true },
      { key: "shippingCountry", label: "Χώρα αποστολής", type: "select", formable: true, options: countryOptions },
      { key: "category", label: "Κατηγορία", type: "select", listable: true, formable: true, filterable: true, options: customerCategoryOptions },
      { key: "salesperson", label: "Πωλητής", type: "text", listable: true, formable: true, filterable: true },
      { key: "paymentTermsDays", label: "Όροι πληρωμής (ημέρες)", type: "number", listable: true, formable: true },
      { key: "paymentTermsLabel", label: "Όροι πληρωμής", type: "text", formable: true },
      { key: "creditLimit", label: "Πιστωτικό όριο", type: "money", listable: true, formable: true },
      { key: "currency", label: "Νόμισμα", type: "select", listable: true, formable: true, options: currencyOptions },
      { key: "locale", label: "Γλώσσα", type: "select", formable: true, options: localeOptions },
      { key: "discountPercent", label: "Έκπτωση %", type: "number", formable: true },
      { key: "priceListCode", label: "Τιμοκατάλογος", type: "text", formable: true },
      { key: "shippingMethod", label: "Τρόπος αποστολής", type: "text", formable: true },
      { key: "iban", label: "IBAN", type: "text", formable: true },
      { key: "bic", label: "BIC/SWIFT", type: "text", formable: true },
      { key: "bankName", label: "Τράπεζα", type: "text", formable: true },
      { key: "bankAccountHolder", label: "Δικαιούχος λογαριασμού", type: "text", formable: true },
      { key: "isBlocked", label: "Μπλοκαρισμένος", type: "boolean", listable: true, formable: true, filterable: true },
      { key: "sendEinvoice", label: "Ηλ. τιμολόγηση", type: "boolean", formable: true },
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
