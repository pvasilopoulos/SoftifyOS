import type { UnitOfMeasureKind } from "@/generated/prisma/client";

export const unitOfMeasureKindLabel: Record<UnitOfMeasureKind, string> = {
  COUNT: "Τεμάχια / συσκευασίες",
  WEIGHT: "Βάρος",
  VOLUME: "Όγκος",
  LENGTH: "Μήκος",
  AREA: "Εμβαδόν",
  TIME: "Χρόνος",
  OTHER: "Άλλο",
};

export type DefaultUnitSeed = {
  code: string;
  name: string;
  symbol: string;
  kind: UnitOfMeasureKind;
  decimals: number;
  description: string | null;
  sortOrder: number;
  isDefault: boolean;
};

export const DEFAULT_UNITS_OF_MEASURE: DefaultUnitSeed[] = [
  {
    code: "PCS",
    name: "Τεμάχια",
    symbol: "τεμ",
    kind: "COUNT",
    decimals: 0,
    description: "Βασική μονάδα τεμαχίων",
    sortOrder: 10,
    isDefault: true,
  },
  {
    code: "BOX",
    name: "Κουτί",
    symbol: "κουτί",
    kind: "COUNT",
    decimals: 0,
    description: null,
    sortOrder: 20,
    isDefault: false,
  },
  {
    code: "PKG",
    name: "Συσκευασία",
    symbol: "συσκ",
    kind: "COUNT",
    decimals: 0,
    description: null,
    sortOrder: 30,
    isDefault: false,
  },
  {
    code: "PAL",
    name: "Παλέτα",
    symbol: "παλ",
    kind: "COUNT",
    decimals: 0,
    description: null,
    sortOrder: 40,
    isDefault: false,
  },
  {
    code: "KG",
    name: "Χιλιόγραμμα",
    symbol: "kg",
    kind: "WEIGHT",
    decimals: 3,
    description: null,
    sortOrder: 50,
    isDefault: false,
  },
  {
    code: "G",
    name: "Γραμμάρια",
    symbol: "g",
    kind: "WEIGHT",
    decimals: 0,
    description: null,
    sortOrder: 60,
    isDefault: false,
  },
  {
    code: "LT",
    name: "Λίτρα",
    symbol: "lt",
    kind: "VOLUME",
    decimals: 3,
    description: null,
    sortOrder: 70,
    isDefault: false,
  },
  {
    code: "ML",
    name: "Χιλιοστόλιτρα",
    symbol: "ml",
    kind: "VOLUME",
    decimals: 0,
    description: null,
    sortOrder: 80,
    isDefault: false,
  },
  {
    code: "M",
    name: "Μέτρα",
    symbol: "m",
    kind: "LENGTH",
    decimals: 2,
    description: null,
    sortOrder: 90,
    isDefault: false,
  },
  {
    code: "CM",
    name: "Εκατοστά",
    symbol: "cm",
    kind: "LENGTH",
    decimals: 0,
    description: null,
    sortOrder: 100,
    isDefault: false,
  },
  {
    code: "M2",
    name: "Τετραγωνικά μέτρα",
    symbol: "m²",
    kind: "AREA",
    decimals: 2,
    description: null,
    sortOrder: 110,
    isDefault: false,
  },
  {
    code: "HR",
    name: "Ώρες",
    symbol: "ώρα",
    kind: "TIME",
    decimals: 2,
    description: null,
    sortOrder: 120,
    isDefault: false,
  },
];
