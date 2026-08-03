"use client";

import {
  FormEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileStack,
  Filter,
  IdCard,
  LayoutDashboard,
  PartyPopper,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import {
  WEEKDAY_BITS,
  contractTypeLabel,
  employeeStatusLabel,
  erganiStatusLabel,
  formatWorkDays,
  leaveRequestStatusLabel,
  payrollPeriodStatusLabel,
  workCardEventTypeLabel,
  workCardStatusLabel,
  workShiftKindLabel,
} from "@/modules/hr/labels";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { WorkCardPanel } from "./work-card-panel";
import { LeaveCalendarPanel } from "./leave-calendar-panel";
import {
  DirectoryPanel,
  DocumentsPanel,
  HolidaysPanel,
  LeaveAdjustmentsPanel,
  LeaveTypesAdminPanel,
  OnboardingPanel,
  TeamPulsePanel,
} from "./hr-suite-panels";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type SiteOpt = { id: string; code: string; name: string };

type Employee = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  department: string | null;
  vatNumber: string | null;
  amka: string | null;
  ama: string | null;
  iban: string | null;
  birthDate: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  nationality: string;
  contractType: string;
  specialty: string | null;
  weeklyHours: number | null;
  baseGross: number | null;
  monthlyAllowance: number;
  siteId: string | null;
  site: SiteOpt | null;
  hireDate: string | null;
  terminationDate: string | null;
  erganiEmployeeId: string | null;
  status: string;
  notes: string | null;
};

type LeaveType = {
  id: string;
  code: string;
  name: string;
  daysPerYear: number;
  isPaid: boolean;
  isActive: boolean;
};

type LeaveRequest = {
  id: string;
  days: number;
  halfDay?: boolean;
  status: string;
  fromDate: string;
  toDate: string;
  notes: string | null;
  employee: { id: string; code: string; firstName: string; lastName: string };
  leaveType: { id: string; code: string; name: string; isPaid: boolean };
};

type LeaveBalanceRow = {
  employee: {
    id: string;
    code: string;
    firstName: string;
    lastName: string;
    status: string;
  };
  year: number;
  balances: Array<{
    leaveTypeId: string;
    code: string;
    name: string;
    isPaid: boolean;
    entitlement: number;
    adjustment?: number;
    used: number;
    remaining: number;
  }>;
};

type WorkCard = {
  id: string;
  cardNumber: string;
  qrToken?: string | null;
  status: string;
  issuedAt: string;
  employee: { id: string; code: string; firstName: string; lastName: string };
};

type WorkCardEvent = {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  erganiStatus: string;
  isLate?: boolean;
  isEarly?: boolean;
  employee: { id: string; code: string; firstName: string; lastName: string };
  workCard: { id: string; cardNumber: string } | null;
  site: SiteOpt | null;
};

type ErganiRow = {
  id: string;
  entityType: string;
  eventKind: string;
  status: string;
  externalRef: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

type PayrollPeriod = {
  id: string;
  code: string;
  year: number;
  month: number;
  status: string;
  lineCount: number;
  totals: {
    gross: number;
    net: number;
    employeeEfka: number;
    employerEfka: number;
    tax: number;
  };
};

type Schedule = {
  id: string;
  code: string;
  name: string;
  workDays: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  weeklyHours: number;
  isActive: boolean;
  notes: string | null;
  assignmentCount: number;
};

type Assignment = {
  id: string;
  fromDate: string;
  toDate: string | null;
  notes: string | null;
  employee: { id: string; code: string; firstName: string; lastName: string };
  schedule: {
    id: string;
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    workDays: number;
  };
};

type Shift = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  kind: string;
  notes: string | null;
  employee: { id: string; code: string; firstName: string; lastName: string };
  site: SiteOpt | null;
};

type Section =
  | "overview"
  | "pulse"
  | "employees"
  | "directory"
  | "employee"
  | "onboarding"
  | "documents"
  | "calendar"
  | "leaves"
  | "balances"
  | "adjustments"
  | "leave-types"
  | "holidays"
  | "schedules"
  | "workcard"
  | "ergani"
  | "payroll";

type HrFilters = {
  q: string;
  status: string;
  year: number;
  from: string;
  to: string;
};

const NAV: Array<{
  group: string;
  hint: string;
  items: Array<{
    id: Section;
    label: string;
    hint: string;
    icon: typeof Wallet;
  }>;
}> = [
  {
    group: "Αρχική",
    hint: "Τι χρειάζεται προσοχή σήμερα",
    items: [
      {
        id: "overview",
        label: "Επισκόπηση",
        hint: "Εκκρεμότητες & γρήγορα",
        icon: LayoutDashboard,
      },
      {
        id: "pulse",
        label: "Σήμερα / ομάδα",
        hint: "Άδειες · γενέθλια · τμήματα",
        icon: PartyPopper,
      },
    ],
  },
  {
    group: "Άνθρωποι",
    hint: "Μητρώο · οργανόγραμμα · docs",
    items: [
      {
        id: "employees",
        label: "Εργαζόμενοι",
        hint: "Λίστα & νέα πρόσληψη",
        icon: Users,
      },
      {
        id: "directory",
        label: "Οργανόγραμμα",
        hint: "Τμήματα & κάρτες",
        icon: Building2,
      },
      {
        id: "employee",
        label: "Καρτέλα εργαζομένου",
        hint: "Επεξεργασία / αποχώρηση",
        icon: UserRound,
      },
      {
        id: "onboarding",
        label: "Onboarding",
        hint: "Checklist πρόσληψης",
        icon: ClipboardCheck,
      },
      {
        id: "documents",
        label: "Έγγραφα",
        hint: "Συμβάσεις · λήξεις",
        icon: FileStack,
      },
    ],
  },
  {
    group: "Χρόνος",
    hint: "Άδειες · ημερολόγιο · ωράρια",
    items: [
      {
        id: "calendar",
        label: "Ημερολόγιο αδειών",
        hint: "Μήνας · ομάδα · αργίες",
        icon: CalendarRange,
      },
      {
        id: "leaves",
        label: "Άδειες",
        hint: "Αιτήσεις & εγκρίσεις",
        icon: CalendarDays,
      },
      {
        id: "balances",
        label: "Υπόλοιπα αδειών",
        hint: "Δικαίωμα − χρήση",
        icon: ClipboardList,
      },
      {
        id: "adjustments",
        label: "Προσαρμογές",
        hint: "Μεταφορές ημερών",
        icon: SlidersHorizontal,
      },
      {
        id: "leave-types",
        label: "Τύποι αδειών",
        hint: "Δικαιώματα / έτος",
        icon: Settings2,
      },
      {
        id: "holidays",
        label: "Αργίες & blackout",
        hint: "Ελληνικό ημερολόγιο",
        icon: CalendarDays,
      },
      {
        id: "schedules",
        label: "Ωράρια & βάρδιες",
        hint: "Πρότυπα · αναθέσεις · shifts",
        icon: Clock3,
      },
    ],
  },
  {
    group: "Παρουσία",
    hint: "Κάρτα & Εργάνη",
    items: [
      {
        id: "workcard",
        label: "Κάρτα εργασίας",
        hint: "QR · live · kiosk",
        icon: IdCard,
      },
      {
        id: "ergani",
        label: "Εργάνη",
        hint: "Ουρά δηλώσεων",
        icon: Send,
      },
    ],
  },
  {
    group: "Αμοιβές",
    hint: "Περίοδοι μισθοδοσίας",
    items: [
      {
        id: "payroll",
        label: "Μισθοδοσία",
        hint: "Μικτά · ΕΦΚΑ · καθαρά",
        icon: Wallet,
      },
    ],
  },
];

