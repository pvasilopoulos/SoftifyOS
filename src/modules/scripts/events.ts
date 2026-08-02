import type { EntityModule } from "@/generated/prisma/client";

export type ScriptEventDef = {
  key: string;
  label: string;
  description: string;
  /** SERVER scripts run here by default */
  phase: "before" | "after" | "ui";
  sampleContext: Record<string, unknown>;
};

const CRUD_EVENTS: ScriptEventDef[] = [
  {
    key: "before.create",
    label: "Πριν τη δημιουργία",
    description: "Μπορεί να αλλάξει το record ή να απορρίψει με api.fail().",
    phase: "before",
    sampleContext: { record: { code: "C-001", name: "Παράδειγμα" } },
  },
  {
    key: "after.create",
    label: "Μετά τη δημιουργία",
    description: "Ιδανικό για webhooks / marketplace sync.",
    phase: "after",
    sampleContext: { record: { id: "clx…", code: "C-001", name: "Παράδειγμα" } },
  },
  {
    key: "before.update",
    label: "Πριν την ενημέρωση",
    description: "Πρόσβαση σε previous + record (draft).",
    phase: "before",
    sampleContext: {
      previous: { status: "ACTIVE" },
      record: { status: "INACTIVE", name: "Παράδειγμα" },
    },
  },
  {
    key: "after.update",
    label: "Μετά την ενημέρωση",
    description: "Webhook μετά από επιτυχημένο save.",
    phase: "after",
    sampleContext: {
      previous: { status: "ACTIVE" },
      record: { id: "clx…", status: "INACTIVE" },
    },
  },
  {
    key: "before.delete",
    label: "Πριν τη διαγραφή",
    description: "Μπορεί να μπλοκάρει τη διαγραφή.",
    phase: "before",
    sampleContext: { record: { id: "clx…", code: "C-001" } },
  },
  {
    key: "after.delete",
    label: "Μετά τη διαγραφή",
    description: "Cleanup / notify τρίτα συστήματα.",
    phase: "after",
    sampleContext: { record: { id: "clx…", code: "C-001" } },
  },
];

const FORM_EVENTS: ScriptEventDef[] = [
  {
    key: "form.onLoad",
    label: "Φόρμα · φόρτωση",
    description: "UI: defaults / hide fields κατά το άνοιγμα.",
    phase: "ui",
    sampleContext: { mode: "edit", record: { code: "" } },
  },
  {
    key: "form.onFieldChange",
    label: "Φόρμα · αλλαγή πεδίου",
    description: "UI: αντιδράσεις σε αλλαγή πεδίου.",
    phase: "ui",
    sampleContext: { field: "status", value: "INACTIVE", record: {} },
  },
  {
    key: "form.beforeSubmit",
    label: "Φόρμα · πριν την υποβολή",
    description: "UI validation πριν το API call.",
    phase: "ui",
    sampleContext: { record: { code: "C-001" } },
  },
];

const LIST_EVENTS: ScriptEventDef[] = [
  {
    key: "list.onRowClick",
    label: "Λίστα · κλικ γραμμής",
    description: "UI hook πριν το navigate/peek.",
    phase: "ui",
    sampleContext: { row: { id: "clx…", code: "C-001" } },
  },
  {
    key: "list.onKanbanMove",
    label: "Λίστα · kanban move",
    description: "Πριν/μαζί με αλλαγή status στο kanban.",
    phase: "before",
    sampleContext: { row: { id: "clx…" }, from: "ACTIVE", to: "INACTIVE" },
  },
];

const STANDARD_EVENTS = [...CRUD_EVENTS, ...FORM_EVENTS, ...LIST_EVENTS];

export const SCRIPT_EVENTS_BY_MODULE: Record<EntityModule, ScriptEventDef[]> = {
  CUSTOMERS: STANDARD_EVENTS,
  PRODUCTS: STANDARD_EVENTS,
  INVOICES: [
    ...STANDARD_EVENTS,
    {
      key: "invoice.beforeIssue",
      label: "Τιμολόγιο · πριν την έκδοση",
      description: "Έλεγχοι πριν το issue.",
      phase: "before",
      sampleContext: { record: { id: "…", number: "ΤΔΑ-1", total: 100 } },
    },
    {
      key: "invoice.afterIssue",
      label: "Τιμολόγιο · μετά την έκδοση",
      description: "Marketplace / myDATA side effects.",
      phase: "after",
      sampleContext: { record: { id: "…", number: "ΤΔΑ-1", total: 100 } },
    },
  ],
  ORDERS: STANDARD_EVENTS,
  QUOTES: STANDARD_EVENTS,
  GIFT_CARDS: STANDARD_EVENTS,
  SUPPLIERS: STANDARD_EVENTS,
  PURCHASE_ORDERS: STANDARD_EVENTS,
  DELIVERY_NOTES: STANDARD_EVENTS,
  CRM_LEADS: STANDARD_EVENTS,
  EMPLOYEES: STANDARD_EVENTS,
  LOYALTY: STANDARD_EVENTS,
  SITES: STANDARD_EVENTS,
  JOURNAL_ENTRIES: STANDARD_EVENTS,
  MARKETPLACE_CHANNELS: STANDARD_EVENTS,
  PAYMENT_METHODS: STANDARD_EVENTS,
  DOCUMENT_SERIES: STANDARD_EVENTS,
};

export function eventsForModule(module: EntityModule): ScriptEventDef[] {
  return SCRIPT_EVENTS_BY_MODULE[module] ?? CRUD_EVENTS;
}

export function isKnownEvent(module: EntityModule, eventKey: string): boolean {
  return eventsForModule(module).some((e) => e.key === eventKey);
}

export const SCRIPT_TEMPLATE = `// SoftifyOS Script Hook
// Διαθέσιμο: ctx (record, previous, …), api (set/fail/log/http/secrets)

async function run(ctx, api) {
  // Παράδειγμα: υποχρεωτικό ΑΦΜ
  // if (!ctx.record.vatNumber) {
  //   api.fail("Το ΑΦΜ είναι υποχρεωτικό");
  // }

  // Παράδειγμα: webhook σε marketplace (host στην allow-list)
  // await api.http.post("https://api.marketplace.example/v1/customers", {
  //   externalId: ctx.record.id,
  //   name: ctx.record.name,
  // }, {
  //   headers: {
  //     Authorization: "Bearer " + (await api.secrets.get("MARKETPLACE_TOKEN")),
  //   },
  // });

  api.log("script ok", ctx.record?.code ?? ctx.record?.id);
}
`;
