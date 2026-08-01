export const employeeStatusLabel = {
  ACTIVE: "Ενεργός",
  INACTIVE: "Ανενεργός",
  TERMINATED: "Αποχώρηση",
} as const;

export const contractTypeLabel = {
  INDEFINITE: "Αορίστου χρόνου",
  FIXED: "Ορισμένου χρόνου",
  PART_TIME: "Μερικής απασχόλησης",
  SEASONAL: "Εποχιακή",
  INTERNSHIP: "Πρακτική / μαθητεία",
} as const;

export const leaveRequestStatusLabel = {
  DRAFT: "Πρόχειρο",
  PENDING: "Σε αναμονή",
  APPROVED: "Εγκεκριμένη",
  REJECTED: "Απορρίφθηκε",
  CANCELLED: "Ακυρώθηκε",
} as const;

export const workCardStatusLabel = {
  ACTIVE: "Ενεργή",
  INACTIVE: "Ανενεργή",
  LOST: "Απώλεια",
} as const;

export const workCardEventTypeLabel = {
  CLOCK_IN: "Έναρξη",
  CLOCK_OUT: "Λήξη",
  BREAK_START: "Διάλειμμα έναρξη",
  BREAK_END: "Διάλειμμα λήξη",
} as const;

export const erganiStatusLabel = {
  PENDING: "Σε ουρά",
  SENT: "Εστάλη",
  ACCEPTED: "Αποδοχή",
  REJECTED: "Απόρριψη",
  CANCELLED: "Ακύρωση",
} as const;

export const payrollPeriodStatusLabel = {
  DRAFT: "Πρόχειρη",
  CLOSED: "Κλειστή",
} as const;

/** Ελληνικά πρότυπα αδειών (ενδεικτικά δικαιώματα / έτος) */
export const DEFAULT_LEAVE_TYPES: Array<{
  code: string;
  name: string;
  daysPerYear: number;
  isPaid: boolean;
  sortOrder: number;
}> = [
  {
    code: "ANNUAL",
    name: "Κανονική άδεια",
    daysPerYear: 20,
    isPaid: true,
    sortOrder: 10,
  },
  {
    code: "SICK",
    name: "Αναρρωτική",
    daysPerYear: 15,
    isPaid: true,
    sortOrder: 20,
  },
  {
    code: "MARRIAGE",
    name: "Γάμου",
    daysPerYear: 5,
    isPaid: true,
    sortOrder: 30,
  },
  {
    code: "MATERNITY",
    name: "Μητρότητας",
    daysPerYear: 119,
    isPaid: true,
    sortOrder: 40,
  },
  {
    code: "PATERNITY",
    name: "Πατρότητας",
    daysPerYear: 14,
    isPaid: true,
    sortOrder: 50,
  },
  {
    code: "PARENTAL",
    name: "Γονική",
    daysPerYear: 4,
    isPaid: true,
    sortOrder: 60,
  },
  {
    code: "UNPAID",
    name: "Άνευ αποδοχών",
    daysPerYear: 30,
    isPaid: false,
    sortOrder: 70,
  },
];
