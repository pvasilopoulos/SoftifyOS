import type { EntityModule, Prisma } from "@/generated/prisma/client";
import { ENTITY_REGISTRY } from "./registry";
import type { FormViewConfig, ListViewConfig } from "./types";
import { fxId } from "./form-experience-types";
import { emptyListConfig, lxId } from "./list-experience-types";

export type { FormViewConfig, ListViewConfig };

function listColumnFor(
  key: string,
  entity: EntityModule,
  pin: "left" | "none" = "none",
) {
  const b = ENTITY_REGISTRY[entity].builtins.find((x) => x.key === key);
  if (!b) return null;
  return {
    id: lxId("col"),
    key: b.key,
    source: "system" as const,
    pin,
    align:
      b.type === "money" || b.type === "number"
        ? ("end" as const)
        : ("start" as const),
    format:
      b.type === "money"
        ? ("money" as const)
        : b.type === "date"
          ? ("date" as const)
          : b.type === "badge" || b.type === "select"
            ? ("badge" as const)
            : b.type === "boolean"
              ? ("boolean" as const)
              : ("default" as const),
    sortable: true,
    filterable: b.filterable !== false,
    truncate: true,
  };
}

function defaultListConfig(entity: EntityModule): ListViewConfig {
  const builtins = ENTITY_REGISTRY[entity].builtins.filter((b) => b.listable);
  const preferredKeys =
    entity === "CUSTOMERS"
      ? [
          "code",
          "name",
          "tradeName",
          "vatNumber",
          "taxOffice",
          "city",
          "phone",
          "email",
          "category",
          "status",
        ]
      : builtins.slice(0, 6).map((b) => b.key);
  const preferred = preferredKeys
    .map((key, i) => listColumnFor(key, entity, i === 0 ? "left" : "none"))
    .filter(Boolean) as NonNullable<ReturnType<typeof listColumnFor>>[];
  const base = emptyListConfig();
  return {
    ...base,
    mode: entity === "PRODUCTS" || entity === "GIFT_CARDS" ? "cards" : "browse",
    page: {
      ...base.page,
      density: "comfortable",
      rowClick: "navigate",
      peekFormCode: entity === "CUSTOMERS" ? "quick" : null,
      emptyTitle: `Δεν βρέθηκαν ${ENTITY_REGISTRY[entity].label.toLowerCase()}`,
      emptyCta: "navigate_new",
    },
    columns: preferred,
    sort: { id: "sort_primary", key: "createdAt", source: "system", dir: "desc" },
    pageSize: 50,
    rowActions: [
      { id: "open", label: "Άνοιγμα", type: "navigate" },
      ...(entity === "CUSTOMERS"
        ? [
            {
              id: "edit",
              label: "Επεξεργασία",
              type: "form_edit" as const,
              formCode: "default",
            },
            {
              id: "peek",
              label: "Γρήγορη προβολή",
              type: "form_peek" as const,
              formCode: "quick",
            },
          ]
        : []),
    ],
    bulkActions:
      entity === "CUSTOMERS" || entity === "PRODUCTS"
        ? [{ id: "export", label: "Εξαγωγή CSV", type: "export_csv" as const }]
        : [],
    rules:
      entity === "CUSTOMERS"
        ? [
            {
              id: lxId("rule"),
              when: {
                source: "system",
                key: "status",
                op: "eq",
                value: "INACTIVE",
              },
              then: {
                action: "row_tone",
                tone: "muted",
                badge: "Ανενεργός",
              },
            },
          ]
        : [],
  };
}

function fieldRefs(
  keys: string[],
  entity: EntityModule,
  opts?: { required?: string[]; full?: string[] },
) {
  const map = new Map(
    ENTITY_REGISTRY[entity].builtins.map((b) => [b.key, b] as const),
  );
  return keys
    .filter((k) => map.has(k))
    .map((key) => {
      const b = map.get(key)!;
      return {
        id: fxId(key),
        key,
        source: "system" as const,
        required: opts?.required?.includes(key) || b.required,
        width:
          opts?.full?.includes(key) || b.type === "textarea"
            ? ("full" as const)
            : ("half" as const),
        defaultValue:
          key === "status"
            ? "ACTIVE"
            : key === "country"
              ? "GR"
              : key === "currency"
                ? "EUR"
                : key === "locale"
                  ? "el-GR"
                  : key === "vatStatus"
                    ? "NORMAL"
                    : undefined,
      };
    });
}

