import type { EntityModule, Prisma } from "@/generated/prisma/client";
import { ENTITY_REGISTRY } from "./registry";
import type { FormViewConfig, ListViewConfig } from "./types";
import { fxId } from "./form-experience-types";
import { emptyListConfig, lxId } from "./list-experience-types";

export type { FormViewConfig, ListViewConfig };

function defaultListConfig(entity: EntityModule): ListViewConfig {
  const builtins = ENTITY_REGISTRY[entity].builtins.filter((b) => b.listable);
  const preferred = builtins.slice(0, 6);
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
    columns: preferred.map((b, i) => ({
      id: lxId("col"),
      key: b.key,
      source: "system" as const,
      pin: i === 0 ? ("left" as const) : ("none" as const),
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
    })),
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

function defaultFormConfig(entity: EntityModule): FormViewConfig {
  const formable = ENTITY_REGISTRY[entity].builtins.filter((b) => b.formable);
  const mainId = "main";
  const customId = "custom";
  return {
    schemaVersion: 2,
    mode: "edit",
    lifecycle: "published",
    page: {
      showHeader: true,
      showSide: entity === "CUSTOMERS",
      sideContent: entity === "CUSTOMERS" ? "summary" : "none",
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
    const quick = ENTITY_REGISTRY.CUSTOMERS.builtins.filter((b) =>
      ["code", "name", "vatNumber", "phone"].includes(b.key),
    );
    return [
      {
        code: "quick",
        name: "Γρήγορη καταχώριση",
        description: "Drawer / modal — ελάχιστα πεδία",
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
                    fields: quick.map((b, i) => ({
                      id: `quick_${b.key}_${i}`,
                      key: b.key,
                      source: "system" as const,
                      required: b.key === "code" || b.key === "name",
                      width: "full" as const,
                    })),
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
        description: "Wizard βήματα",
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
                        fields: ["code", "name", "vatNumber"].map((key, i) => ({
                          id: `w1_${key}`,
                          key,
                          source: "system" as const,
                          required: key !== "vatNumber",
                          width: "full" as const,
                        })),
                      },
                    ],
                  },
                  {
                    id: "w2",
                    title: "Επικοινωνία",
                    children: [
                      {
                        type: "fields",
                        id: "w2_f",
                        fields: ["email", "phone", "notes"].map((key) => ({
                          id: `w2_${key}`,
                          key,
                          source: "system" as const,
                          width: key === "notes" ? ("full" as const) : ("half" as const),
                        })),
                      },
                    ],
                  },
                  {
                    id: "w3",
                    title: "Κατάσταση",
                    children: [
                      {
                        type: "callout",
                        id: "w3_c",
                        tone: "info",
                        text: "Επίλεξε αν ο πελάτης είναι ενεργός.",
                      },
                      {
                        type: "fields",
                        id: "w3_f",
                        fields: [
                          {
                            id: "w3_status",
                            key: "status",
                            source: "system",
                            required: true,
                            width: "half",
                            defaultValue: "ACTIVE",
                          },
                        ],
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