const SECTION_HELP: Record<Section, { title: string; body: string }> = {
  overview: {
    title: "Επισκόπηση HR",
    body: "Command center: εκκρεμότητες, γρήγορα shortcuts σε ημερολόγιο, pulse ομάδας και παρουσία.",
  },
  pulse: {
    title: "Σήμερα / ομάδα",
    body: "Ποιοι λείπουν, γενέθλια εβδομάδας, επέτειοι, κατανομή τμημάτων και έγγραφα που λήγουν.",
  },
  employees: {
    title: "Μητρώο εργαζομένων",
    body: "Αναζήτηση/φίλτρο κατάστασης. Δημιούργησε νέο εργαζόμενο με ΑΦΜ/ΑΜΚΑ/ΑΜΑ και μικτές αποδοχές.",
  },
  directory: {
    title: "Οργανόγραμμα τμημάτων",
    body: "Οπτική λίστα ανά τμήμα — κλικ ανοίγει την καρτέλα εργαζομένου.",
  },
  employee: {
    title: "Καρτέλα εργαζομένου",
    body: "Επίλεξε από τη λίστα ή κλικ σε γραμμή. Αποθήκευση με PATCH · Αποχώρηση ορίζει TERMINATED.",
  },
  onboarding: {
    title: "Onboarding checklist",
    body: "Αυτόματο seed στην πρόσληψη. Σημείωσε βήματα ως ολοκληρωμένα μέχρι 100%.",
  },
  documents: {
    title: "Μητρώο εγγράφων HR",
    body: "Συμβάσεις, ταυτότητες, πιστοποιητικά με ημερομηνία λήξης και ειδοποίηση 30 ημερών.",
  },
  calendar: {
    title: "Ημερολόγιο αδειών",
    body: "Μηνιαία οπτική παρουσίαση εγκεκριμένων/σε αναμονή αδειών + αργίες. Φίλτρα τμήματος.",
  },
  leaves: {
    title: "Αιτήσεις αδειών",
    body: "Υποβολή με έλεγχο επικάλυψης, υπολοίπου και blackout αργιών. Υποστήριξη μισής ημέρας.",
  },
  balances: {
    title: "Υπόλοιπα αδειών",
    body: "Δικαίωμα + προσαρμογές − εγκεκριμένες ημέρες για το επιλεγμένο έτος φίλτρου.",
  },
  adjustments: {
    title: "Προσαρμογές υπολοίπων",
    body: "Μεταφορά ημερών από προηγούμενο έτος ή διορθώσεις δικαιώματος ανά τύπο.",
  },
  "leave-types": {
    title: "Τύποι αδειών",
    body: "Διαχείριση ελληνικών προτύπων και προσαρμοσμένων τύπων (ημέρες/έτος, έμμισθη).",
  },
  holidays: {
    title: "Αργίες & blackout",
    body: "Αυτόματο seed ελληνικών αργιών (συμπ. κινητών). Blackout μπλοκάρει νέες αιτήσεις.",
  },
  schedules: {
    title: "Ωράρια & βάρδιες",
    body: "Πρότυπα ωραρίου (ημέρες bitmask), ανάθεση σε εργαζόμενο και καταχώρηση βαρδιών.",
  },
  workcard: {
    title: "Ψηφιακή κάρτα εργασίας",
    body: "QR scanner check-in/out, live board παρουσίας, kiosk mode, έκδοση κάρτας με QR badge, καθυστερήσεις vs ωράριο και ουρά Εργάνη.",
  },
  ergani: {
    title: "Ουρά Εργάνη",
    body: "Επεξεργασία μίας δήλωσης ή batch. Simulator έως live credentials στις Integrations.",
  },
  payroll: {
    title: "Μισθοδοσία",
    body: "Δημιουργία περιόδου, επεξεργασία μικτών γραμμής, κλείσιμο. Εμφάνιση ΕΦΚΑ / φόρου / καθαρών.",
  },
};