function defaultFormConfig(entity: EntityModule): FormViewConfig {
  const customId = "custom";

  if (entity === "CUSTOMERS") {
    return {
      schemaVersion: 2,
      mode: "edit",
      lifecycle: "published",
      page: {
        showHeader: true,
        showSide: true,
        sideContent: "summary",
        root: [
          {
            type: "tabs",
            id: "main_tabs",
            variant: "tabs",
            tabs: [
              {
                id: "tab_identity",
                title: "Ταυτότητα",
                children: [
                  {
                    type: "section",
                    id: "sec_identity",
                    title: "Ταυτότητα",
                    children: [
                      {
                        type: "fields",
                        id: "f_identity",
                        fields: fieldRefs(
                          [
                            "code",
                            "name",
                            "tradeName",
                            "legalForm",
                            "isPerson",
                            "status",
                            "category",
                            "profession",
                          ],
                          entity,
                          { required: ["code", "name"] },
                        ),
                      },
                    ],
                  },
                ],
              },
              {
                id: "tab_fiscal",
                title: "Φορολογικά",
                children: [
                  {
                    type: "section",
                    id: "sec_fiscal",
                    title: "Φορολογικά στοιχεία",
                    children: [
                      {
                        type: "fields",
                        id: "f_fiscal",
                        fields: fieldRefs(
                          [
                            "vatNumber",
                            "taxOffice",
                            "vatStatus",
                            "gemhNumber",
                            "eoriNumber",
                            "sendEinvoice",
                          ],
                          entity,
                        ),
                      },
                    ],
                  },
                ],
              },
              {
                id: "tab_address",
                title: "Διεύθυνση",
                children: [
                  {
                    type: "section",
                    id: "sec_billing",
                    title: "Έδρα / τιμολόγησης",
                    children: [
                      {
                        type: "fields",
                        id: "f_billing",
                        fields: fieldRefs(
                          [
                            "address",
                            "address2",
                            "city",
                            "postalCode",
                            "region",
                            "country",
                          ],
                          entity,
                          { full: ["address", "address2"] },
                        ),
                      },
                    ],
                  },
                  {
                    type: "section",
                    id: "sec_shipping",
                    title: "Αποστολής",
                    children: [
                      {
                        type: "fields",
                        id: "f_shipping",
                        fields: fieldRefs(
                          [
                            "shippingAddress",
                            "shippingAddress2",
                            "shippingCity",
                            "shippingPostalCode",
                            "shippingRegion",
                            "shippingCountry",
                            "shippingMethod",
                          ],
                          entity,
                          { full: ["shippingAddress", "shippingAddress2"] },
                        ),
                      },
                    ],
                  },
                ],
              },
              {
                id: "tab_contact",
                title: "Επικοινωνία",
                children: [
                  {
                    type: "section",
                    id: "sec_contact",
                    title: "Στοιχεία επικοινωνίας",
                    children: [
                      {
                        type: "fields",
                        id: "f_contact",
                        fields: fieldRefs(
                          ["email", "phone", "mobile", "fax", "website"],
                          entity,
                        ),
                      },
                    ],
                  },
                ],
              },
              {
                id: "tab_commercial",
                title: "Εμπορικά",
                children: [
                  {
                    type: "section",
                    id: "sec_commercial",
                    title: "Όροι & πωλήσεις",
                    children: [
                      {
                        type: "fields",
                        id: "f_commercial",
                        fields: fieldRefs(
                          [
                            "salesperson",
                            "paymentTermsDays",
                            "paymentTermsLabel",
                            "creditLimit",
                            "currency",
                            "locale",
                            "discountPercent",
                            "priceListCode",
                            "isBlocked",
                          ],
                          entity,
                        ),
                      },
                    ],
                  },
                ],
              },
              {
                id: "tab_banking",
                title: "Τραπεζικά",
                children: [
                  {
                    type: "section",
                    id: "sec_banking",
                    title: "Τραπεζικός λογαριασμός",
                    children: [
                      {
                        type: "fields",
                        id: "f_banking",
                        fields: fieldRefs(
                          ["iban", "bic", "bankName", "bankAccountHolder"],
                          entity,
                          { full: ["iban", "bankAccountHolder"] },
                        ),
                      },
                    ],
                  },
                ],
              },
              {
                id: "tab_notes",
                title: "Σημειώσεις",
                children: [
                  {
                    type: "section",
                    id: "sec_notes",
                    title: "Σημειώσεις",
                    children: [
                      {
                        type: "fields",
                        id: "f_notes",
                        fields: fieldRefs(["notes"], entity, {
                          full: ["notes"],
                        }),
                      },
                    ],
                  },
                ],
              },
              {
                id: "tab_extra",
                title: "Πρόσθετα",
                children: [
                  {
                    type: "callout",
                    id: fxId("call"),
                    tone: "info",
                    text: "Πρόσθεσε custom πεδία από τις Ρυθμίσεις · Πεδία & Προβολές.",
                  },
                  {
                    type: "section",
                    id: customId,
                    title: "Πρόσθετα πεδία",
                    children: [
                      { type: "fields", id: `${customId}_fields`, fields: [] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      rules: [],
    };
  }

  const formable = ENTITY_REGISTRY[entity].builtins.filter((b) => b.formable);
  const mainId = "main";
  return {
    schemaVersion: 2,
    mode: "edit",
    lifecycle: "published",
    page: {
      showHeader: true,
      showSide: false,
      sideContent: "none",
      root: [
        {
          type: "tabs",
          id: "main_tabs",
          variant: "tabs",
          tabs: [
            {
              id: "tab_basic",
              title: "Βασικά",
              children: [
                {
                  type: "section",
                  id: mainId,
                  title: "Βασικά στοιχεία",
                  children: [
                    {
                      type: "fields",
                      id: `${mainId}_fields`,
                      fields: formable.map((b, i) => ({
                        id: `${mainId}_${b.key}_${i}`,
                        key: b.key,
                        source: "system" as const,
                        required: b.required,
                        width:
                          b.type === "textarea"
                            ? ("full" as const)
                            : ("half" as const),
                      })),
                    },
                  ],
                },
              ],
            },
            {
              id: "tab_extra",
              title: "Πρόσθετα",
              children: [
                {
                  type: "callout",
                  id: fxId("call"),
                  tone: "info",
                  text: "Πρόσθεσε custom πεδία από τις Ρυθμίσεις · Πεδία & Προβολές.",
                },
                {
                  type: "section",
                  id: customId,
                  title: "Πρόσθετα πεδία",
                  children: [
                    { type: "fields", id: `${customId}_fields`, fields: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    rules: [],
  };
}

function extraListViews(entity: EntityModule): Array<{
  code: string;
  name: string;
  description?: string;
  config: ListViewConfig;
}> {
  if (entity === "CUSTOMERS") {
    return [
      {
        code: "active",
        name: "Ενεργοί πελάτες",
        description: "Μόνο ACTIVE",
        config: {
          ...defaultListConfig(entity),
          filters: [
            { key: "status", source: "system", op: "eq", value: "ACTIVE" },
          ],
        },
      },
      {
        code: "kanban_status",
        name: "Kanban · Κατάσταση",
        description: "Ομαδοποίηση ACTIVE / INACTIVE",
        config: {
          ...defaultListConfig(entity),
          mode: "kanban",
          page: {
            ...defaultListConfig(entity).page,
            groupByKey: "status",
            groupBySource: "system",
            rowClick: "peek",
            peekFormCode: "default",
            editFormCode: "default",
            density: "comfortable",
          },
          rowActions: [
            { id: "edit", label: "Επεξεργασία", type: "form_edit", formCode: "default" },
            { id: "open", label: "Άνοιγμα", type: "navigate" },
          ],
        },
      },
      {
        code: "peek_edit",
        name: "Λίστα + Peek edit",
        description: "Κλικ ανοίγει side panel επεξεργασίας",
        config: {
          ...defaultListConfig(entity),
          mode: "peek",
          page: {
            ...defaultListConfig(entity).page,
            rowClick: "peek",
            peekFormCode: "default",
            editFormCode: "default",
          },
          rowActions: [
            { id: "edit", label: "Επεξεργασία", type: "form_edit" },
            { id: "open", label: "Καρτέλα", type: "navigate" },
          ],
        },
      },
      {
        code: "map",
        name: "Χάρτης πελατών",
        description: "Διευθύνσεις σε χάρτη με clustering · κοντά μου",
        config: {
          ...defaultListConfig(entity),
          mode: "map",
          page: {
            ...defaultListConfig(entity).page,
            density: "comfortable",
            rowClick: "navigate",
          },
        },
      },
    ];
  }
  if (entity === "INVOICES") {
    return [
      {
        code: "open",
        name: "Ανοιχτά",
        description: "Draft / Issued / Partial / Overdue",
        config: {
          ...defaultListConfig(entity),
          filters: [],
        },
      },
    ];
  }
  if (entity === "PRODUCTS") {
    return [
      {
        code: "active",
        name: "Ενεργά προϊόντα",
        config: {
          ...defaultListConfig(entity),
          filters: [
            { key: "status", source: "system", op: "eq", value: "ACTIVE" },
          ],
        },
      },
    ];
  }
  return [];
}

function extraFormViews(entity: EntityModule): Array<{
  code: string;
  name: string;
  description?: string;
  config: FormViewConfig;
}> {
  if (entity === "CUSTOMERS") {
    return [
      {
        code: "quick",
        name: "Γρήγορη καταχώριση",
        description: "Drawer / modal — βασικά ERP πεδία",
        config: {
          schemaVersion: 2,
          mode: "quick",
          lifecycle: "published",
          page: {
            showHeader: false,
            showSide: false,
            root: [
              {
                type: "section",
                id: "quick",
                title: "Γρήγορα",
                children: [
                  {
                    type: "fields",
                    id: "quick_fields",
                    fields: fieldRefs(
                      [
                        "code",
                        "name",
                        "vatNumber",
                        "taxOffice",
                        "phone",
                        "email",
                        "city",
                        "category",
                      ],
                      entity,
                      { required: ["code", "name"], full: ["code", "name"] },
                    ),
                  },
                ],
              },
            ],
          },
          rules: [],
        },
      },
      {
        code: "wizard",
        name: "Οδηγός καταχώρισης",
        description: "Wizard · ταυτότητα → φορολογικά → διεύθυνση → εμπορικά",
        config: {
          schemaVersion: 2,
          mode: "wizard",
          lifecycle: "published",
          page: {
            showHeader: true,
            showSide: false,
            root: [
              {
                type: "tabs",
                id: "wiz",
                variant: "wizard",
                tabs: [
                  {
                    id: "w1",
                    title: "Ταυτότητα",
                    children: [
                      {
                        type: "fields",
                        id: "w1_f",
                        fields: fieldRefs(
                          ["code", "name", "tradeName", "legalForm", "category"],
                          entity,
                          { required: ["code", "name"], full: ["code", "name"] },
                        ),
                      },
                    ],
                  },
                  {
                    id: "w2",
                    title: "Φορολογικά",
                    children: [
                      {
                        type: "fields",
                        id: "w2_f",
                        fields: fieldRefs(
                          ["vatNumber", "taxOffice", "vatStatus", "gemhNumber"],
                          entity,
                        ),
                      },
                    ],
                  },
                  {
                    id: "w3",
                    title: "Διεύθυνση",
                    children: [
                      {
                        type: "fields",
                        id: "w3_f",
                        fields: fieldRefs(
                          [
                            "address",
                            "city",
                            "postalCode",
                            "region",
                            "country",
                            "email",
                            "phone",
                            "mobile",
                          ],
                          entity,
                          { full: ["address"] },
                        ),
                      },
                    ],
                  },
                  {
                    id: "w4",
                    title: "Εμπορικά",
                    children: [
                      {
                        type: "fields",
                        id: "w4_f",
                        fields: fieldRefs(
                          [
                            "salesperson",
                            "paymentTermsDays",
                            "creditLimit",
                            "currency",
                            "status",
                            "notes",
                          ],
                          entity,
                          { full: ["notes"], required: ["status"] },
                        ),
                      },
                    ],
                  },
                ],
              },
            ],
          },
          rules: [],
        },
      },
    ];
  }
  return [];
}

export function defaultViewsSeed(entity: EntityModule) {
  const meta = ENTITY_REGISTRY[entity];
  return {
    list: [
      {
        code: "default",
        name: `Προεπιλογή · ${meta.label}`,
        description: "Βασική λίστα",
        isDefault: true,
        isSystem: true,
        config: defaultListConfig(entity) as unknown as Prisma.InputJsonValue,
      },
      ...extraListViews(entity).map((v) => ({
        code: v.code,
        name: v.name,
        description: v.description ?? null,
        isDefault: false,
        isSystem: true,
        config: v.config as unknown as Prisma.InputJsonValue,
      })),
    ],
    form: [
      {
        code: "default",
        name: `Πλήρης φόρμα · ${meta.labelSingular}`,
        description: "Form Experience · tabs + sections",
        isDefault: true,
        isSystem: true,
        config: defaultFormConfig(entity) as unknown as Prisma.InputJsonValue,
      },
      ...extraFormViews(entity).map((v) => ({
        code: v.code,
        name: v.name,
        description: v.description ?? null,
        isDefault: false,
        isSystem: true,
        config: v.config as unknown as Prisma.InputJsonValue,
      })),
    ],
  };
}
