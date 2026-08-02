import type { GlAccountType } from "@/generated/prisma/client";

export type DefaultGlAccount = {
  code: string;
  name: string;
  type: GlAccountType;
  isPostable?: boolean;
  reportGroup?: string;
};

export const DEFAULT_GL_ACCOUNTS: DefaultGlAccount[] = [
  { code: "10", name: "Πάγια", type: "ASSET", isPostable: false, reportGroup: "BS_ASSET" },
  { code: "10.00.00", name: "Έπιπλα & λοιπός εξοπλισμός", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "10.00.01", name: "Συσσωρευμένες αποσβέσεις παγίων", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "14.00.00", name: "Μεταφορικά μέσα", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "16.00.00", name: "Άυλα πάγια / λογισμικό", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "20", name: "Αποθέματα", type: "ASSET", isPostable: false, reportGroup: "BS_ASSET" },
  { code: "20.00.00", name: "Εμπορεύματα", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "20.01.00", name: "Πρώτες & βοηθητικές ύλες", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "30", name: "Πελάτες", type: "ASSET", isPostable: false, reportGroup: "BS_ASSET" },
  { code: "30.00.00", name: "Πελάτες εσωτερικού", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "30.00.01", name: "Πελάτες εξωτερικού", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "33", name: "Χρεώστες διάφοροι", type: "ASSET", isPostable: false, reportGroup: "BS_ASSET" },
  { code: "33.00.00", name: "Προκαταβολές προμηθευτών", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "33.90.00", name: "Εκκρεμείς εισπράξεις καρτών", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "33.90.01", name: "Εκκαθάριση POS / καρτών", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "36.00.00", name: "Γραμμάτια εισπρακτέα", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "38", name: "Χρηματικά διαθέσιμα", type: "ASSET", isPostable: false, reportGroup: "BS_ASSET" },
  { code: "38.00.00", name: "Ταμείο", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "38.03.00", name: "Καταθέσεις όψεως", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "38.03.01", name: "Καταθέσεις προθεσμίας", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "38.90.00", name: "Εκκαθάριση καρτών (τραπεζική)", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "40", name: "Ίδια κεφάλαια", type: "EQUITY", isPostable: false, reportGroup: "BS_EQUITY" },
  { code: "40.00.00", name: "Κεφάλαιο", type: "EQUITY", reportGroup: "BS_EQUITY" },
  { code: "42.00.00", name: "Αποθεματικά", type: "EQUITY", reportGroup: "BS_EQUITY" },
  { code: "50", name: "Προμηθευτές", type: "LIABILITY", isPostable: false, reportGroup: "BS_LIABILITY" },
  { code: "50.00.00", name: "Προμηθευτές εσωτερικού", type: "LIABILITY", reportGroup: "BS_LIABILITY" },
  { code: "50.00.01", name: "Προμηθευτές εξωτερικού", type: "LIABILITY", reportGroup: "BS_LIABILITY" },
  { code: "53.00.00", name: "Γραμμάτια πληρωτέα", type: "LIABILITY", reportGroup: "BS_LIABILITY" },
  { code: "54", name: "Φόροι-τέλη", type: "LIABILITY", isPostable: false, reportGroup: "BS_LIABILITY" },
  { code: "54.00.00", name: "ΦΠΑ εξερχόμενων", type: "LIABILITY", reportGroup: "BS_LIABILITY" },
  { code: "54.00.01", name: "ΦΠΑ εισερχόμενων", type: "ASSET", reportGroup: "BS_ASSET" },
  { code: "54.03.00", name: "Φόρος εισοδήματος πληρωτέος", type: "LIABILITY", reportGroup: "BS_LIABILITY" },
  { code: "55.00.00", name: "Ασφαλιστικοί οργανισμοί (ΕΦΚΑ)", type: "LIABILITY", reportGroup: "BS_LIABILITY" },
  { code: "56", name: "Προκαταβολές / δωροκάρτες", type: "LIABILITY", isPostable: false, reportGroup: "BS_LIABILITY" },
  { code: "56.00.00", name: "Υποχρεώσεις δωροκαρτών", type: "LIABILITY", reportGroup: "BS_LIABILITY" },
  { code: "56.01.00", name: "Προκαταβολές πελατών", type: "LIABILITY", reportGroup: "BS_LIABILITY" },
  { code: "60.00.00", name: "Αμοιβές & έξοδα προσωπικού", type: "EXPENSE", reportGroup: "PL_EXPENSE" },
  { code: "64", name: "Έξοδα", type: "EXPENSE", isPostable: false, reportGroup: "PL_EXPENSE" },
  { code: "64.00.00", name: "Γενικά έξοδα", type: "EXPENSE", reportGroup: "PL_EXPENSE" },
  { code: "64.01.00", name: "Κόστος πωληθέντων", type: "EXPENSE", reportGroup: "PL_COGS" },
  { code: "64.02.00", name: "Έξοδα διάθεσης / μεταφορικά", type: "EXPENSE", reportGroup: "PL_EXPENSE" },
  { code: "65.00.00", name: "Τόκοι & συναφή έξοδα", type: "EXPENSE", reportGroup: "PL_EXPENSE" },
  { code: "66.00.00", name: "Αποσβέσεις παγίων", type: "EXPENSE", reportGroup: "PL_EXPENSE" },
  { code: "70", name: "Πωλήσεις", type: "REVENUE", isPostable: false, reportGroup: "PL_REVENUE" },
  { code: "70.00.00", name: "Πωλήσεις εμπορευμάτων", type: "REVENUE", reportGroup: "PL_REVENUE" },
  { code: "70.01.00", name: "Πωλήσεις λιανικής", type: "REVENUE", reportGroup: "PL_REVENUE" },
  { code: "70.02.00", name: "Παροχή υπηρεσιών", type: "REVENUE", reportGroup: "PL_REVENUE" },
  { code: "76.00.00", name: "Έσοδα παρεπόμενων ασχολιών", type: "REVENUE", reportGroup: "PL_REVENUE" },
  { code: "80", name: "Αποτελέσματα", type: "EQUITY", isPostable: false, reportGroup: "BS_EQUITY" },
  { code: "80.00.00", name: "Αποτελέσματα χρήσης", type: "EQUITY", reportGroup: "BS_EQUITY" },
  { code: "89.00.00", name: "Υπόλοιπα έναρξης", type: "EQUITY", reportGroup: "BS_EQUITY" },
];

export const GL_ACCOUNT_TYPE_LABEL: Record<GlAccountType, string> = {
  ASSET: "Ενεργητικό",
  LIABILITY: "Παθητικό",
  EQUITY: "Καθαρή θέση",
  REVENUE: "Έσοδα",
  EXPENSE: "Έξοδα",
};

export const REPORT_GROUP_LABEL: Record<string, string> = {
  BS_ASSET: "Ισολογισμός · Ενεργητικό",
  BS_LIABILITY: "Ισολογισμός · Παθητικό",
  BS_EQUITY: "Ισολογισμός · Καθαρή θέση",
  PL_REVENUE: "Αποτελέσματα · Έσοδα",
  PL_EXPENSE: "Αποτελέσματα · Έξοδα",
  PL_COGS: "Αποτελέσματα · Κόστος πωληθέντων",
};
