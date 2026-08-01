"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  contractTypeLabel,
  employeeStatusLabel,
  erganiStatusLabel,
  leaveRequestStatusLabel,
  payrollPeriodStatusLabel,
  workCardEventTypeLabel,
  workCardStatusLabel,
} from "@/modules/hr/labels";

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
  contractType: string;
  weeklyHours: number | null;
  siteId: string | null;
  hireDate: string | null;
  erganiEmployeeId: string | null;
  status: string;
};

type LeaveType = {
  id: string;
  code: string;
  name: string;
  daysPerYear: number;
  isPaid: boolean;
};

type LeaveRequest = {
  id: string;
  days: number;
  status: string;
  fromDate: string;
  toDate: string;
  notes: string | null;
  employee: { id: string; code: string; firstName: string; lastName: string };
  leaveType: { id: string; code: string; name: string; isPaid: boolean };
};

type WorkCard = {
  id: string;
  cardNumber: string;
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
  employee: { id: string; code: string; firstName: string; lastName: string };
  workCard: { id: string; cardNumber: string } | null;
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

type Tab = "employees" | "leave" | "card" | "ergani" | "payroll";

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
  contractType: "INDEFINITE",
  weeklyHours: "40",
  siteId: "",
  hireDate: "",
};

export function HrClient({
  initialEmployees,
  initialLeaveTypes,
  initialLeaveRequests,
  initialWorkCards,
  initialEvents,
  initialErgani,
  initialPayroll,
  sites,
}: {
  initialEmployees: Employee[];
  initialLeaveTypes: LeaveType[];
  initialLeaveRequests: LeaveRequest[];
  initialWorkCards: WorkCard[];
  initialEvents: WorkCardEvent[];
  initialErgani: ErganiRow[];
  initialPayroll: PayrollPeriod[];
  sites: SiteOpt[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("employees");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [employees, setEmployees] = useState(initialEmployees);
  const [leaveTypes, setLeaveTypes] = useState(initialLeaveTypes);
  const [leaveRequests, setLeaveRequests] = useState(initialLeaveRequests);
  const [workCards, setWorkCards] = useState(initialWorkCards);
  const [events, setEvents] = useState(initialEvents);
  const [ergani, setErgani] = useState(initialErgani);
  const [payroll, setPayroll] = useState(initialPayroll);

  const [empForm, setEmpForm] = useState(emptyEmployeeForm);
  const [leaveForm, setLeaveForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    fromDate: "",
    toDate: "",
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
    note: "",
  });
  const [payrollForm, setPayrollForm] = useState({
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1),
    defaultGross: "1200",
  });
  const [payrollDetail, setPayrollDetail] = useState<{
    id: string;
    code: string;
    status: string;
    lines: Array<{
      id: string;
      employee: { lastName: string; firstName: string; code: string };
      gross: number;
      employeeEfka: number;
      employerEfka: number;
      tax: number;
      net: number;
    }>;
  } | null>(null);

  useEffect(() => {
    setEmployees(initialEmployees);
    setLeaveTypes(initialLeaveTypes);
    setLeaveRequests(initialLeaveRequests);
    setWorkCards(initialWorkCards);
    setEvents(initialEvents);
    setErgani(initialErgani);
    setPayroll(initialPayroll);
  }, [
    initialEmployees,
    initialLeaveTypes,
    initialLeaveRequests,
    initialWorkCards,
    initialEvents,
    initialErgani,
    initialPayroll,
  ]);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === "ACTIVE"),
    [employees],
  );

  const kpis = useMemo(() => {
    const pendingLeave = leaveRequests.filter((r) => r.status === "PENDING")
      .length;
    const pendingErgani = ergani.filter(
      (r) => r.status === "PENDING" || r.status === "SENT" || r.status === "REJECTED",
    ).length;
    const activeCards = workCards.filter((c) => c.status === "ACTIVE").length;
    return {
      headcount: activeEmployees.length,
      pendingLeave,
      activeCards,
      pendingErgani,
    };
  }, [activeEmployees, leaveRequests, workCards, ergani]);

  async function run(
    fn: () => Promise<void>,
    okMessage?: string,
  ) {
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
          weeklyHours: empForm.weeklyHours
            ? Number(empForm.weeklyHours)
            : null,
          siteId: empForm.siteId || null,
          hireDate: empForm.hireDate || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setEmpForm(emptyEmployeeForm);
    }, "Ο εργαζόμενος καταχωρήθηκε · δηλώθηκε στην ουρά Εργάνη");
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
        notes: "",
      });
    }, "Η αίτηση άδειας υποβλήθηκε");
  }

  async function decideLeave(id: string, status: "APPROVED" | "REJECTED") {
    await run(async () => {
      const res = await fetch(`/api/hr/leave-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
    }, status === "APPROVED" ? "Εγκρίθηκε" : "Απορρίφθηκε");
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
    }, "Εκδόθηκε κάρτα εργασίας · ουρά Εργάνη");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
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

  const tabs: Array<[Tab, string]> = [
    ["employees", `Εργαζόμενοι · ${kpis.headcount}`],
    ["leave", `Άδειες · ${kpis.pendingLeave}`],
    ["card", `Κάρτα εργασίας · ${kpis.activeCards}`],
    ["ergani", `Εργάνη · ${kpis.pendingErgani}`],
    ["payroll", `Μισθοδοσία · ${payroll.length}`],
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Ενεργό προσωπικό", kpis.headcount],
            ["Άδειες σε αναμονή", kpis.pendingLeave],
            ["Ενεργές κάρτες", kpis.activeCards],
            ["Ουρά Εργάνη", kpis.pendingErgani],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === key
                ? "bg-teal-800 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      {tab === "employees" ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Κωδικός</th>
                  <th className="px-3 py-2">Ονοματεπώνυμο</th>
                  <th className="px-3 py-2">ΑΦΜ / ΑΜΚΑ</th>
                  <th className="px-3 py-2">Σύμβαση</th>
                  <th className="px-3 py-2">Εργάνη</th>
                  <th className="px-3 py-2">Κατάσταση</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">{e.code}</td>
                    <td className="px-3 py-2 font-medium">
                      {e.lastName} {e.firstName}
                      {e.title || e.department ? (
                        <div className="text-xs font-normal text-slate-500">
                          {[e.title, e.department].filter(Boolean).join(" · ")}
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
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                      {e.erganiEmployeeId || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {employeeStatusLabel[
                        e.status as keyof typeof employeeStatusLabel
                      ] || e.status}
                    </td>
                  </tr>
                ))}
                {employees.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-slate-500"
                    >
                      Δεν υπάρχουν εργαζόμενοι ακόμη.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={createEmployee}
            className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold text-slate-900">
              Νέος εργαζόμενος
            </h2>
            <p className="text-xs text-slate-500">
              ΑΦΜ / ΑΜΚΑ / ΑΜΑ ΕΦΚΑ · σύμβαση · αυτόματη ουρά Εργάνη
            </p>
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
                ["department", "Τμήμα", false],
              ] as const
            ).map(([key, label, required]) => (
              <label key={key} className="block text-xs text-slate-600">
                {label}
                <input
                  required={required}
                  type={key === "email" ? "email" : "text"}
                  value={empForm[key]}
                  onChange={(ev) =>
                    setEmpForm((f) => ({ ...f, [key]: ev.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                />
              </label>
            ))}
            <label className="block text-xs text-slate-600">
              Σύμβαση
              <select
                value={empForm.contractType}
                onChange={(ev) =>
                  setEmpForm((f) => ({ ...f, contractType: ev.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              >
                {Object.entries(contractTypeLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Εβδομαδιαίες ώρες
              <input
                type="number"
                min={0}
                max={168}
                step={0.5}
                value={empForm.weeklyHours}
                onChange={(ev) =>
                  setEmpForm((f) => ({ ...f, weeklyHours: ev.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            {sites.length ? (
              <label className="block text-xs text-slate-600">
                Εγκατάσταση
                <select
                  value={empForm.siteId}
                  onChange={(ev) =>
                    setEmpForm((f) => ({ ...f, siteId: ev.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
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
            <label className="block text-xs text-slate-600">
              Ημ/νία πρόσληψης
              <input
                type="date"
                value={empForm.hireDate}
                onChange={(ev) =>
                  setEmpForm((f) => ({ ...f, hireDate: ev.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-teal-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Αποθήκευση
            </button>
          </form>
        </div>
      ) : null}

      {tab === "leave" ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase text-slate-500">
                Τύποι αδειών (ελληνικά πρότυπα)
              </div>
              <div className="flex flex-wrap gap-2 p-3">
                {leaveTypes.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div className="font-medium text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500">
                      {t.daysPerYear} ημ/έτος · {t.isPaid ? "Έμμισθη" : "Άνευ αποδοχών"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
                  {leaveRequests.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{empName(r.employee)}</td>
                      <td className="px-3 py-2">{r.leaveType.name}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {day(r.fromDate)} – {day(r.toDate)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{r.days}</td>
                      <td className="px-3 py-2">
                        {leaveRequestStatusLabel[
                          r.status as keyof typeof leaveRequestStatusLabel
                        ] || r.status}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.status === "PENDING" ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => decideLeave(r.id, "APPROVED")}
                              className="rounded-md bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                            >
                              Έγκριση
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => decideLeave(r.id, "REJECTED")}
                              className="rounded-md bg-rose-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                            >
                              Απόρριψη
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {leaveRequests.length === 0 ? (
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
          </div>
          <form
            onSubmit={createLeave}
            className="h-fit space-y-3 rounded-xl border border-slate-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold">Νέα αίτηση άδειας</h2>
            <label className="block text-xs text-slate-600">
              Εργαζόμενος
              <select
                required
                value={leaveForm.employeeId}
                onChange={(ev) =>
                  setLeaveForm((f) => ({ ...f, employeeId: ev.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {activeEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {empName(e)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Τύπος
              <select
                required
                value={leaveForm.leaveTypeId}
                onChange={(ev) =>
                  setLeaveForm((f) => ({ ...f, leaveTypeId: ev.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Από
              <input
                required
                type="date"
                value={leaveForm.fromDate}
                onChange={(ev) =>
                  setLeaveForm((f) => ({ ...f, fromDate: ev.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Έως
              <input
                required
                type="date"
                value={leaveForm.toDate}
                onChange={(ev) =>
                  setLeaveForm((f) => ({ ...f, toDate: ev.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Σημειώσεις
              <textarea
                value={leaveForm.notes}
                onChange={(ev) =>
                  setLeaveForm((f) => ({ ...f, notes: ev.target.value }))
                }
                rows={2}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-teal-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Υποβολή
            </button>
          </form>
        </div>
      ) : null}

      {tab === "card" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <form
              onSubmit={issueCard}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <h2 className="text-sm font-semibold">
                Έκδοση ψηφιακής κάρτας εργασίας
              </h2>
              <label className="block text-xs text-slate-600">
                Εργαζόμενος
                <select
                  required
                  value={cardForm.employeeId}
                  onChange={(ev) =>
                    setCardForm((f) => ({ ...f, employeeId: ev.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {activeEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {empName(e)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-600">
                Αριθμός κάρτας
                <input
                  required
                  value={cardForm.cardNumber}
                  onChange={(ev) =>
                    setCardForm((f) => ({ ...f, cardNumber: ev.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 font-mono text-sm"
                  placeholder="π.χ. WC-0001"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-teal-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Έκδοση
              </button>
            </form>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Κάρτα</th>
                    <th className="px-3 py-2">Εργαζόμενος</th>
                    <th className="px-3 py-2">Έκδοση</th>
                    <th className="px-3 py-2">Κατάσταση</th>
                  </tr>
                </thead>
                <tbody>
                  {workCards.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">
                        {c.cardNumber}
                      </td>
                      <td className="px-3 py-2">{empName(c.employee)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {day(c.issuedAt)}
                      </td>
                      <td className="px-3 py-2">
                        {workCardStatusLabel[
                          c.status as keyof typeof workCardStatusLabel
                        ] || c.status}
                      </td>
                    </tr>
                  ))}
                  {workCards.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-8 text-center text-slate-500"
                      >
                        Δεν έχουν εκδοθεί κάρτες.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <form
              onSubmit={punch}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <h2 className="text-sm font-semibold">Χτύπημα παρουσίας</h2>
              <p className="text-xs text-slate-500">
                Έναρξη / λήξη / διάλειμμα · αποστολή στην Εργάνη (simulator)
              </p>
              <label className="block text-xs text-slate-600">
                Εργαζόμενος
                <select
                  required
                  value={punchForm.employeeId}
                  onChange={(ev) =>
                    setPunchForm((f) => ({
                      ...f,
                      employeeId: ev.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {activeEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {empName(e)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-600">
                Τύπος
                <select
                  value={punchForm.type}
                  onChange={(ev) =>
                    setPunchForm((f) => ({ ...f, type: ev.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                >
                  {Object.entries(workCardEventTypeLabel).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-teal-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Καταχώρηση χτυπήματος
              </button>
            </form>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Ώρα</th>
                    <th className="px-3 py-2">Εργαζόμενος</th>
                    <th className="px-3 py-2">Τύπος</th>
                    <th className="px-3 py-2">Εργάνη</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {dt(ev.occurredAt)}
                      </td>
                      <td className="px-3 py-2">{empName(ev.employee)}</td>
                      <td className="px-3 py-2">
                        {workCardEventTypeLabel[
                          ev.type as keyof typeof workCardEventTypeLabel
                        ] || ev.type}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {erganiStatusLabel[
                          ev.erganiStatus as keyof typeof erganiStatusLabel
                        ] || ev.erganiStatus}
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-8 text-center text-slate-500"
                      >
                        Δεν υπάρχουν χτυπήματα.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "ergani" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Ουρά δηλώσεων Εργάνη / Ψηφιακή Κάρτα Εργασίας (simulator έως live
              credentials).
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => processErgani()}
              className="rounded-md bg-teal-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Επεξεργασία batch
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
                      {row.status !== "ACCEPTED" &&
                      row.status !== "CANCELLED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => processErgani(row.id)}
                          className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          Αποστολή
                        </button>
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
        </div>
      ) : null}

      {tab === "payroll" ? (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <form
            onSubmit={createPayroll}
            className="h-fit space-y-3 rounded-xl border border-slate-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold">Νέα περίοδος</h2>
            <p className="text-xs text-slate-500">
              Ενδεικτικός υπολογισμός ΕΦΚΑ / φόρου για ενεργούς εργαζομένους
            </p>
            <label className="block text-xs text-slate-600">
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
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600">
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
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600">
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
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-teal-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Δημιουργία
            </button>
          </form>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Περίοδος</th>
                    <th className="px-3 py-2">Κατάσταση</th>
                    <th className="px-3 py-2 text-right">Γραμμές</th>
                    <th className="px-3 py-2 text-right">Μικτά</th>
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
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(p.totals.net)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openPayroll(p.id)}
                          className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          Άνοιγμα
                        </button>
                      </td>
                    </tr>
                  ))}
                  {payroll.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-10 text-center text-slate-500"
                      >
                        Δεν υπάρχουν περίοδοι μισθοδοσίας.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {payrollDetail ? (
              <div className="overflow-hidden rounded-xl border border-teal-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <div className="text-sm font-semibold">
                    Περίοδος {payrollDetail.code}
                  </div>
                  <div className="flex gap-2">
                    {payrollDetail.status === "DRAFT" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => closePayroll(payrollDetail.id)}
                        className="rounded-md bg-teal-800 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Κλείσιμο περιόδου
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPayrollDetail(null)}
                      className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
                    >
                      Κλείσιμο
                    </button>
                  </div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Εργαζόμενος</th>
                      <th className="px-3 py-2 text-right">Μικτά</th>
                      <th className="px-3 py-2 text-right">ΕΦΚΑ εργαζ.</th>
                      <th className="px-3 py-2 text-right">ΕΦΚΑ εργοδ.</th>
                      <th className="px-3 py-2 text-right">Φόρος</th>
                      <th className="px-3 py-2 text-right">Καθαρά</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollDetail.lines.map((l) => (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{empName(l.employee)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(l.gross)}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
