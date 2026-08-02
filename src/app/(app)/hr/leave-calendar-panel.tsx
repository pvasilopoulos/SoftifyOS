"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { leaveRequestStatusLabel } from "@/modules/hr/labels";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type CalLeave = {
  id: string;
  days: number;
  halfDay: boolean;
  status: string;
  fromDate: string;
  toDate: string;
  notes: string | null;
  employee: {
    id: string;
    code: string;
    firstName: string;
    lastName: string;
    department: string | null;
  };
  leaveType: { id: string; code: string; name: string; isPaid: boolean };
};

type CalHoliday = {
  id: string;
  name: string;
  date: string;
  isRecurring: boolean;
  isBlackout: boolean;
};

const TYPE_COLORS: Record<string, string> = {
  ANNUAL: "bg-teal-500",
  SICK: "bg-rose-500",
  MARRIAGE: "bg-violet-500",
  MATERNITY: "bg-pink-500",
  PATERNITY: "bg-sky-500",
  PARENTAL: "bg-indigo-500",
  UNPAID: "bg-slate-400",
};

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthBounds(year: number, month0: number) {
  const from = new Date(Date.UTC(year, month0, 1));
  const to = new Date(Date.UTC(year, month0 + 1, 0));
  return { from: ymd(from), to: ymd(to), fromDate: from, toDate: to };
}

function spansDay(leave: CalLeave, dayIso: string) {
  const d = dayIso;
  return leave.fromDate.slice(0, 10) <= d && leave.toDate.slice(0, 10) >= d;
}

const WEEKDAYS = ["Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ", "Κυρ"];

