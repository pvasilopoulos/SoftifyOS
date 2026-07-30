import type { GlAccountType } from "@/generated/prisma/client";

export const DEFAULT_GL_ACCOUNTS: Array<{
  code: string;
  name: string;
  type: GlAccountType;
  isPostable?: boolean;
}> = [
  { code: "10", name: "Πάγια", type: "ASSET", isPostable: false },
  { code: "20", name: "Αποθέματα", type: "ASSET", isPostable: false },
  { code: "30", name: "Πελάτες", type: "ASSET", isPostable: false },
  { code: "30.00.00", name: "Πελάτες εσωτερικού", type: "ASSET" },
  { code: "38", name: "Χρηματικά διαθέσιμα", type: "ASSET", isPostable: false },
  { code: "38.00.00", name: "Ταμείο", type: "ASSET" },
  { code: "38.03.00", name: "Καταθέσεις όψεως", type: "ASSET" },
  { code: "33.90.00", name: "Εκκρεμείς εισπράξεις καρτών", type: "ASSET" },
  { code: "38.90.00", name: "Εκκαθάριση καρτών", type: "ASSET" },
  { code: "50", name: "Προμηθευτές", type: "LIABILITY", isPostable: false },
  { code: "50.00.00", name: "Προμηθευτές εσωτερικού", type: "LIABILITY" },
  { code: "54", name: "Φόροι-τέλη", type: "LIABILITY", isPostable: false },
  { code: "54.00.00", name: "ΦΠΑ εξερχόμενων", type: "LIABILITY" },
  { code: "54.00.01", name: "ΦΠΑ εισερχόμενων", type: "ASSET" },
  { code: "56", name: "Προκαταβολές / δωροκάρτες", type: "LIABILITY", isPostable: false },
  { code: "56.00.00", name: "Υποχρεώσεις δωροκαρτών", type: "LIABILITY" },
  { code: "70", name: "Πωλήσεις", type: "REVENUE", isPostable: false },
  { code: "70.00.00", name: "Πωλήσεις εμπορευμάτων", type: "REVENUE" },
  { code: "70.01.00", name: "Πωλήσεις λιανικής", type: "REVENUE" },
  { code: "64", name: "Έξοδα", type: "EXPENSE", isPostable: false },
  { code: "64.00.00", name: "Γενικά έξοδα", type: "EXPENSE" },
  { code: "80", name: "Αποτελέσματα", type: "EQUITY", isPostable: false },
  { code: "80.00.00", name: "Αποτελέσματα χρήσης", type: "EQUITY" },
];

export const GL_ACCOUNT_TYPE_LABEL: Record<GlAccountType, string> = {
  ASSET: "Ενεργητικό",
  LIABILITY: "Παθητικό",
  EQUITY: "Καθαρή θέση",
  REVENUE: "Έσοδα",
  EXPENSE: "Έξοδα",
};
