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
  "DELIVERY_NOTES",
  "GIFT_CARDS",
  "LOYALTY",
  "CRM_LEADS",
  "SUPPLIERS",
  "PURCHASE_ORDERS",
  "SITES",
  "EMPLOYEES",
  "JOURNAL_ENTRIES",
  "PAYMENT_METHODS",
  "DOCUMENT_SERIES",
  "MARKETPLACE_CHANNELS",
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
  DELIVERY_NOTES: {
    entity: "DELIVERY_NOTES",
    label: "Δελτία αποστολής",
    labelSingular: "Δελτίο αποστολής",
    href: "/delivery-notes",
    builtins: [
      { key: "number", label: "Αριθμός", type: "text", listable: true, filterable: true },
      { key: "customerName", label: "Πελάτης", type: "text", listable: true, filterable: true },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, filterable: true, options: [
        { value: "DRAFT", label: "Πρόχειρο" },
        { value: "ISSUED", label: "Εκδομένο" },
        { value: "CANCELLED", label: "Ακυρωμένο" },
      ] },
      { key: "issuedAt", label: "Έκδοση", type: "date", listable: true, filterable: true },
      { key: "shippingAddress", label: "Διεύθυνση αποστολής", type: "text", formable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  LOYALTY: {
    entity: "LOYALTY",
    label: "Loyalty",
    labelSingular: "Loyalty λογαριασμός",
    href: "/loyalty",
    builtins: [
      { key: "customerName", label: "Πελάτης", type: "text", listable: true, filterable: true },
      { key: "pointsBalance", label: "Πόντοι", type: "number", listable: true, formable: true, filterable: true },
      { key: "tier", label: "Βαθμίδα", type: "text", listable: true, formable: true, filterable: true },
      { key: "isActive", label: "Ενεργό", type: "boolean", listable: true, formable: true, filterable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  CRM_LEADS: {
    entity: "CRM_LEADS",
    label: "CRM Leads",
    labelSingular: "Lead",
    href: "/crm",
    builtins: [
      { key: "title", label: "Τίτλος", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "company", label: "Εταιρεία", type: "text", listable: true, formable: true, filterable: true },
      { key: "contactName", label: "Επαφή", type: "text", listable: true, formable: true },
      { key: "email", label: "Email", type: "email", listable: true, formable: true },
      { key: "phone", label: "Τηλέφωνο", type: "phone", listable: true, formable: true },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, formable: true, filterable: true, options: [
        { value: "NEW", label: "Νέο" },
        { value: "CONTACTED", label: "Επικοινωνία" },
        { value: "QUALIFIED", label: "Qualified" },
        { value: "PROPOSAL", label: "Πρόταση" },
        { value: "WON", label: "Κερδήθηκε" },
        { value: "LOST", label: "Χάθηκε" },
      ] },
      { key: "value", label: "Αξία", type: "money", listable: true, formable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  SUPPLIERS: {
    entity: "SUPPLIERS",
    label: "Προμηθευτές",
    labelSingular: "Προμηθευτής",
    href: "/purchasing",
    builtins: [
      { key: "code", label: "Κωδικός", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "name", label: "Επωνυμία", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "vatNumber", label: "ΑΦΜ", type: "text", listable: true, formable: true, filterable: true },
      { key: "email", label: "Email", type: "email", listable: true, formable: true },
      { key: "phone", label: "Τηλέφωνο", type: "phone", listable: true, formable: true },
      { key: "status", label: "Κατάσταση", type: "select", listable: true, formable: true, filterable: true, options: statusActiveInactive },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  PURCHASE_ORDERS: {
    entity: "PURCHASE_ORDERS",
    label: "Παραγγελίες αγοράς",
    labelSingular: "Παραγγελία αγοράς",
    href: "/purchasing",
    builtins: [
      { key: "number", label: "Αριθμός", type: "text", listable: true, filterable: true },
      { key: "supplierName", label: "Προμηθευτής", type: "text", listable: true, filterable: true },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, filterable: true, options: [
        { value: "DRAFT", label: "Πρόχειρο" },
        { value: "ORDERED", label: "Παραγγελμένο" },
        { value: "PARTIAL", label: "Μερικό" },
        { value: "RECEIVED", label: "Παραληφθέν" },
        { value: "CANCELLED", label: "Ακυρωμένο" },
      ] },
      { key: "total", label: "Σύνολο", type: "money", listable: true },
      { key: "orderedAt", label: "Ημ/νία", type: "date", listable: true, filterable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  SITES: {
    entity: "SITES",
    label: "Χώροι / Αποθήκες",
    labelSingular: "Χώρος",
    href: "/inventory",
    builtins: [
      { key: "code", label: "Κωδικός", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "name", label: "Όνομα", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "kind", label: "Είδος", type: "select", listable: true, formable: true, filterable: true, options: [
        { value: "BRANCH", label: "Υποκατάστημα" },
        { value: "WAREHOUSE", label: "Αποθήκη" },
        { value: "TILL", label: "Ταμείο" },
      ] },
      { key: "isActive", label: "Ενεργό", type: "boolean", listable: true, formable: true, filterable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  EMPLOYEES: {
    entity: "EMPLOYEES",
    label: "Εργαζόμενοι",
    labelSingular: "Εργαζόμενος",
    href: "/hr",
    builtins: [
      { key: "code", label: "Κωδικός", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "lastName", label: "Επώνυμο", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "firstName", label: "Όνομα", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "email", label: "Email", type: "email", listable: true, formable: true },
      { key: "phone", label: "Τηλέφωνο", type: "phone", listable: true, formable: true },
      { key: "title", label: "Θέση", type: "text", listable: true, formable: true, filterable: true },
      { key: "department", label: "Τμήμα", type: "text", listable: true, formable: true, filterable: true },
      { key: "vatNumber", label: "ΑΦΜ", type: "text", listable: true, formable: true },
      { key: "amka", label: "ΑΜΚΑ", type: "text", formable: true },
      { key: "status", label: "Κατάσταση", type: "select", listable: true, formable: true, filterable: true, options: [
        { value: "ACTIVE", label: "Ενεργός" },
        { value: "INACTIVE", label: "Ανενεργός" },
        { value: "TERMINATED", label: "Αποχώρηση" },
      ] },
      { key: "hireDate", label: "Πρόσληψη", type: "date", listable: true, formable: true },
      { key: "baseGross", label: "Μικτό βάσης", type: "money", listable: true, formable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  JOURNAL_ENTRIES: {
    entity: "JOURNAL_ENTRIES",
    label: "Ημερολόγιο",
    labelSingular: "Άρθρο",
    href: "/finance",
    builtins: [
      { key: "number", label: "Αριθμός", type: "text", listable: true, filterable: true },
      { key: "description", label: "Περιγραφή", type: "text", listable: true, formable: true, filterable: true },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, filterable: true, options: [
        { value: "DRAFT", label: "Πρόχειρο" },
        { value: "POSTED", label: "Καταχωρημένο" },
        { value: "VOID", label: "Άκυρο" },
      ] },
      { key: "entryDate", label: "Ημ/νία", type: "date", listable: true, formable: true, filterable: true },
      { key: "sourceType", label: "Πηγή", type: "text", listable: true, filterable: true },
      { key: "isOpening", label: "Ανοίγματος", type: "boolean", listable: true, formable: true },
      { key: "postedAt", label: "Καταχώρηση", type: "date", listable: true },
      { key: "createdAt", label: "Δημιουργία", type: "date", listable: true },
    ],
  },
  PAYMENT_METHODS: {
    entity: "PAYMENT_METHODS",
    label: "Τρόποι πληρωμής",
    labelSingular: "Τρόπος πληρωμής",
    href: "/settings/payment-methods",
    builtins: [
      { key: "code", label: "Κωδικός", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "name", label: "Όνομα", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "kind", label: "Είδος", type: "select", listable: true, formable: true, filterable: true, options: [
        { value: "CASH", label: "Μετρητά" },
        { value: "CARD", label: "Κάρτα" },
        { value: "TRANSFER", label: "Μεταφορά" },
        { value: "GIFT_CARD", label: "Δωροκάρτα" },
        { value: "LOYALTY", label: "Loyalty" },
        { value: "OTHER", label: "Άλλο" },
      ] },
      { key: "glAccount", label: "Λογ. λογαριασμός", type: "text", listable: true, formable: true },
      { key: "isActive", label: "Ενεργό", type: "boolean", listable: true, formable: true, filterable: true },
      { key: "showInPos", label: "POS", type: "boolean", listable: true, formable: true },
      { key: "showInCollect", label: "Εισπράξεις", type: "boolean", listable: true, formable: true },
      { key: "sortOrder", label: "Σειρά", type: "number", formable: true },
      { key: "description", label: "Περιγραφή", type: "textarea", formable: true },
    ],
  },
  DOCUMENT_SERIES: {
    entity: "DOCUMENT_SERIES",
    label: "Σειρές παραστατικών",
    labelSingular: "Σειρά",
    href: "/settings/series",
    builtins: [
      { key: "code", label: "Κωδικός", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "name", label: "Όνομα", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "kind", label: "Τύπος", type: "text", listable: true, formable: true, filterable: true },
      { key: "prefix", label: "Πρόθεμα", type: "text", listable: true, formable: true },
      { key: "nextNumber", label: "Επόμενος αρ.", type: "number", listable: true, formable: true },
      { key: "isDefault", label: "Προεπιλογή", type: "boolean", listable: true, formable: true },
      { key: "isActive", label: "Ενεργή", type: "boolean", listable: true, formable: true, filterable: true },
      { key: "myDataEnabled", label: "myDATA", type: "boolean", listable: true, formable: true },
      { key: "glDebitAccount", label: "GL χρέωση", type: "text", formable: true },
      { key: "glCreditAccount", label: "GL πίστωση", type: "text", formable: true },
      { key: "glVatAccount", label: "GL ΦΠΑ", type: "text", formable: true },
    ],
  },
  MARKETPLACE_CHANNELS: {
    entity: "MARKETPLACE_CHANNELS",
    label: "Marketplaces",
    labelSingular: "Marketplace channel",
    href: "/settings/integrations",
    builtins: [
      { key: "code", label: "Κωδικός", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "name", label: "Όνομα", type: "text", required: true, listable: true, formable: true, filterable: true },
      { key: "provider", label: "Πάροχος", type: "select", listable: true, formable: true, filterable: true, options: [
        { value: "SKROUTZ", label: "Skroutz" },
        { value: "BESTPRICE", label: "BestPrice" },
        { value: "PUBLIC", label: "Public" },
        { value: "SHOPIFY", label: "Shopify" },
        { value: "WOOCOMMERCE", label: "WooCommerce" },
        { value: "AMAZON", label: "Amazon" },
        { value: "CUSTOM", label: "Custom" },
      ] },
      { key: "status", label: "Κατάσταση", type: "badge", listable: true, formable: true, filterable: true, options: [
        { value: "DRAFT", label: "Πρόχειρο" },
        { value: "ACTIVE", label: "Ενεργό" },
        { value: "PAUSED", label: "Παύση" },
        { value: "ERROR", label: "Σφάλμα" },
      ] },
      { key: "merchantId", label: "Merchant ID", type: "text", listable: true, formable: true },
      { key: "syncCatalog", label: "Sync κατάλογος", type: "boolean", formable: true },
      { key: "syncOrders", label: "Sync παραγγελίες", type: "boolean", formable: true },
      { key: "isActive", label: "Ενεργό", type: "boolean", listable: true, formable: true, filterable: true },
      { key: "notes", label: "Σημειώσεις", type: "textarea", formable: true },
      { key: "lastSyncAt", label: "Τελευταίο sync", type: "date", listable: true },
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
