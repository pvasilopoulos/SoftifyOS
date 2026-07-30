export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partial"
  | "paid"
  | "overdue";

export type Invoice = {
  id: string;
  number: string;
  customer: string;
  initials: string;
  issuedAt: string;
  dueAt: string;
  amount: number;
  paidRatio: number;
  status: InvoiceStatus;
};

export const demoInvoices: Invoice[] = [
  {
    id: "1",
    number: "ΤΙΜ-2026-01482",
    customer: "Νηρέας Logistics ΑΕ",
    initials: "ΝΛ",
    issuedAt: "2026-07-28",
    dueAt: "2026-08-27",
    amount: 12450,
    paidRatio: 0,
    status: "issued",
  },
  {
    id: "2",
    number: "ΤΙΜ-2026-01481",
    customer: "Αιγαίο Foods ΟΕ",
    initials: "ΑF",
    issuedAt: "2026-07-22",
    dueAt: "2026-07-22",
    amount: 3820.5,
    paidRatio: 0.4,
    status: "overdue",
  },
  {
    id: "3",
    number: "ΤΙΜ-2026-01480",
    customer: "Όλυμπος Retail",
    initials: "ΟΡ",
    issuedAt: "2026-07-20",
    dueAt: "2026-08-19",
    amount: 9100,
    paidRatio: 1,
    status: "paid",
  },
  {
    id: "4",
    number: "ΤΙΜ-2026-01479",
    customer: "Θερμαϊκός Tech",
    initials: "ΘΤ",
    issuedAt: "2026-07-18",
    dueAt: "2026-08-17",
    amount: 2210,
    paidRatio: 0.55,
    status: "partial",
  },
  {
    id: "5",
    number: "ΤΙΜ-2026-01478",
    customer: "Κρήτη Pack ΑΕ",
    initials: "ΚΠ",
    issuedAt: "2026-07-15",
    dueAt: "—",
    amount: 640,
    paidRatio: 0,
    status: "draft",
  },
  {
    id: "6",
    number: "ΤΙΜ-2026-01477",
    customer: "Πίνδος Agro",
    initials: "ΠΑ",
    issuedAt: "2026-07-12",
    dueAt: "2026-08-11",
    amount: 15890,
    paidRatio: 1,
    status: "paid",
  },
  {
    id: "7",
    number: "ΤΙΜ-2026-01476",
    customer: "Αττική Supplies",
    initials: "ΑΣ",
    issuedAt: "2026-07-10",
    dueAt: "2026-07-25",
    amount: 4775,
    paidRatio: 0,
    status: "overdue",
  },
  {
    id: "8",
    number: "ΤΙΜ-2026-01475",
    customer: "Ιόνιο Marine",
    initials: "ΙΜ",
    issuedAt: "2026-07-08",
    dueAt: "2026-08-07",
    amount: 2890,
    paidRatio: 0,
    status: "issued",
  },
];

export const statusLabel: Record<InvoiceStatus, string> = {
  draft: "Πρόχειρο",
  issued: "Εκδομένο",
  partial: "Μερική εξόφληση",
  paid: "Πληρωμένο",
  overdue: "Ληξιπρόθεσμο",
};

export const statusTone: Record<
  InvoiceStatus,
  "slate" | "teal" | "amber" | "emerald" | "rose"
> = {
  draft: "slate",
  issued: "teal",
  partial: "amber",
  paid: "emerald",
  overdue: "rose",
};

export function formatEUR(value: number) {
  return new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}
