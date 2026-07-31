import type { EntityModule, Prisma } from "@/generated/prisma/client";
import { ENTITY_REGISTRY } from "./registry";
import type { FormViewConfig, ListViewConfig } from "./types";

export type { FormViewConfig, ListViewConfig };

function defaultListConfig(entity: EntityModule): ListViewConfig {
  const builtins = ENTITY_REGISTRY[entity].builtins.filter((b) => b.listable);
  const preferred = builtins.slice(0, 6);
  return {
    columns: preferred.map((b) => ({ key: b.key, source: "system" as const })),
    filters: [],
    sort: { key: "createdAt", source: "system", dir: "desc" },
    pageSize: 50,
  };
}

function defaultFormConfig(entity: EntityModule): FormViewConfig {
  const formable = ENTITY_REGISTRY[entity].builtins.filter((b) => b.formable);
  return {
    sections: [
      {
        id: "main",
        title: "Βασικά στοιχεία",
        fields: formable.map((b) => ({
          key: b.key,
          source: "system" as const,
          required: b.required,
        })),
      },
      {
        id: "custom",
        title: "Πρόσθετα πεδία",
        fields: [],
      },
    ],
  };
}

/** Extra starter list views per entity */
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
        description: "Ελάχιστα υποχρεωτικά πεδία",
        config: {
          sections: [
            {
              id: "quick",
              title: "Γρήγορα",
              fields: quick.map((b) => ({
                key: b.key,
                source: "system",
                required: b.key === "code" || b.key === "name",
              })),
            },
          ],
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
        description: "Όλα τα βασικά πεδία",
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
