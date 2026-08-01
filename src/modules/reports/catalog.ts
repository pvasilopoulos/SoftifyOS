export type ReportCategory =
  | "sales"
  | "finance"
  | "inventory"
  | "operations"
  | "hr";

export type ChartKind =
  | "line"
  | "area"
  | "bar"
  | "donut"
  | "radialBar"
  | "heatmap";

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  category: ReportCategory;
  chartType: ChartKind;
  /** Default period hint for UI */
  defaultPeriod?: "mtd" | "qtd" | "ytd" | "12m";
};

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  sales: "Πωλήσεις",
  finance: "Οικονομικά",
  inventory: "Αποθήκη",
  operations: "Λειτουργίες",
  hr: "HR",
};

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    id: "sales-trend",
    title: "Τάση πωλήσεων",
    description: "Καθαρές πωλήσεις ανά μήνα (12 μήνες) με ΦΠΑ.",
    category: "sales",
    chartType: "area",
    defaultPeriod: "12m",
  },
  {
    id: "sales-by-customer",
    title: "Top πελάτες",
    description: "Κατάταξη πελατών βάσει κύκλου εργασιών περιόδου.",
    category: "sales",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-by-product",
    title: "Top είδη",
    description: "Πωλήσεις ανά είδος από γραμμές τιμολογίων.",
    category: "sales",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "ar-aging",
    title: "Aging απαιτήσεων (AR)",
    description: "Ανοιχτά υπόλοιπα πελατών ανά ηλικιακό bucket.",
    category: "finance",
    chartType: "donut",
  },
  {
    id: "vat-breakdown",
    title: "Ανάλυση ΦΠΑ",
    description: "ΦΠΑ πωλήσεων ανά συντελεστή για την περίοδο.",
    category: "finance",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "cash-collections",
    title: "Εισπράξεις",
    description: "Ταμειακές εισπράξεις τιμολογίων ανά μήνα.",
    category: "finance",
    chartType: "line",
    defaultPeriod: "12m",
  },
  {
    id: "stock-by-site",
    title: "Απόθεμα ανά εγκατάσταση",
    description: "Ποσότητες on-hand ανά site.",
    category: "inventory",
    chartType: "bar",
  },
  {
    id: "low-stock",
    title: "Χαμηλό απόθεμα",
    description: "Είδη με qty ≤ 5 για αναπαραγγελία.",
    category: "inventory",
    chartType: "bar",
  },
  {
    id: "orders-pipeline",
    title: "Pipeline παραγγελιών",
    description: "Κατανομή ανοιχτών παραγγελιών ανά κατάσταση.",
    category: "operations",
    chartType: "donut",
  },
  {
    id: "delivery-volume",
    title: "Δελτία αποστολής",
    description: "Όγκος δελτίων ανά μήνα.",
    category: "operations",
    chartType: "area",
    defaultPeriod: "12m",
  },
  {
    id: "hr-headcount",
    title: "Προσωπικό & άδειες",
    description: "Ενεργοί εργαζόμενοι, κάρτες εργασίας και άδειες σε αναμονή.",
    category: "hr",
    chartType: "radialBar",
  },
];

export function getReportDefinition(id: string) {
  return REPORT_CATALOG.find((r) => r.id === id) ?? null;
}