function money(n: number) {
  return n.toLocaleString("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  });
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString("el-GR");
}

function dt(iso: string) {
  return new Date(iso).toLocaleString("el-GR");
}

function empName(e: { lastName: string; firstName: string; code: string }) {
  return `${e.lastName} ${e.firstName} (${e.code})`;
}

function isoDate(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

const emptyEmployeeForm = {
  code: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  title: "",
  department: "",
  vatNumber: "",
  amka: "",
  ama: "",
  iban: "",
  specialty: "",
  contractType: "INDEFINITE",
  weeklyHours: "40",
  baseGross: "1200",
  monthlyAllowance: "0",
  siteId: "",
  hireDate: "",
  birthDate: "",
  address: "",
  notes: "",
};

function employeeToEditForm(e: Employee) {
  return {
    code: e.code,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email ?? "",
    phone: e.phone ?? "",
    title: e.title ?? "",
    department: e.department ?? "",
    vatNumber: e.vatNumber ?? "",
    amka: e.amka ?? "",
    ama: e.ama ?? "",
    iban: e.iban ?? "",
    specialty: e.specialty ?? "",
    contractType: e.contractType,
    weeklyHours: e.weeklyHours != null ? String(e.weeklyHours) : "40",
    baseGross: e.baseGross != null ? String(e.baseGross) : "",
    monthlyAllowance: String(e.monthlyAllowance ?? 0),
    siteId: e.siteId ?? "",
    hireDate: isoDate(e.hireDate),
    birthDate: isoDate(e.birthDate),
    address: e.address ?? "",
    notes: e.notes ?? "",
    status: e.status,
    terminationDate: isoDate(e.terminationDate),
  };
}

export function HrClient({
  canWrite,
  initialEmployees,
  initialLeaveTypes,
  initialLeaveRequests,
  initialLeaveBalances,
  initialWorkCards,
  initialEvents,
  initialErgani,
  initialPayroll,
  initialSchedules,
  initialAssignments,
  initialShifts,
  sites,
}: {
  canWrite: boolean;
  initialEmployees: Employee[];
  initialLeaveTypes: LeaveType[];
  initialLeaveRequests: LeaveRequest[];
  initialLeaveBalances: LeaveBalanceRow[];
  initialWorkCards: WorkCard[];
  initialEvents: WorkCardEvent[];
  initialErgani: ErganiRow[];
  initialPayroll: PayrollPeriod[];
  initialSchedules: Schedule[];
  initialAssignments: Assignment[];
  initialShifts: Shift[];
  sites: SiteOpt[];
}) {
  const router = useRouter();
  const nowYear = new Date().getFullYear();
  const [section, setSection] = useState<Section>("overview");
  const [filters, setFilters] = useState<HrFilters>({
    q: "",
    status: "ALL",
    year: nowYear,
    from: "",
    to: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [employees, setEmployees] = useState(initialEmployees);
  const [leaveTypes, setLeaveTypes] = useState(initialLeaveTypes);
  const [leaveRequests, setLeaveRequests] = useState(initialLeaveRequests);
  const [leaveBalances, setLeaveBalances] = useState(initialLeaveBalances);
  const [workCards, setWorkCards] = useState(initialWorkCards);
  const [events, setEvents] = useState(initialEvents);
  const [ergani, setErgani] = useState(initialErgani);
  const [payroll, setPayroll] = useState(initialPayroll);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [shifts, setShifts] = useState(initialShifts);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null,
  );
  const [empForm, setEmpForm] = useState(emptyEmployeeForm);
  const [editForm, setEditForm] = useState<ReturnType<
    typeof employeeToEditForm
  > | null>(null);

  const [leaveForm, setLeaveForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    fromDate: "",
    toDate: "",
    halfDay: false,
    notes: "",
  });
  const [cardForm, setCardForm] = useState({
    employeeId: "",
    cardNumber: "",
    notes: "",
  });
  const [punchForm, setPunchForm] = useState({
    employeeId: "",
    type: "CLOCK_IN",
    siteId: "",
    note: "",
  });
  const [scheduleForm, setScheduleForm] = useState({
    code: "",
    name: "",
    workDays: 31,
    startTime: "09:00",
    endTime: "17:00",
    breakMinutes: "30",
    weeklyHours: "40",
  });
  const [assignForm, setAssignForm] = useState({
    employeeId: "",
    scheduleId: "",
    fromDate: "",
    toDate: "",
  });
  const [shiftForm, setShiftForm] = useState({
    employeeId: "",
    workDate: "",
    startTime: "09:00",
    endTime: "17:00",
    breakMinutes: "0",
    kind: "REGULAR",
    siteId: "",
    notes: "",
  });
  const [payrollForm, setPayrollForm] = useState({
    year: String(nowYear),
    month: String(new Date().getMonth() + 1),
    defaultGross: "1200",
  });
  const [payrollDetail, setPayrollDetail] = useState<{
    id: string;
    code: string;
    status: string;
    lines: Array<{
      id: string;
      employeeId: string;
      employee: { lastName: string; firstName: string; code: string };
      gross: number;
      employeeEfka: number;
      employerEfka: number;
      tax: number;
      net: number;
    }>;
  } | null>(null);
  const [lineGrossEdit, setLineGrossEdit] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    setEmployees(initialEmployees);
    setLeaveTypes(initialLeaveTypes);
    setLeaveRequests(initialLeaveRequests);
    setLeaveBalances(initialLeaveBalances);
    setWorkCards(initialWorkCards);
    setEvents(initialEvents);
    setErgani(initialErgani);
    setPayroll(initialPayroll);
    setSchedules(initialSchedules);
    setAssignments(initialAssignments);
    setShifts(initialShifts);
  }, [
    initialEmployees,
    initialLeaveTypes,
    initialLeaveRequests,
    initialLeaveBalances,
    initialWorkCards,
    initialEvents,
    initialErgani,
    initialPayroll,
    initialSchedules,
    initialAssignments,
    initialShifts,
  ]);

  useEffect(() => {
    if (!selectedEmployeeId) {
      setEditForm(null);
      return;
    }
    const e = employees.find((x) => x.id === selectedEmployeeId);
    if (e) setEditForm(employeeToEditForm(e));
  }, [selectedEmployeeId, employees]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/hr/leave-balances?year=${filters.year}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        setLeaveBalances(data.items ?? []);
      } catch {
        /* keep server snapshot */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters.year]);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === "ACTIVE"),
    [employees],
  );

  const filteredEmployees = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return employees.filter((e) => {
      if (filters.status !== "ALL" && e.status !== filters.status) return false;
      if (!q) return true;
      const hay = [
        e.code,
        e.firstName,
        e.lastName,
        e.vatNumber,
        e.amka,
        e.email,
        e.department,
        e.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [employees, filters.q, filters.status]);

  const filteredShifts = useMemo(() => {
    return shifts.filter((s) => {
      const d = isoDate(s.workDate);
      if (filters.from && d < filters.from) return false;
      if (filters.to && d > filters.to) return false;
      const q = filters.q.trim().toLowerCase();
      if (!q) return true;
      return empName(s.employee).toLowerCase().includes(q);
    });
  }, [shifts, filters.from, filters.to, filters.q]);

  const kpis = useMemo(() => {
    const pendingLeave = leaveRequests.filter((r) => r.status === "PENDING")
      .length;
    const pendingErgani = ergani.filter((r) =>
      ["PENDING", "SENT", "REJECTED"].includes(r.status),
    ).length;
    const activeCards = workCards.filter((c) => c.status === "ACTIVE").length;
    const draftPayroll = payroll.filter((p) => p.status === "DRAFT").length;
    return {
      headcount: activeEmployees.length,
      pendingLeave,
      activeCards,
      pendingErgani,
      draftPayroll,
    };
  }, [activeEmployees, leaveRequests, workCards, ergani, payroll]);

  const help = SECTION_HELP[section];
  const filterSummary = useMemo(() => {
    const bits: string[] = [`έτος ${filters.year}`];
    if (filters.status !== "ALL") bits.push(filters.status);
    if (filters.q.trim()) bits.push(`«${filters.q.trim()}»`);
    if (filters.from || filters.to) {
      bits.push(`${filters.from || "…"} → ${filters.to || "…"}`);
    }
    return bits.join(" · ");
  }, [filters]);

  async function run(fn: () => Promise<void>, okMessage?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      if (okMessage) setMessage(okMessage);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  function openEmployee(id: string) {
    setSelectedEmployeeId(id);
    setSection("employee");
  }

  async function createEmployee(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...empForm,
          email: empForm.email || null,
          phone: empForm.phone || null,
          title: empForm.title || null,
          department: empForm.department || null,
          vatNumber: empForm.vatNumber || null,
          amka: empForm.amka || null,
          ama: empForm.ama || null,
          iban: empForm.iban || null,
          specialty: empForm.specialty || null,
          weeklyHours: empForm.weeklyHours
            ? Number(empForm.weeklyHours)
            : null,
          baseGross: empForm.baseGross ? Number(empForm.baseGross) : null,
          monthlyAllowance: Number(empForm.monthlyAllowance || 0),
          siteId: empForm.siteId || null,
          hireDate: empForm.hireDate || null,
          birthDate: empForm.birthDate || null,
          address: empForm.address || null,
          notes: empForm.notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setEmpForm(emptyEmployeeForm);
    }, "Ο εργαζόμενος καταχωρήθηκε · ουρά Εργάνη");
  }

  async function saveEmployee(e: FormEvent) {
    e.preventDefault();
    if (!selectedEmployeeId || !editForm) return;
    await run(async () => {
      const res = await fetch(`/api/employees/${selectedEmployeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editForm.code,
          firstName: editForm.firstName,
          lastName: editForm.lastName,
          email: editForm.email || null,
          phone: editForm.phone || null,
          title: editForm.title || null,
          department: editForm.department || null,
          vatNumber: editForm.vatNumber || null,
          amka: editForm.amka || null,
          ama: editForm.ama || null,
          iban: editForm.iban || null,
          specialty: editForm.specialty || null,
          contractType: editForm.contractType,
          weeklyHours: editForm.weeklyHours
            ? Number(editForm.weeklyHours)
            : null,
          baseGross: editForm.baseGross ? Number(editForm.baseGross) : null,
          monthlyAllowance: Number(editForm.monthlyAllowance || 0),
          siteId: editForm.siteId || null,
          hireDate: editForm.hireDate || null,
          birthDate: editForm.birthDate || null,
          address: editForm.address || null,
          notes: editForm.notes || null,
          status: editForm.status,
          terminationDate: editForm.terminationDate || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
    }, "Η καρτέλα αποθηκεύτηκε");
  }

  async function terminateEmployee() {
    if (!selectedEmployeeId || !editForm) return;
    const terminationDate =
      editForm.terminationDate || new Date().toISOString().slice(0, 10);
    await run(async () => {
      const res = await fetch(`/api/employees/${selectedEmployeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "TERMINATED",
          terminationDate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setEditForm((f) =>
        f
          ? { ...f, status: "TERMINATED", terminationDate }
          : f,
      );
    }, "Καταχωρήθηκε αποχώρηση");
  }

  async function createLeave(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch("/api/hr/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...leaveForm,
          notes: leaveForm.notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setLeaveForm({
        employeeId: "",
        leaveTypeId: "",
        fromDate: "",
        toDate: "",
        halfDay: false,
        notes: "",
      });
    }, "Η αίτηση άδειας υποβλήθηκε");
  }

  async function reloadLeaveBalances() {
    const res = await fetch(`/api/hr/leave-balances?year=${filters.year}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.items)) {
      setLeaveBalances(data.items);
    }
  }

  async function decideLeave(
    id: string,
    status: "APPROVED" | "REJECTED" | "CANCELLED",
  ) {
    await run(async () => {
      const res = await fetch(`/api/hr/leave-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
    }, status === "APPROVED"
      ? "Εγκρίθηκε"
      : status === "REJECTED"
        ? "Απορρίφθηκε"
        : "Ακυρώθηκε");
  }

  async function createSchedule(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch("/api/hr/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: scheduleForm.code,
          name: scheduleForm.name,
          workDays: scheduleForm.workDays,
          startTime: scheduleForm.startTime,
          endTime: scheduleForm.endTime,
          breakMinutes: Number(scheduleForm.breakMinutes),
          weeklyHours: Number(scheduleForm.weeklyHours),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setScheduleForm({
        code: "",
        name: "",
        workDays: 31,
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: "30",
        weeklyHours: "40",
      });
    }, "Το πρότυπο ωραρίου δημιουργήθηκε");
  }

  async function assignSchedule(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch("/api/hr/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign",
          employeeId: assignForm.employeeId,
          scheduleId: assignForm.scheduleId,
          fromDate: assignForm.fromDate,
          toDate: assignForm.toDate || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setAssignForm({
        employeeId: "",
        scheduleId: "",
        fromDate: "",
        toDate: "",
      });
    }, "Ανατέθηκε ωράριο");
  }

  async function createShift(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch("/api/hr/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: shiftForm.employeeId,
          workDate: shiftForm.workDate,
          startTime: shiftForm.startTime,
          endTime: shiftForm.endTime,
          breakMinutes: Number(shiftForm.breakMinutes || 0),
          kind: shiftForm.kind,
          siteId: shiftForm.siteId || null,
          notes: shiftForm.notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setShiftForm((f) => ({ ...f, notes: "", workDate: "" }));
    }, "Καταχωρήθηκε βάρδια");
  }

  async function issueCard(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch("/api/hr/work-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cardForm,
          notes: cardForm.notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setCardForm({ employeeId: "", cardNumber: "", notes: "" });
    }, "Εκδόθηκε κάρτα εργασίας");
  }

  async function patchCardStatus(
    id: string,
    status: "ACTIVE" | "INACTIVE" | "LOST",
  ) {
    await run(async () => {
      const res = await fetch(`/api/hr/work-cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
    }, "Ενημερώθηκε κατάσταση κάρτας");
  }

  async function punch(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch("/api/hr/work-card-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: punchForm.employeeId,
          type: punchForm.type,
          source: "MANUAL",
          siteId: punchForm.siteId || null,
          note: punchForm.note || null,
          enqueueErgani: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setPunchForm((f) => ({ ...f, note: "" }));
    }, "Καταχωρήθηκε χτύπημα · ουρά Εργάνη");
  }

  async function processErgani(id?: string) {
    await run(async () => {
      const url = id
        ? `/api/hr/ergani/submissions/${id}/process`
        : "/api/hr/ergani/submissions/process-batch";
      const res = await fetch(url, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
    }, id ? "Επεξεργασία Εργάνη" : "Batch Εργάνη ολοκληρώθηκε");
  }

  async function createPayroll(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch("/api/hr/payroll/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: Number(payrollForm.year),
          month: Number(payrollForm.month),
          defaultGross: Number(payrollForm.defaultGross),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
    }, "Δημιουργήθηκε περίοδος μισθοδοσίας");
  }

  async function openPayroll(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/payroll/periods/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setPayrollDetail(data.item);
      const edits: Record<string, string> = {};
      for (const l of data.item.lines as Array<{
        employeeId: string;
        gross: number;
      }>) {
        edits[l.employeeId] = String(l.gross);
      }
      setLineGrossEdit(edits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function savePayrollLine(employeeId: string) {
    if (!payrollDetail) return;
    const gross = Number(lineGrossEdit[employeeId]);
    if (!Number.isFinite(gross)) {
      setError("Μη έγκυρο μικτό");
      return;
    }
    await run(async () => {
      const res = await fetch(
        `/api/hr/payroll/periods/${payrollDetail.id}/lines`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, gross }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      await openPayroll(payrollDetail.id);
    }, "Ενημερώθηκε γραμμή");
  }

  async function closePayroll(id: string) {
    await run(async () => {
      const res = await fetch(`/api/hr/payroll/periods/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setPayrollDetail(null);
    }, "Η περίοδος έκλεισε");
  }

  const inputCls =
    "mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm";
  const labelCls = "block text-xs text-slate-600";

  return (
    <div className="hr-hub space-y-4 p-4 md:p-6">
      <style jsx global>{`
        .hr-hub {
          --hr-ink: #0c1b2a;
          --hr-accent: #0f766e;
        }
        .hr-hero {
          background:
            radial-gradient(
              900px 280px at 0% 0%,
              rgba(15, 118, 110, 0.12),
              transparent 55%
            ),
            linear-gradient(180deg, #eef6f5 0%, #f8fafc 70%);
          border: 1px solid rgba(15, 118, 110, 0.12);
        }
      `}</style>

      <div className="hr-hero rounded-[1.75rem] px-5 py-4 sm:px-6">
        <PageHeader
          title="HR"
          description="Χώρος εργασίας HR / μισθοδοσίας · μητρώο · άδειες · κάρτα · Εργάνη · μισθοδοσία"
          actions={
            canWrite ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSection("employees")}
                >
                  + Εργαζόμενος
                </Button>
                <Button size="sm" onClick={() => setSection("leaves")}>
                  + Άδεια
                </Button>
              </div>
            ) : null
          }
        />
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Badge tone="teal">{kpis.headcount} ενεργοί</Badge>
          <Badge tone={kpis.pendingLeave > 0 ? "rose" : "slate"}>
            {kpis.pendingLeave} άδειες σε αναμονή
          </Badge>
          <Badge tone="emerald">{kpis.activeCards} ενεργές κάρτες</Badge>
          <Badge tone={kpis.pendingErgani > 0 ? "amber" : "slate"}>
            {kpis.pendingErgani} ουρά Εργάνη
          </Badge>
          {kpis.draftPayroll > 0 ? (
            <Badge tone="rose">{kpis.draftPayroll} πρόχειρη μισθοδοσία</Badge>
          ) : null}
        </div>
      </div>

      <section className="soft-panel sticky top-14 z-20 space-y-3 border border-teal-100/80 bg-white/95 p-3 shadow-sm backdrop-blur sm:p-4 lg:top-16">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <Filter className="h-4 w-4 text-teal-700" />
            Φίλτρα εργασίας
            <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800">
              ισχύουν στις ενότητες
            </span>
          </div>
          <p className="text-xs text-slate-500">{filterSummary}</p>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <label className={cn(labelCls, "xl:col-span-2")}>
            Αναζήτηση
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-sm"
                placeholder="Όνομα, ΑΦΜ, ΑΜΚΑ, κωδικός…"
                value={filters.q}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, q: e.target.value }))
                }
              />
            </div>
          </label>
          <label className={labelCls}>
            Κατάσταση
            <select
              className={inputCls}
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value }))
              }
            >
              <option value="ALL">Όλες</option>
              {Object.entries(employeeStatusLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Έτος (υπόλοιπα)
            <input
              type="number"
              min={2000}
              max={2100}
              className={inputCls}
              value={filters.year}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  year: Number(e.target.value) || nowYear,
                }))
              }
            />
          </label>
          <label className={labelCls}>
            Από (βάρδιες)
            <input
              type="date"
              className={inputCls}
              value={filters.from}
              onChange={(e) =>
                setFilters((f) => ({ ...f, from: e.target.value }))
              }
            />
          </label>
          <label className={labelCls}>
            Έως (βάρδιες)
            <input
              type="date"
              className={inputCls}
              value={filters.to}
              onChange={(e) =>
                setFilters((f) => ({ ...f, to: e.target.value }))
              }
            />
          </label>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setFilters({
                q: "",
                status: "ALL",
                year: nowYear,
                from: "",
                to: "",
              })
            }
          >
            Καθαρισμός
          </Button>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="soft-panel h-fit space-y-4 p-3 lg:sticky lg:top-20">
          {NAV.map((group) => (
            <div key={group.group}>
              <p className="mb-0.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {group.group}
              </p>
              <p className="mb-1.5 px-2 text-[10px] text-slate-400">
                {group.hint}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  const badge =
                    item.id === "leaves" && kpis.pendingLeave > 0
                      ? kpis.pendingLeave
                      : item.id === "ergani" && kpis.pendingErgani > 0
                        ? kpis.pendingErgani
                        : item.id === "payroll" && kpis.draftPayroll > 0
                          ? kpis.draftPayroll
                          : null;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSection(item.id)}
                        className={cn(
                          "flex w-full flex-col rounded-xl px-2.5 py-2 text-left transition",
                          active
                            ? "bg-[var(--hr-ink)] text-white shadow-md shadow-slate-900/10"
                            : "text-slate-700 hover:bg-slate-100",
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Icon className="h-3.5 w-3.5 opacity-80" />
                          {item.label}
                          {badge != null ? (
                            <span
                              className={cn(
                                "ml-auto rounded-md px-1.5 text-[10px] font-semibold",
                                active
                                  ? "bg-white/20"
                                  : "bg-rose-100 text-rose-800",
                              )}
                            >
                              {badge}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 pl-5 text-[10px]",
                            active ? "text-white/70" : "text-slate-400",
                          )}
                        >
                          {item.hint}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-3">
          <div className="rounded-2xl border border-teal-100 bg-teal-50/50 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">{help.title}</h2>
            <p className="mt-0.5 text-xs text-slate-600">{help.body}</p>
          </div>

          {section === "overview" ? (
            <OverviewPanel
              kpis={kpis}
              leaveRequests={leaveRequests}
              ergani={ergani}
              onGo={setSection}
            />
          ) : null}

          {section === "pulse" ? (
            <TeamPulsePanel employees={employees} />
          ) : null}

          {section === "directory" ? (
            <DirectoryPanel onOpenEmployee={openEmployee} />
          ) : null}

          {section === "onboarding" ? (
            <OnboardingPanel
              employees={activeEmployees}
              canWrite={canWrite}
            />
          ) : null}

          {section === "documents" ? (
            <DocumentsPanel
              employees={activeEmployees}
              canWrite={canWrite}
            />
          ) : null}

          {section === "calendar" ? (
            <LeaveCalendarPanel
              year={filters.year}
              initialLeaves={leaveRequests.map((r) => ({
                ...r,
                halfDay: Boolean(r.halfDay),
                employee: {
                  ...r.employee,
                  department:
                    employees.find((e) => e.id === r.employee.id)?.department ??
                    null,
                },
              }))}
            />
          ) : null}

          {section === "adjustments" ? (
            <LeaveAdjustmentsPanel
              employees={activeEmployees}
              leaveTypes={leaveTypes}
              year={filters.year}
              canWrite={canWrite}
              onAdjusted={() => void reloadLeaveBalances()}
            />
          ) : null}

          {section === "leave-types" ? (
            <LeaveTypesAdminPanel
              initialTypes={leaveTypes}
              canWrite={canWrite}
              onChanged={setLeaveTypes}
            />
          ) : null}

          {section === "holidays" ? (
            <HolidaysPanel year={filters.year} canWrite={canWrite} />
          ) : null}

          {section === "employees" ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
              <section className="soft-panel overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Κωδικός</th>
                        <th className="px-3 py-2">Ονοματεπώνυμο</th>
                        <th className="px-3 py-2">ΑΦΜ / ΑΜΚΑ</th>
                        <th className="px-3 py-2">Σύμβαση</th>
                        <th className="px-3 py-2 text-right">Μικτό</th>
                        <th className="px-3 py-2">Κατάσταση</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map((e) => (
                        <tr
                          key={e.id}
                          className="cursor-pointer border-t border-slate-100 hover:bg-teal-50/40"
                          onClick={() => openEmployee(e.id)}
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {e.code}
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {e.lastName} {e.firstName}
                            {e.title || e.department ? (
                              <div className="text-xs font-normal text-slate-500">
                                {[e.title, e.department]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">
                            <div>{e.vatNumber || "—"}</div>
                            <div>{e.amka || "—"}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {contractTypeLabel[
                              e.contractType as keyof typeof contractTypeLabel
                            ] || e.contractType}
                            {e.weeklyHours != null ? (
                              <div className="text-xs text-slate-500">
                                {e.weeklyHours} ώρες/εβδ.
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {e.baseGross != null ? money(e.baseGross) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {employeeStatusLabel[
                              e.status as keyof typeof employeeStatusLabel
                            ] || e.status}
                          </td>
                        </tr>
                      ))}
                      {filteredEmployees.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-3 py-10 text-center text-slate-500"
                          >
                            Δεν βρέθηκαν εργαζόμενοι με αυτά τα φίλτρα.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              {canWrite ? (
                <form
                  onSubmit={createEmployee}
                  className="soft-panel h-fit space-y-2.5 p-4"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    Νέος εργαζόμενος
                  </h3>
                  {(
                    [
                      ["code", "Κωδικός", true],
                      ["lastName", "Επώνυμο", true],
                      ["firstName", "Όνομα", true],
                      ["vatNumber", "ΑΦΜ", false],
                      ["amka", "ΑΜΚΑ", false],
                      ["ama", "ΑΜΑ ΕΦΚΑ", false],
                      ["iban", "IBAN", false],
                      ["email", "Email", false],
                      ["phone", "Τηλέφωνο", false],
                      ["title", "Τίτλος", false],
                      ["specialty", "Ειδικότητα", false],
                      ["department", "Τμήμα", false],
                      ["address", "Διεύθυνση", false],
                    ] as const
                  ).map(([key, label, required]) => (
                    <label key={key} className={labelCls}>
                      {label}
                      <input
                        required={required}
                        type={key === "email" ? "email" : "text"}
                        value={empForm[key]}
                        onChange={(ev) =>
                          setEmpForm((f) => ({
                            ...f,
                            [key]: ev.target.value,
                          }))
                        }
                        className={inputCls}
                      />
                    </label>
                  ))}
                  <label className={labelCls}>
                    Σύμβαση
                    <select
                      value={empForm.contractType}
                      onChange={(ev) =>
                        setEmpForm((f) => ({
                          ...f,
                          contractType: ev.target.value,
                        }))
                      }
                      className={inputCls}
                    >
                      {Object.entries(contractTypeLabel).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={labelCls}>
                      Ώρες/εβδ.
                      <input
                        type="number"
                        min={0}
                        max={168}
                        step={0.5}
                        value={empForm.weeklyHours}
                        onChange={(ev) =>
                          setEmpForm((f) => ({
                            ...f,
                            weeklyHours: ev.target.value,
                          }))
                        }
                        className={inputCls}
                      />
                    </label>
                    <label className={labelCls}>
                      Μικτό (€)
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={empForm.baseGross}
                        onChange={(ev) =>
                          setEmpForm((f) => ({
                            ...f,
                            baseGross: ev.target.value,
                          }))
                        }
                        className={inputCls}
                      />
                    </label>
                    <label className={labelCls}>
                      Επίδομα (€)
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={empForm.monthlyAllowance}
                        onChange={(ev) =>
                          setEmpForm((f) => ({
                            ...f,
                            monthlyAllowance: ev.target.value,
                          }))
                        }
                        className={inputCls}
                      />
                    </label>
                    <label className={labelCls}>
                      Πρόσληψη
                      <input
                        type="date"
                        value={empForm.hireDate}
                        onChange={(ev) =>
                          setEmpForm((f) => ({
                            ...f,
                            hireDate: ev.target.value,
                          }))
                        }
                        className={inputCls}
                      />
                    </label>
                  </div>
                  {sites.length ? (
                    <label className={labelCls}>
                      Εγκατάσταση
                      <select
                        value={empForm.siteId}
                        onChange={(ev) =>
                          setEmpForm((f) => ({
                            ...f,
                            siteId: ev.target.value,
                          }))
                        }
                        className={inputCls}
                      >
                        <option value="">—</option>
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} · {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <Button
                    type="submit"
                    disabled={busy}
                    className="w-full"
                    size="sm"
                  >
                    Αποθήκευση
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}

          {section === "employee" ? (
            <EmployeeDetailPanel
              employees={filteredEmployees}
              selectedId={selectedEmployeeId}
              onSelect={setSelectedEmployeeId}
              editForm={editForm}
              setEditForm={setEditForm}
              sites={sites}
              canWrite={canWrite}
              busy={busy}
              onSave={saveEmployee}
              onTerminate={terminateEmployee}
              inputCls={inputCls}
              labelCls={labelCls}
            />
          ) : null}

          {section === "leaves" ? (
            <LeavesPanel
              leaveTypes={leaveTypes}
              leaveRequests={leaveRequests}
              activeEmployees={activeEmployees}
              leaveForm={leaveForm}
              setLeaveForm={setLeaveForm}
              canWrite={canWrite}
              busy={busy}
              onCreate={createLeave}
              onDecide={decideLeave}
              filtersQ={filters.q}
              inputCls={inputCls}
              labelCls={labelCls}
            />
          ) : null}

          {section === "balances" ? (
            <section className="soft-panel overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
                Έτος {filters.year} · δικαίωμα (+ προσαρμογές) − εγκεκριμένες
                ημέρες
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="sticky left-0 bg-slate-50 px-3 py-2">
                        Εργαζόμενος
                      </th>
                      {(leaveBalances[0]?.balances ?? []).map((b) => (
                        <th
                          key={b.leaveTypeId}
                          className="px-3 py-2 text-right"
                          title={b.name}
                        >
                          {b.code}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leaveBalances
                      .filter((row) => {
                        const q = filters.q.trim().toLowerCase();
                        if (!q) return true;
                        return empName(row.employee).toLowerCase().includes(q);
                      })
                      .map((row) => (
                        <tr
                          key={row.employee.id}
                          className="border-t border-slate-100"
                        >
                          <td className="sticky left-0 bg-white px-3 py-2 font-medium">
                            {empName(row.employee)}
                          </td>
                          {row.balances.map((b) => (
                            <td
                              key={b.leaveTypeId}
                              className={cn(
                                "px-3 py-2 text-right tabular-nums",
                                b.remaining <= 0
                                  ? "text-rose-700"
                                  : "text-slate-700",
                              )}
                              title={`Χρήση ${b.used} / ${b.entitlement}`}
                            >
                              {b.remaining}
                            </td>
                          ))}
                        </tr>
                      ))}
                    {leaveBalances.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-10 text-center text-slate-500"
                        >
                          Δεν υπάρχουν υπόλοιπα για αυτό το έτος.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {section === "schedules" ? (
            <SchedulesPanel
              schedules={schedules}
              assignments={assignments}
              shifts={filteredShifts}
              activeEmployees={activeEmployees}
              sites={sites}
              canWrite={canWrite}
              busy={busy}
              scheduleForm={scheduleForm}
              setScheduleForm={setScheduleForm}
              assignForm={assignForm}
              setAssignForm={setAssignForm}
              shiftForm={shiftForm}
              setShiftForm={setShiftForm}
              onCreateSchedule={createSchedule}
              onAssign={assignSchedule}
              onCreateShift={createShift}
              inputCls={inputCls}
              labelCls={labelCls}
            />
          ) : null}

          {section === "workcard" ? (
            <WorkCardPanel
              workCards={workCards}
              events={events}
              activeEmployees={activeEmployees}
              sites={sites}
              canWrite={canWrite}
              onRefresh={async () => {
                router.refresh();
              }}
            />
          ) : null}

          {section === "ergani" ? (
            <section className="soft-panel space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">
                  Ουρά δηλώσεων Εργάνη / Ψηφιακή Κάρτα Εργασίας.
                </p>
                {canWrite ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => processErgani()}
                  >
                    Επεξεργασία batch
                  </Button>
                ) : null}
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Ημ/νία</th>
                      <th className="px-3 py-2">Είδος</th>
                      <th className="px-3 py-2">Οντότητα</th>
                      <th className="px-3 py-2">Κατάσταση</th>
                      <th className="px-3 py-2">Αναφ.</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {ergani.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {dt(row.createdAt)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.eventKind}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {row.entityType}
                        </td>
                        <td className="px-3 py-2">
                          <div>
                            {erganiStatusLabel[
                              row.status as keyof typeof erganiStatusLabel
                            ] || row.status}
                          </div>
                          {row.lastError ? (
                            <div className="text-xs text-rose-600">
                              {row.lastError}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                          {row.externalRef || "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canWrite &&
                          row.status !== "ACCEPTED" &&
                          row.status !== "CANCELLED" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => processErgani(row.id)}
                            >
                              Αποστολή
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {ergani.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-10 text-center text-slate-500"
                        >
                          Η ουρά είναι άδεια.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {section === "payroll" ? (
            <PayrollPanel
              payroll={payroll}
              payrollForm={payrollForm}
              setPayrollForm={setPayrollForm}
              payrollDetail={payrollDetail}
              setPayrollDetail={setPayrollDetail}
              lineGrossEdit={lineGrossEdit}
              setLineGrossEdit={setLineGrossEdit}
              canWrite={canWrite}
              busy={busy}
              onCreate={createPayroll}
              onOpen={openPayroll}
              onClose={closePayroll}
              onSaveLine={savePayrollLine}
              inputCls={inputCls}
              labelCls={labelCls}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OverviewPanel({
  kpis,
  leaveRequests,
  ergani,
  onGo,
}: {
  kpis: {
    headcount: number;
    pendingLeave: number;
    activeCards: number;
    pendingErgani: number;
    draftPayroll: number;
  };
  leaveRequests: LeaveRequest[];
  ergani: ErganiRow[];
  onGo: (s: Section) => void;
}) {
  const todos = [
    kpis.pendingLeave > 0
      ? {
          label: `${kpis.pendingLeave} άδειες σε αναμονή`,
          target: "leaves" as Section,
          tone: "rose" as const,
        }
      : null,
    kpis.pendingErgani > 0
      ? {
          label: `${kpis.pendingErgani} δηλώσεις Εργάνη στην ουρά`,
          target: "ergani" as Section,
          tone: "amber" as const,
        }
      : null,
    kpis.draftPayroll > 0
      ? {
          label: `${kpis.draftPayroll} πρόχειρες περίοδοι μισθοδοσίας`,
          target: "payroll" as Section,
          tone: "rose" as const,
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    target: Section;
    tone: "rose" | "amber";
  }>;

  const recentLeave = leaveRequests.slice(0, 5);
  const recentErgani = ergani.slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ["Ενεργό προσωπικό", kpis.headcount, "employees"],
            ["Άδειες σε αναμονή", kpis.pendingLeave, "leaves"],
            ["Ενεργές κάρτες", kpis.activeCards, "workcard"],
            ["Ουρά Εργάνη", kpis.pendingErgani, "ergani"],
          ] as Array<[string, number, Section]>
        ).map(([label, value, target]) => (
          <button
            key={label}
            type="button"
            onClick={() => onGo(target)}
            className="soft-panel rounded-2xl px-4 py-3 text-left transition hover:border-teal-300"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--hr-ink)]">
              {value}
            </p>
          </button>
        ))}
      </div>

      <section className="soft-panel p-4">
        <h3 className="text-sm font-semibold">Προς ενέργεια</h3>
        {todos.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Καμία εκκρεμότητα — όλα εντάξει.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {todos.map((t) => (
              <li key={t.label}>
                <button
                  type="button"
                  onClick={() => onGo(t.target)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-left text-sm hover:border-teal-200"
                >
                  <span>{t.label}</span>
                  <Badge tone={t.tone}>Άνοιγμα</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ["Ημερολόγιο", "calendar"],
              ["Σήμερα", "pulse"],
              ["Οργανόγραμμα", "directory"],
              ["Εργαζόμενοι", "employees"],
              ["Υπόλοιπα", "balances"],
              ["Onboarding", "onboarding"],
              ["Έγγραφα", "documents"],
              ["Ωράρια", "schedules"],
              ["Κάρτα QR", "workcard"],
              ["Μισθοδοσία", "payroll"],
            ] as Array<[string, Section]>
          ).map(([label, id]) => (
            <Button
              key={id}
              size="sm"
              variant="secondary"
              onClick={() => onGo(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="soft-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Πρόσφατες άδειες</h3>
            <button
              type="button"
              className="text-xs text-teal-700"
              onClick={() => onGo("leaves")}
            >
              Όλες
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {recentLeave.map((r) => (
              <li
                key={r.id}
                className="flex justify-between gap-2 border-b border-slate-50 pb-2 last:border-0"
              >
                <span>
                  {empName(r.employee)} · {r.leaveType.name}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {leaveRequestStatusLabel[
                    r.status as keyof typeof leaveRequestStatusLabel
                  ] || r.status}
                </span>
              </li>
            ))}
            {recentLeave.length === 0 ? (
              <li className="text-slate-500">Καμία αίτηση.</li>
            ) : null}
          </ul>
        </section>
        <section className="soft-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Πρόσφατη Εργάνη</h3>
            <button
              type="button"
              className="text-xs text-teal-700"
              onClick={() => onGo("ergani")}
            >
              Ουρά
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {recentErgani.map((r) => (
              <li
                key={r.id}
                className="flex justify-between gap-2 border-b border-slate-50 pb-2 last:border-0"
              >
                <span className="font-mono text-xs">{r.eventKind}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {erganiStatusLabel[
                    r.status as keyof typeof erganiStatusLabel
                  ] || r.status}
                </span>
              </li>
            ))}
            {recentErgani.length === 0 ? (
              <li className="text-slate-500">Άδεια ουρά.</li>
            ) : null}
          </ul>
        </section>
      </div>
    </div>
  );
}

function EmployeeDetailPanel({
  employees,
  selectedId,
  onSelect,
  editForm,
  setEditForm,
  sites,
  canWrite,
  busy,
  onSave,
  onTerminate,
  inputCls,
  labelCls,
}: {
  employees: Employee[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  editForm: ReturnType<typeof employeeToEditForm> | null;
  setEditForm: Dispatch<
    SetStateAction<ReturnType<typeof employeeToEditForm> | null>
  >;
  sites: SiteOpt[];
  canWrite: boolean;
  busy: boolean;
  onSave: (e: FormEvent) => void;
  onTerminate: () => void;
  inputCls: string;
  labelCls: string;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
      <section className="soft-panel max-h-[70vh] overflow-y-auto p-2">
        <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Επιλογή
        </p>
        <ul className="space-y-0.5">
          {employees.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelect(e.id)}
                className={cn(
                  "w-full rounded-xl px-2.5 py-2 text-left text-sm transition",
                  selectedId === e.id
                    ? "bg-teal-800 text-white"
                    : "hover:bg-slate-100",
                )}
              >
                <div className="font-medium">
                  {e.lastName} {e.firstName}
                </div>
                <div
                  className={cn(
                    "text-[11px]",
                    selectedId === e.id ? "text-white/70" : "text-slate-500",
                  )}
                >
                  {e.code} ·{" "}
                  {employeeStatusLabel[
                    e.status as keyof typeof employeeStatusLabel
                  ] || e.status}
                </div>
              </button>
            </li>
          ))}
          {employees.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-slate-500">
              Καμία εγγραφή με τα φίλτρα.
            </li>
          ) : null}
        </ul>
      </section>

      {editForm && selectedId ? (
        <form onSubmit={onSave} className="soft-panel space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {editForm.lastName} {editForm.firstName}
            </h3>
            <Badge
              tone={
                editForm.status === "ACTIVE"
                  ? "emerald"
                  : editForm.status === "TERMINATED"
                    ? "rose"
                    : "slate"
              }
            >
              {employeeStatusLabel[
                editForm.status as keyof typeof employeeStatusLabel
              ] || editForm.status}
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["code", "Κωδικός"],
                ["lastName", "Επώνυμο"],
                ["firstName", "Όνομα"],
                ["vatNumber", "ΑΦΜ"],
                ["amka", "ΑΜΚΑ"],
                ["ama", "ΑΜΑ"],
                ["iban", "IBAN"],
                ["email", "Email"],
                ["phone", "Τηλέφωνο"],
                ["title", "Τίτλος"],
                ["specialty", "Ειδικότητα"],
                ["department", "Τμήμα"],
                ["address", "Διεύθυνση"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className={labelCls}>
                {label}
                <input
                  disabled={!canWrite}
                  value={editForm[key]}
                  onChange={(ev) =>
                    setEditForm((f) =>
                      f ? { ...f, [key]: ev.target.value } : f,
                    )
                  }
                  className={inputCls}
                />
              </label>
            ))}
            <label className={labelCls}>
              Σύμβαση
              <select
                disabled={!canWrite}
                value={editForm.contractType}
                onChange={(ev) =>
                  setEditForm((f) =>
                    f ? { ...f, contractType: ev.target.value } : f,
                  )
                }
                className={inputCls}
              >
                {Object.entries(contractTypeLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Ώρες/εβδ.
              <input
                disabled={!canWrite}
                type="number"
                value={editForm.weeklyHours}
                onChange={(ev) =>
                  setEditForm((f) =>
                    f ? { ...f, weeklyHours: ev.target.value } : f,
                  )
                }
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              Μικτό (€)
              <input
                disabled={!canWrite}
                type="number"
                step={0.01}
                value={editForm.baseGross}
                onChange={(ev) =>
                  setEditForm((f) =>
                    f ? { ...f, baseGross: ev.target.value } : f,
                  )
                }
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              Επίδομα (€)
              <input
                disabled={!canWrite}
                type="number"
                step={0.01}
                value={editForm.monthlyAllowance}
                onChange={(ev) =>
                  setEditForm((f) =>
                    f ? { ...f, monthlyAllowance: ev.target.value } : f,
                  )
                }
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              Πρόσληψη
              <input
                disabled={!canWrite}
                type="date"
                value={editForm.hireDate}
                onChange={(ev) =>
                  setEditForm((f) =>
                    f ? { ...f, hireDate: ev.target.value } : f,
                  )
                }
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              Γέννηση
              <input
                disabled={!canWrite}
                type="date"
                value={editForm.birthDate}
                onChange={(ev) =>
                  setEditForm((f) =>
                    f ? { ...f, birthDate: ev.target.value } : f,
                  )
                }
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              Αποχώρηση
              <input
                disabled={!canWrite}
                type="date"
                value={editForm.terminationDate}
                onChange={(ev) =>
                  setEditForm((f) =>
                    f ? { ...f, terminationDate: ev.target.value } : f,
                  )
                }
                className={inputCls}
              />
            </label>
            {sites.length ? (
              <label className={labelCls}>
                Εγκατάσταση
                <select
                  disabled={!canWrite}
                  value={editForm.siteId}
                  onChange={(ev) =>
                    setEditForm((f) =>
                      f ? { ...f, siteId: ev.target.value } : f,
                    )
                  }
                  className={inputCls}
                >
                  <option value="">—</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
              Σημειώσεις
              <textarea
                disabled={!canWrite}
                rows={2}
                value={editForm.notes}
                onChange={(ev) =>
                  setEditForm((f) =>
                    f ? { ...f, notes: ev.target.value } : f,
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                Αποθήκευση
              </Button>
              {editForm.status !== "TERMINATED" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={onTerminate}
                >
                  Αποχώρηση
                </Button>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : (
        <section className="soft-panel flex items-center justify-center p-10 text-sm text-slate-500">
          Επίλεξε εργαζόμενο από τη λίστα ή από το μητρώο.
        </section>
      )}
    </div>
  );
}

function LeavesPanel({
  leaveTypes,
  leaveRequests,
  activeEmployees,
  leaveForm,
  setLeaveForm,
  canWrite,
  busy,
  onCreate,
  onDecide,
  filtersQ,
  inputCls,
  labelCls,
}: {
  leaveTypes: LeaveType[];
  leaveRequests: LeaveRequest[];
  activeEmployees: Employee[];
  leaveForm: {
    employeeId: string;
    leaveTypeId: string;
    fromDate: string;
    toDate: string;
    halfDay: boolean;
    notes: string;
  };
  setLeaveForm: Dispatch<
    SetStateAction<{
      employeeId: string;
      leaveTypeId: string;
      fromDate: string;
      toDate: string;
      halfDay: boolean;
      notes: string;
    }>
  >;
  canWrite: boolean;
  busy: boolean;
  onCreate: (e: FormEvent) => void;
  onDecide: (
    id: string,
    status: "APPROVED" | "REJECTED" | "CANCELLED",
  ) => void;
  filtersQ: string;
  inputCls: string;
  labelCls: string;
}) {
  const q = filtersQ.trim().toLowerCase();
  const rows = leaveRequests.filter((r) => {
    if (!q) return true;
    return (
      empName(r.employee).toLowerCase().includes(q) ||
      r.leaveType.name.toLowerCase().includes(q)
    );
  });
  const activeTypes = leaveTypes.filter((t) => t.isActive);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <section className="soft-panel p-3">
          <p className="mb-2 text-xs font-medium uppercase text-slate-500">
            Τύποι αδειών
          </p>
          <div className="flex flex-wrap gap-2">
            {activeTypes.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              >
                <div className="font-medium text-slate-900">{t.name}</div>
                <div className="text-xs text-slate-500">
                  {t.daysPerYear} ημ/έτος ·{" "}
                  {t.isPaid ? "Έμμισθη" : "Άνευ αποδοχών"}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="soft-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Εργαζόμενος</th>
                  <th className="px-3 py-2">Τύπος</th>
                  <th className="px-3 py-2">Διάστημα</th>
                  <th className="px-3 py-2">Ημέρες</th>
                  <th className="px-3 py-2">Κατάσταση</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{empName(r.employee)}</td>
                    <td className="px-3 py-2">{r.leaveType.name}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {day(r.fromDate)} – {day(r.toDate)}
                      {r.halfDay ? (
                        <span className="ml-1 text-[10px] text-slate-400">
                          ½ ημέρα
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.days}</td>
                    <td className="px-3 py-2">
                      {leaveRequestStatusLabel[
                        r.status as keyof typeof leaveRequestStatusLabel
                      ] || r.status}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canWrite && r.status === "PENDING" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => onDecide(r.id, "APPROVED")}
                          >
                            Έγκριση
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => onDecide(r.id, "REJECTED")}
                          >
                            Απόρριψη
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onDecide(r.id, "CANCELLED")}
                          >
                            Ακύρωση
                          </Button>
                        </div>
                      ) : canWrite &&
                        (r.status === "APPROVED" || r.status === "DRAFT") ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => onDecide(r.id, "CANCELLED")}
                        >
                          Ακύρωση
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-slate-500"
                    >
                      Δεν υπάρχουν αιτήσεις αδειών.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {canWrite ? (
        <form onSubmit={onCreate} className="soft-panel h-fit space-y-3 p-4">
          <h3 className="text-sm font-semibold">Νέα αίτηση άδειας</h3>
          <label className={labelCls}>
            Εργαζόμενος
            <select
              required
              value={leaveForm.employeeId}
              onChange={(ev) =>
                setLeaveForm((f) => ({ ...f, employeeId: ev.target.value }))
              }
              className={inputCls}
            >
              <option value="">—</option>
              {activeEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empName(e)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Τύπος
            <select
              required
              value={leaveForm.leaveTypeId}
              onChange={(ev) =>
                setLeaveForm((f) => ({ ...f, leaveTypeId: ev.target.value }))
              }
              className={inputCls}
            >
              <option value="">—</option>
              {activeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Από
            <input
              required
              type="date"
              value={leaveForm.fromDate}
              onChange={(ev) =>
                setLeaveForm((f) => ({ ...f, fromDate: ev.target.value }))
              }
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Έως
            <input
              required
              type="date"
              value={leaveForm.toDate}
              onChange={(ev) =>
                setLeaveForm((f) => ({ ...f, toDate: ev.target.value }))
              }
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={leaveForm.halfDay}
              onChange={(ev) =>
                setLeaveForm((f) => ({
                  ...f,
                  halfDay: ev.target.checked,
                  toDate: ev.target.checked ? f.fromDate || f.toDate : f.toDate,
                }))
              }
            />
            Μισή ημέρα (0.5)
          </label>
          <label className={labelCls}>
            Σημειώσεις
            <textarea
              value={leaveForm.notes}
              onChange={(ev) =>
                setLeaveForm((f) => ({ ...f, notes: ev.target.value }))
              }
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <p className="text-[11px] text-slate-500">
            Έλεγχος επικάλυψης, υπολοίπου και αργιών/blackout πριν την υποβολή.
          </p>
          <Button type="submit" disabled={busy} className="w-full" size="sm">
            Υποβολή
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function SchedulesPanel({
  schedules,
  assignments,
  shifts,
  activeEmployees,
  sites,
  canWrite,
  busy,
  scheduleForm,
  setScheduleForm,
  assignForm,
  setAssignForm,
  shiftForm,
  setShiftForm,
  onCreateSchedule,
  onAssign,
  onCreateShift,
  inputCls,
  labelCls,
}: {
  schedules: Schedule[];
  assignments: Assignment[];
  shifts: Shift[];
  activeEmployees: Employee[];
  sites: SiteOpt[];
  canWrite: boolean;
  busy: boolean;
  scheduleForm: {
    code: string;
    name: string;
    workDays: number;
    startTime: string;
    endTime: string;
    breakMinutes: string;
    weeklyHours: string;
  };
  setScheduleForm: Dispatch<
    SetStateAction<{
      code: string;
      name: string;
      workDays: number;
      startTime: string;
      endTime: string;
      breakMinutes: string;
      weeklyHours: string;
    }>
  >;
  assignForm: {
    employeeId: string;
    scheduleId: string;
    fromDate: string;
    toDate: string;
  };
  setAssignForm: Dispatch<
    SetStateAction<{
      employeeId: string;
      scheduleId: string;
      fromDate: string;
      toDate: string;
    }>
  >;
  shiftForm: {
    employeeId: string;
    workDate: string;
    startTime: string;
    endTime: string;
    breakMinutes: string;
    kind: string;
    siteId: string;
    notes: string;
  };
  setShiftForm: Dispatch<
    SetStateAction<{
      employeeId: string;
      workDate: string;
      startTime: string;
      endTime: string;
      breakMinutes: string;
      kind: string;
      siteId: string;
      notes: string;
    }>
  >;
  onCreateSchedule: (e: FormEvent) => void;
  onAssign: (e: FormEvent) => void;
  onCreateShift: (e: FormEvent) => void;
  inputCls: string;
  labelCls: string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-3">
        {canWrite ? (
          <form
            onSubmit={onCreateSchedule}
            className="soft-panel space-y-2.5 p-4"
          >
            <h3 className="text-sm font-semibold">Νέο πρότυπο ωραρίου</h3>
            <label className={labelCls}>
              Κωδικός
              <input
                required
                value={scheduleForm.code}
                onChange={(ev) =>
                  setScheduleForm((f) => ({ ...f, code: ev.target.value }))
                }
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              Όνομα
              <input
                required
                value={scheduleForm.name}
                onChange={(ev) =>
                  setScheduleForm((f) => ({ ...f, name: ev.target.value }))
                }
                className={inputCls}
              />
            </label>
            <div>
              <p className="text-xs text-slate-600">Ημέρες εργασίας</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {WEEKDAY_BITS.map((d) => {
                  const on = (scheduleForm.workDays & d.bit) !== 0;
                  return (
                    <button
                      key={d.bit}
                      type="button"
                      onClick={() =>
                        setScheduleForm((f) => ({
                          ...f,
                          workDays: on
                            ? f.workDays & ~d.bit
                            : f.workDays | d.bit,
                        }))
                      }
                      className={cn(
                        "rounded-lg px-2 py-1 text-xs font-medium",
                        on
                          ? "bg-teal-800 text-white"
                          : "border border-slate-200 bg-white text-slate-600",
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelCls}>
                Έναρξη
                <input
                  required
                  type="time"
                  value={scheduleForm.startTime}
                  onChange={(ev) =>
                    setScheduleForm((f) => ({
                      ...f,
                      startTime: ev.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </label>
              <label className={labelCls}>
                Λήξη
                <input
                  required
                  type="time"
                  value={scheduleForm.endTime}
                  onChange={(ev) =>
                    setScheduleForm((f) => ({
                      ...f,
                      endTime: ev.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </label>
              <label className={labelCls}>
                Διάλειμμα (λ)
                <input
                  type="number"
                  min={0}
                  value={scheduleForm.breakMinutes}
                  onChange={(ev) =>
                    setScheduleForm((f) => ({
                      ...f,
                      breakMinutes: ev.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </label>
              <label className={labelCls}>
                Ώρες/εβδ.
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={scheduleForm.weeklyHours}
                  onChange={(ev) =>
                    setScheduleForm((f) => ({
                      ...f,
                      weeklyHours: ev.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </label>
            </div>
            <Button type="submit" size="sm" disabled={busy} className="w-full">
              Δημιουργία προτύπου
            </Button>
          </form>
        ) : null}

        {canWrite ? (
          <form onSubmit={onAssign} className="soft-panel space-y-2.5 p-4">
            <h3 className="text-sm font-semibold">Ανάθεση ωραρίου</h3>
            <label className={labelCls}>
              Εργαζόμενος
              <select
                required
                value={assignForm.employeeId}
                onChange={(ev) =>
                  setAssignForm((f) => ({
                    ...f,
                    employeeId: ev.target.value,
                  }))
                }
                className={inputCls}
              >
                <option value="">—</option>
                {activeEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {empName(e)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Πρότυπο
              <select
                required
                value={assignForm.scheduleId}
                onChange={(ev) =>
                  setAssignForm((f) => ({
                    ...f,
                    scheduleId: ev.target.value,
                  }))
                }
                className={inputCls}
              >
                <option value="">—</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Από
              <input
                required
                type="date"
                value={assignForm.fromDate}
                onChange={(ev) =>
                  setAssignForm((f) => ({ ...f, fromDate: ev.target.value }))
                }
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              Έως (προαιρετικά)
              <input
                type="date"
                value={assignForm.toDate}
                onChange={(ev) =>
                  setAssignForm((f) => ({ ...f, toDate: ev.target.value }))
                }
                className={inputCls}
              />
            </label>
            <Button type="submit" size="sm" disabled={busy} className="w-full">
              Ανάθεση
            </Button>
          </form>
        ) : null}

        {canWrite ? (
          <form onSubmit={onCreateShift} className="soft-panel space-y-2.5 p-4">
            <h3 className="text-sm font-semibold">Νέα βάρδια</h3>
            <label className={labelCls}>
              Εργαζόμενος
              <select
                required
                value={shiftForm.employeeId}
                onChange={(ev) =>
                  setShiftForm((f) => ({
                    ...f,
                    employeeId: ev.target.value,
                  }))
                }
                className={inputCls}
              >
                <option value="">—</option>
                {activeEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {empName(e)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Ημερομηνία
              <input
                required
                type="date"
                value={shiftForm.workDate}
                onChange={(ev) =>
                  setShiftForm((f) => ({ ...f, workDate: ev.target.value }))
                }
                className={inputCls}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelCls}>
                Έναρξη
                <input
                  required
                  type="time"
                  value={shiftForm.startTime}
                  onChange={(ev) =>
                    setShiftForm((f) => ({
                      ...f,
                      startTime: ev.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </label>
              <label className={labelCls}>
                Λήξη
                <input
                  required
                  type="time"
                  value={shiftForm.endTime}
                  onChange={(ev) =>
                    setShiftForm((f) => ({ ...f, endTime: ev.target.value }))
                  }
                  className={inputCls}
                />
              </label>
            </div>
            <label className={labelCls}>
              Είδος
              <select
                value={shiftForm.kind}
                onChange={(ev) =>
                  setShiftForm((f) => ({ ...f, kind: ev.target.value }))
                }
                className={inputCls}
              >
                {Object.entries(workShiftKindLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {sites.length ? (
              <label className={labelCls}>
                Εγκατάσταση
                <select
                  value={shiftForm.siteId}
                  onChange={(ev) =>
                    setShiftForm((f) => ({ ...f, siteId: ev.target.value }))
                  }
                  className={inputCls}
                >
                  <option value="">—</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button type="submit" size="sm" disabled={busy} className="w-full">
              Καταχώρηση βάρδιας
            </Button>
          </form>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="soft-panel overflow-hidden">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase text-slate-500">
            Πρότυπα ωραρίων
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Κωδικός</th>
                <th className="px-3 py-2">Ημέρες</th>
                <th className="px-3 py-2">Ώρες</th>
                <th className="px-3 py-2 text-right">Αναθέσεις</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.code}</div>
                    <div className="text-xs text-slate-500">{s.name}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {formatWorkDays(s.workDays)}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {s.startTime}–{s.endTime}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.assignmentCount}
                  </td>
                </tr>
              ))}
              {schedules.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Δεν υπάρχουν πρότυπα.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="soft-panel overflow-hidden">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase text-slate-500">
            Αναθέσεις
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Εργαζόμενος</th>
                <th className="px-3 py-2">Ωράριο</th>
                <th className="px-3 py-2">Από</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{empName(a.employee)}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.schedule.code} · {formatWorkDays(a.schedule.workDays)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {day(a.fromDate)}
                    {a.toDate ? ` – ${day(a.toDate)}` : ""}
                  </td>
                </tr>
              ))}
              {assignments.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Δεν υπάρχουν αναθέσεις.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>

      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase text-slate-500">
          Βάρδιες
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Ημ/νία</th>
                <th className="px-3 py-2">Εργαζόμενος</th>
                <th className="px-3 py-2">Ώρες</th>
                <th className="px-3 py-2">Είδος</th>
                <th className="px-3 py-2">Εγκατάσταση</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-xs">{day(s.workDate)}</td>
                  <td className="px-3 py-2">{empName(s.employee)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {s.startTime}–{s.endTime}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {workShiftKindLabel[
                      s.kind as keyof typeof workShiftKindLabel
                    ] || s.kind}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {s.site ? `${s.site.code}` : "—"}
                  </td>
                </tr>
              ))}
              {shifts.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Δεν υπάρχουν βάρδιες στο διάστημα φίλτρου.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PayrollPanel({
  payroll,
  payrollForm,
  setPayrollForm,
  payrollDetail,
  setPayrollDetail,
  lineGrossEdit,
  setLineGrossEdit,
  canWrite,
  busy,
  onCreate,
  onOpen,
  onClose,
  onSaveLine,
  inputCls,
  labelCls,
}: {
  payroll: PayrollPeriod[];
  payrollForm: { year: string; month: string; defaultGross: string };
  setPayrollForm: Dispatch<
    SetStateAction<{
      year: string;
      month: string;
      defaultGross: string;
    }>
  >;
  payrollDetail: {
    id: string;
    code: string;
    status: string;
    lines: Array<{
      id: string;
      employeeId: string;
      employee: { lastName: string; firstName: string; code: string };
      gross: number;
      employeeEfka: number;
      employerEfka: number;
      tax: number;
      net: number;
    }>;
  } | null;
  setPayrollDetail: Dispatch<
    SetStateAction<{
      id: string;
      code: string;
      status: string;
      lines: Array<{
        id: string;
        employeeId: string;
        employee: { lastName: string; firstName: string; code: string };
        gross: number;
        employeeEfka: number;
        employerEfka: number;
        tax: number;
        net: number;
      }>;
    } | null>
  >;
  lineGrossEdit: Record<string, string>;
  setLineGrossEdit: Dispatch<
    SetStateAction<Record<string, string>>
  >;
  canWrite: boolean;
  busy: boolean;
  onCreate: (e: FormEvent) => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onSaveLine: (employeeId: string) => void;
  inputCls: string;
  labelCls: string;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      {canWrite ? (
        <form onSubmit={onCreate} className="soft-panel h-fit space-y-3 p-4">
          <h3 className="text-sm font-semibold">Νέα περίοδος</h3>
          <p className="text-xs text-slate-500">
            Ενδεικτικός υπολογισμός ΕΦΚΑ / φόρου για ενεργούς εργαζομένους
          </p>
          <label className={labelCls}>
            Έτος
            <input
              required
              type="number"
              min={2000}
              max={2100}
              value={payrollForm.year}
              onChange={(ev) =>
                setPayrollForm((f) => ({ ...f, year: ev.target.value }))
              }
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Μήνας
            <input
              required
              type="number"
              min={1}
              max={12}
              value={payrollForm.month}
              onChange={(ev) =>
                setPayrollForm((f) => ({ ...f, month: ev.target.value }))
              }
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Προεπιλεγμένο μικτό (€)
            <input
              required
              type="number"
              min={0}
              step={0.01}
              value={payrollForm.defaultGross}
              onChange={(ev) =>
                setPayrollForm((f) => ({
                  ...f,
                  defaultGross: ev.target.value,
                }))
              }
              className={inputCls}
            />
          </label>
          <Button type="submit" size="sm" disabled={busy} className="w-full">
            Δημιουργία
          </Button>
        </form>
      ) : (
        <div />
      )}

      <div className="space-y-3">
        <section className="soft-panel overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Περίοδος</th>
                <th className="px-3 py-2">Κατάσταση</th>
                <th className="px-3 py-2 text-right">Γραμμές</th>
                <th className="px-3 py-2 text-right">Μικτά</th>
                <th className="px-3 py-2 text-right">ΕΦΚΑ</th>
                <th className="px-3 py-2 text-right">Φόρος</th>
                <th className="px-3 py-2 text-right">Καθαρά</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {payroll.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{p.code}</td>
                  <td className="px-3 py-2">
                    {payrollPeriodStatusLabel[
                      p.status as keyof typeof payrollPeriodStatusLabel
                    ] || p.status}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.lineCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(p.totals.gross)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {money(p.totals.employeeEfka + p.totals.employerEfka)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(p.totals.tax)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {money(p.totals.net)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onOpen(p.id)}
                    >
                      Άνοιγμα
                    </Button>
                  </td>
                </tr>
              ))}
              {payroll.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-10 text-center text-slate-500"
                  >
                    Δεν υπάρχουν περίοδοι μισθοδοσίας.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        {payrollDetail ? (
          <section className="soft-panel overflow-hidden border border-teal-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <div className="text-sm font-semibold">
                Περίοδος {payrollDetail.code}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    window.open(
                      `/api/hr/payroll/periods/${payrollDetail.id}/export?format=bank`,
                      "_blank",
                    );
                  }}
                >
                  Export τράπεζας
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    window.open(
                      `/api/hr/payroll/periods/${payrollDetail.id}/export?format=fmy`,
                      "_blank",
                    );
                  }}
                >
                  ΦΜΥ / ΑΠΔ lite
                </Button>
                {canWrite && payrollDetail.status === "DRAFT" ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => onClose(payrollDetail.id)}
                  >
                    Κλείσιμο περιόδου
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPayrollDetail(null)}
                >
                  Κλείσιμο
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Εργαζόμενος</th>
                    <th className="px-3 py-2 text-right">Μικτά</th>
                    <th className="px-3 py-2 text-right">ΕΦΚΑ εργαζ.</th>
                    <th className="px-3 py-2 text-right">ΕΦΚΑ εργοδ.</th>
                    <th className="px-3 py-2 text-right">Φόρος</th>
                    <th className="px-3 py-2 text-right">Καθαρά</th>
                    {canWrite && payrollDetail.status === "DRAFT" ? (
                      <th className="px-3 py-2" />
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {payrollDetail.lines.map((l) => (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{empName(l.employee)}</td>
                      <td className="px-3 py-2 text-right">
                        {canWrite && payrollDetail.status === "DRAFT" ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            className="ml-auto h-8 w-28 rounded-lg border border-slate-200 px-2 text-right text-sm"
                            value={
                              lineGrossEdit[l.employeeId] ?? String(l.gross)
                            }
                            onChange={(ev) =>
                              setLineGrossEdit((m) => ({
                                ...m,
                                [l.employeeId]: ev.target.value,
                              }))
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{money(l.gross)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(l.employeeEfka)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(l.employerEfka)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(l.tax)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {money(l.net)}
                      </td>
                      {canWrite && payrollDetail.status === "DRAFT" ? (
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onSaveLine(l.employeeId)}
                          >
                            Αποθήκευση
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
