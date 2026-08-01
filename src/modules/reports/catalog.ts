export type ReportCategory =
  | "sales"
  | "sales_advanced"
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
  sales_advanced: "Advanced Πωλήσεις",
  finance: "Οικονομικά",
  inventory: "Αποθήκη",
  operations: "Λειτουργίες",
  hr: "HR",
};

export const REPORT_CATALOG: ReportDefinition[] = [
  // ── Core sales ──────────────────────────────────────────────
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
    id: "sales-by-site",
    title: "Πωλήσεις ανά εγκατάσταση",
    description: "Κύκλος εργασιών ανά site / υποκατάστημα.",
    category: "sales",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-by-kind",
    title: "Μείγμα παραστατικών",
    description: "Τιμολόγια / πιστωτικά / ΑΠΥ — αξία και πλήθος.",
    category: "sales",
    chartType: "donut",
    defaultPeriod: "ytd",
  },

  // ── Advanced sales (enterprise) ─────────────────────────────
  {
    id: "sales-yoy",
    title: "YoY · Σύγκριση ετών",
    description:
      "Μηνιαίες πωλήσεις τρέχοντος έτους έναντι προηγούμενου (same-month).",
    category: "sales_advanced",
    chartType: "line",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-period-compare",
    title: "Σύγκριση περιόδων",
    description:
      "Τρέχουσα περίοδος vs ισοδύναμη προηγούμενη (MTD/QTD/YTD/12M).",
    category: "sales_advanced",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-ttm",
    title: "TTM · Rolling 12 μήνες",
    description: "Κυλιόμενο άθροισμα 12 μηνών — τάση χωρίς εποχικότητα μήνα.",
    category: "sales_advanced",
    chartType: "area",
    defaultPeriod: "12m",
  },
  {
    id: "sales-quarterly",
    title: "Τριμηνιαία απόδοση",
    description: "Πωλήσεις ανά τρίμηνο για τα τελευταία 3 έτη.",
    category: "sales_advanced",
    chartType: "bar",
  },
  {
    id: "sales-pareto",
    title: "Pareto πελατών (80/20)",
    description: "Συγκέντρωση εσόδων — πόσοι πελάτες φέρνουν το 80%.",
    category: "sales_advanced",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-aov",
    title: "AOV · Μέση αξία παραστατικού",
    description: "Average invoice value και πλήθος παραστατικών ανά μήνα.",
    category: "sales_advanced",
    chartType: "line",
    defaultPeriod: "12m",
  },
  {
    id: "sales-new-vs-returning",
    title: "Νέοι vs υπάρχοντες πελάτες",
    description: "Έσοδα από πρώτη αγορά vs επαναλαμβανόμενους πελάτες.",
    category: "sales_advanced",
    chartType: "area",
    defaultPeriod: "12m",
  },
  {
    id: "sales-customer-growth",
    title: "Ανάπτυξη / πτώση πελατών",
    description: "Top growers και decliners vs προηγούμενη ισοδύναμη περίοδο.",
    category: "sales_advanced",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-credit-ratio",
    title: "Credit note ratio",
    description: "Πιστωτικά ως % επί των πωλήσεων — δείκτης επιστροφών.",
    category: "sales_advanced",
    chartType: "line",
    defaultPeriod: "12m",
  },
  {
    id: "sales-weekday",
    title: "Εποχικότητα ανά ημέρα",
    description: "Κατανομή πωλήσεων ανά ημέρα εβδομάδας.",
    category: "sales_advanced",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-collection-efficiency",
    title: "Ταχύτητα είσπραξης (DSO proxy)",
    description: "Ημέρες από έκδοση έως είσπραξη — μέσος όρος ανά μήνα.",
    category: "sales_advanced",
    chartType: "line",
    defaultPeriod: "12m",
  },
  {
    id: "sales-quote-conversion",
    title: "Conversion προσφορών",
    description: "Προσφορές → παραγγελίες · win rate και αξία.",
    category: "sales_advanced",
    chartType: "donut",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-product-velocity",
    title: "Ταχύτητα ειδών",
    description: "Είδη με υψηλότερο ρυθμό πώλησης (qty × συχνότητα).",
    category: "sales_advanced",
    chartType: "bar",
    defaultPeriod: "ytd",
  },
  {
    id: "sales-repeat-rate",
    title: "Repeat purchase rate",
    description: "Ποσοστό πελατών με ≥2 αγορές στην περίοδο.",
    category: "sales_advanced",
    chartType: "radialBar",
    defaultPeriod: "ytd",
  },

  // ── Finance / ops / inventory / hr ──────────────────────────
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