export function LeaveCalendarPanel({
  year,
  initialLeaves,
}: {
  year: number;
  initialLeaves: CalLeave[];
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => ({
    y: today.getFullYear(),
    m: today.getMonth(),
  }));
  const [leaves, setLeaves] = useState(initialLeaves);
  const [holidays, setHolidays] = useState<CalHoliday[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");

  const bounds = useMemo(
    () => monthBounds(cursor.y, cursor.m),
    [cursor.y, cursor.m],
  );

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/hr/calendar?from=${bounds.from}&to=${bounds.to}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Αποτυχία φόρτωσης");
      setLeaves(data.leaves ?? []);
      setHolidays(data.holidays ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.from, bounds.to]);

  const departments = useMemo(() => {
    const s = new Set<string>();
    for (const l of leaves) {
      if (l.employee.department) s.add(l.employee.department);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "el"));
  }, [leaves]);

  const filtered = useMemo(() => {
    return leaves.filter((l) => {
      if (filterDept !== "ALL" && (l.employee.department || "") !== filterDept) {
        return false;
      }
      if (filterStatus !== "ALL" && l.status !== filterStatus) return false;
      return true;
    });
  }, [leaves, filterDept, filterStatus]);

  const holidayByDay = useMemo(() => {
    const m = new Map<string, CalHoliday[]>();
    for (const h of holidays) {
      const k = h.date.slice(0, 10);
      const list = m.get(k) ?? [];
      list.push(h);
      m.set(k, list);
    }
    return m;
  }, [holidays]);

  const cells = useMemo(() => {
    const first = bounds.fromDate;
    // Monday-start grid
    const jsDay = first.getUTCDay(); // 0 Sun
    const offset = jsDay === 0 ? 6 : jsDay - 1;
    const start = new Date(first);
    start.setUTCDate(start.getUTCDate() - offset);
    const out: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      out.push(d);
    }
    return out;
  }, [bounds.fromDate]);

  const selectedLeaves = selectedDay
    ? filtered.filter((l) => spansDay(l, selectedDay))
    : [];
  const selectedHolidays = selectedDay
    ? holidayByDay.get(selectedDay) ?? []
    : [];

  const monthLabel = new Date(
    Date.UTC(cursor.y, cursor.m, 1),
  ).toLocaleDateString("el-GR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-3">
      <div className="soft-panel flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() =>
              setCursor((c) => {
                const m = c.m - 1;
                return m < 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m };
              })
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="min-w-[10rem] text-center text-sm font-semibold capitalize text-[var(--hr-ink)]">
            {monthLabel}
          </h3>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() =>
              setCursor((c) => {
                const m = c.m + 1;
                return m > 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m };
              })
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={() =>
            setCursor({ y: today.getFullYear(), m: today.getMonth() })
          }
        >
          Σήμερα
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
          Ανανέωση
        </Button>
        <select
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
        >
          <option value="ALL">Όλα τα τμήματα</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="ALL">Όλες οι καταστάσεις</option>
          <option value="APPROVED">Εγκεκριμένες</option>
          <option value="PENDING">Σε αναμονή</option>
        </select>
        <div className="ml-auto flex flex-wrap gap-2 text-[10px] text-slate-500">
          {Object.entries(TYPE_COLORS).map(([code, cls]) => (
            <span key={code} className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-full", cls)} />
              {code}
            </span>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="soft-panel overflow-hidden p-2">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                {d}
              </div>
            ))}
            {cells.map((d) => {
              const iso = ymd(d);
              const inMonth = d.getUTCMonth() === cursor.m;
              const isToday = iso === ymd(new Date());
              const dayLeaves = filtered.filter((l) => spansDay(l, iso));
              const dayHolidays = holidayByDay.get(iso) ?? [];
              const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedDay(iso)}
                  className={cn(
                    "min-h-[88px] rounded-xl border px-1.5 py-1 text-left transition",
                    inMonth
                      ? "border-slate-100 bg-white"
                      : "border-transparent bg-slate-50/60 text-slate-400",
                    weekend && inMonth && "bg-slate-50/80",
                    dayHolidays.length > 0 && "bg-amber-50/80 border-amber-100",
                    selectedDay === iso &&
                      "ring-2 ring-teal-500 ring-offset-1",
                    isToday && "border-teal-300",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "text-xs font-semibold tabular-nums",
                        isToday &&
                          "inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--hr-ink)] text-[10px] text-white",
                      )}
                    >
                      {d.getUTCDate()}
                    </span>
                    {dayHolidays[0] ? (
                      <span className="truncate text-[9px] text-amber-700">
                        {dayHolidays[0].name}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {dayLeaves.slice(0, 3).map((l) => (
                      <div
                        key={l.id}
                        className={cn(
                          "truncate rounded px-1 py-0.5 text-[9px] font-medium text-white",
                          TYPE_COLORS[l.leaveType.code] || "bg-teal-600",
                          l.status === "PENDING" && "opacity-70",
                        )}
                        title={`${l.employee.lastName} ${l.employee.firstName} · ${l.leaveType.name}`}
                      >
                        {l.employee.lastName}
                        {l.halfDay ? " ½" : ""}
                      </div>
                    ))}
                    {dayLeaves.length > 3 ? (
                      <div className="text-[9px] text-slate-500">
                        +{dayLeaves.length - 3} ακόμη
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="soft-panel h-fit space-y-3 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Ημέρα
            </p>
            <h3 className="text-sm font-semibold text-ink-950">
              {selectedDay
                ? new Date(`${selectedDay}T00:00:00.000Z`).toLocaleDateString(
                    "el-GR",
                    {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    },
                  )
                : "Επίλεξε ημέρα"}
            </h3>
          </div>

          {selectedHolidays.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-amber-800">Αργίες</p>
              {selectedHolidays.map((h) => (
                <div
                  key={h.id}
                  className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
                >
                  {h.name}
                  {h.isBlackout ? (
                    <Badge tone="amber" className="ml-1">
                      Blackout
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-700">
              Άδειες ({selectedLeaves.length})
            </p>
            {selectedLeaves.length === 0 ? (
              <p className="text-xs text-slate-500">
                {selectedDay
                  ? "Καμία άδεια αυτή την ημέρα."
                  : "Κλικ σε ημέρα για λεπτομέρειες."}
              </p>
            ) : (
              selectedLeaves.map((l) => (
                <div
                  key={l.id}
                  className="rounded-xl border border-slate-100 px-3 py-2 text-xs"
                >
                  <div className="font-medium text-ink-950">
                    {l.employee.lastName} {l.employee.firstName}
                  </div>
                  <div className="text-slate-500">
                    {l.leaveType.name}
                    {l.halfDay ? " · μισή ημέρα" : ""} · {l.days}ημ
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        TYPE_COLORS[l.leaveType.code] || "bg-teal-600",
                      )}
                    />
                    <span className="text-slate-500">
                      {leaveRequestStatusLabel[
                        l.status as keyof typeof leaveRequestStatusLabel
                      ] || l.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-xl bg-teal-50/60 px-3 py-2 text-[11px] text-slate-600">
            Έτος φίλτρου hub: <strong>{year}</strong>. Οι αργίες με blackout
            μπλοκάρουν νέες αιτήσεις.
          </div>
        </aside>
      </div>
    </div>
  );
}
