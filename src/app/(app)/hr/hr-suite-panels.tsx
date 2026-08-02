"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Cake,
  CheckCircle2,
  Circle,
  FolderTree,
  Gift,
  PartyPopper,
  Trash2,
} from "lucide-react";
import {
  checklistItemStatusLabel,
  checklistKindLabel,
  contractTypeLabel,
  employeeStatusLabel,
  hrDocumentCategoryLabel,
} from "@/modules/hr/labels";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type EmpOpt = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  department?: string | null;
};

type LeaveType = {
  id: string;
  code: string;
  name: string;
  daysPerYear: number;
  isPaid: boolean;
  isActive: boolean;
};

function empName(e: { lastName: string; firstName: string; code: string }) {
  return `${e.lastName} ${e.firstName} (${e.code})`;
}

function day(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("el-GR");
}

async function readJson(res: Response) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Αποτυχία");
  return data;
}

export function TeamPulsePanel({
  employees,
}: {
  employees: EmpOpt[];
}) {
  const [dayIso, setDayIso] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [data, setData] = useState<{
    headcount: number;
    onLeave: Array<{
      id: string;
      days: number;
      halfDay: boolean;
      fromDate: string;
      toDate: string;
      employee: EmpOpt & { department: string | null };
      leaveType: { name: string; code: string };
    }>;
    holidays: Array<{ id: string; name: string; isBlackout: boolean }>;
    birthdays: Array<EmpOpt & { date: string }>;
    anniversaries: Array<EmpOpt & { date: string; years: number }>;
    departments: Array<{ name: string; count: number }>;
    openOnboarding: number;
    expiringDocuments: Array<{
      id: string;
      title: string;
      category: string;
      expiresAt: string | null;
      employee: EmpOpt;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/hr/pulse?day=${dayIso}`);
        const json = await readJson(res);
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Σφάλμα");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayIso]);

  return (
    <div className="space-y-3">
      <div className="soft-panel flex flex-wrap items-center gap-2 p-3">
        <label className="text-xs text-slate-600">
          Ημέρα{" "}
          <input
            type="date"
            className="ml-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            value={dayIso}
            onChange={(e) => setDayIso(e.target.value)}
          />
        </label>
        <span className="text-xs text-slate-500">
          Ενεργό προσωπικό: {data?.headcount ?? employees.length}
        </span>
      </div>
      {error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Σε άδεια σήμερα", data?.onLeave.length ?? 0, "teal"],
          ["Γενέθλια εβδομάδας", data?.birthdays.length ?? 0, "violet"],
          ["Επέτειοι σήμερα", data?.anniversaries.length ?? 0, "sky"],
          ["Open onboarding", data?.openOnboarding ?? 0, "amber"],
        ].map(([label, value]) => (
          <div key={String(label)} className="soft-panel rounded-2xl px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--hr-ink)]">
              {value as number}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="soft-panel p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <PartyPopper className="h-4 w-4 text-teal-700" />
            Ποιοι λείπουν σήμερα
          </h3>
          <ul className="mt-2 space-y-2 text-sm">
            {(data?.onLeave ?? []).map((r) => (
              <li
                key={r.id}
                className="flex justify-between gap-2 border-b border-slate-50 pb-2"
              >
                <span>
                  {empName(r.employee)}
                  <span className="block text-xs text-slate-500">
                    {r.leaveType.name}
                    {r.halfDay ? " · ½ ημέρα" : ""}
                    {r.employee.department
                      ? ` · ${r.employee.department}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {day(r.fromDate)}–{day(r.toDate)}
                </span>
              </li>
            ))}
            {(data?.onLeave ?? []).length === 0 ? (
              <li className="text-slate-500">Όλοι παρόντες (χωρίς άδεια).</li>
            ) : null}
          </ul>
          {(data?.holidays ?? []).length ? (
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Αργία: {data!.holidays.map((h) => h.name).join(", ")}
            </div>
          ) : null}
        </section>

        <section className="soft-panel p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Cake className="h-4 w-4 text-violet-600" />
            Γενέθλια & επέτειοι
          </h3>
          <ul className="mt-2 space-y-2 text-sm">
            {(data?.birthdays ?? []).map((b) => (
              <li key={`b-${b.id}`} className="flex items-center gap-2">
                <Gift className="h-3.5 w-3.5 text-violet-500" />
                {empName(b)} · {day(b.date)}
              </li>
            ))}
            {(data?.anniversaries ?? []).map((a) => (
              <li key={`a-${a.id}`} className="flex items-center gap-2">
                <PartyPopper className="h-3.5 w-3.5 text-sky-500" />
                {empName(a)} · {a.years} χρόνια
              </li>
            ))}
            {!data?.birthdays.length && !data?.anniversaries.length ? (
              <li className="text-slate-500">Τίποτα αυτή την περίοδο.</li>
            ) : null}
          </ul>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="soft-panel p-4">
          <h3 className="text-sm font-semibold">Κατανομή τμημάτων</h3>
          <ul className="mt-2 space-y-1.5">
            {(data?.departments ?? []).map((d) => (
              <li key={d.name} className="flex items-center gap-2 text-sm">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-teal-500/80"
                    style={{
                      width: `${Math.min(100, (d.count / Math.max(1, data?.headcount || 1)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-28 truncate text-xs text-slate-600">
                  {d.name}
                </span>
                <span className="w-6 text-right text-xs font-semibold tabular-nums">
                  {d.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="soft-panel p-4">
          <h3 className="text-sm font-semibold">Έγγραφα που λήγουν (30ημ)</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {(data?.expiringDocuments ?? []).map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span>
                  {d.title}
                  <span className="block text-xs text-slate-500">
                    {empName(d.employee)}
                  </span>
                </span>
                <Badge tone="amber">{day(d.expiresAt)}</Badge>
              </li>
            ))}
            {(data?.expiringDocuments ?? []).length === 0 ? (
              <li className="text-slate-500">Καμία λήξη στο παράθυρο.</li>
            ) : null}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function DirectoryPanel({
  onOpenEmployee,
}: {
  onOpenEmployee: (id: string) => void;
}) {
  const [groups, setGroups] = useState<
    Array<{
      department: string;
      count: number;
      members: Array<{
        id: string;
        code: string;
        firstName: string;
        lastName: string;
        email: string | null;
        phone: string | null;
        title: string | null;
        department: string | null;
        contractType: string;
        status: string;
        hireDate: string | null;
        site: { id: string; code: string; name: string } | null;
      }>;
    }>
  >([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/hr/directory");
        const data = await readJson(res);
        setGroups(data.groups ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Σφάλμα");
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        members: g.members.filter((m) =>
          `${m.lastName} ${m.firstName} ${m.code} ${m.title ?? ""} ${m.email ?? ""}`
            .toLowerCase()
            .includes(needle),
        ),
      }))
      .filter((g) => g.members.length > 0)
      .map((g) => ({ ...g, count: g.members.length }));
  }, [groups, q]);

  return (
    <div className="space-y-3">
      <div className="soft-panel flex flex-wrap items-center gap-2 p-3">
        <FolderTree className="h-4 w-4 text-teal-700" />
        <input
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          placeholder="Αναζήτηση ονόματος, κωδικού, τίτλου…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-slate-500">
          {filtered.reduce((s, g) => s + g.count, 0)} άτομα · {filtered.length}{" "}
          τμήματα
        </span>
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <div className="space-y-4">
        {filtered.map((g) => (
          <section key={g.department} className="soft-panel p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-ink-950">
                {g.department}
              </h3>
              <Badge tone="slate">{g.count}</Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {g.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenEmployee(m.id)}
                  className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50/80 px-3 py-3 text-left transition hover:border-teal-200 hover:shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-900">
                      {m.lastName.slice(0, 1)}
                      {m.firstName.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {m.lastName} {m.firstName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {m.title || "—"} · {m.code}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {contractTypeLabel[
                          m.contractType as keyof typeof contractTypeLabel
                        ] || m.contractType}
                        {" · "}
                        {employeeStatusLabel[
                          m.status as keyof typeof employeeStatusLabel
                        ] || m.status}
                      </p>
                      {m.email ? (
                        <p className="truncate text-[11px] text-teal-700">
                          {m.email}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
        {filtered.length === 0 ? (
          <p className="soft-panel p-6 text-center text-sm text-slate-500">
            Δεν βρέθηκαν εργαζόμενοι.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function HolidaysPanel({
  year,
  canWrite,
}: {
  year: number;
  canWrite: boolean;
}) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      name: string;
      date: string;
      isRecurring: boolean;
      isBlackout: boolean;
      notes: string | null;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    date: "",
    isRecurring: false,
    isBlackout: true,
    notes: "",
  });

  async function load() {
    const res = await fetch(`/api/hr/holidays?year=${year}`);
    const data = await readJson(res);
    setItems(data.items ?? []);
  }

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Σφάλμα"),
    );
  }, [year]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch("/api/hr/holidays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }),
      );
      setForm({
        name: "",
        date: "",
        isRecurring: false,
        isBlackout: true,
        notes: "",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Διαγραφή αργίας;")) return;
    setBusy(true);
    try {
      await readJson(await fetch(`/api/hr/holidays?id=${id}`, { method: "DELETE" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold">Αργίες {year}</h3>
          <p className="text-xs text-slate-500">
            Ελληνικές αργίες (συμπ. κινητών) φορτώνονται αυτόματα. Blackout
            μπλοκάρει αιτήσεις αδείας.
          </p>
        </div>
        {error ? (
          <p className="px-4 py-2 text-sm text-rose-600">{error}</p>
        ) : null}
        <ul className="divide-y divide-slate-50">
          {items.map((h) => (
            <li
              key={h.id}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
            >
              <div>
                <p className="font-medium">{h.name}</p>
                <p className="text-xs text-slate-500">
                  {day(h.date)}
                  {h.isRecurring ? " · επαναλαμβανόμενη" : ""}
                  {h.isBlackout ? " · blackout" : ""}
                </p>
              </div>
              {canWrite ? (
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => void onDelete(h.id)}
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {canWrite ? (
        <form onSubmit={onCreate} className="soft-panel h-fit space-y-2.5 p-4">
          <h3 className="text-sm font-semibold">Νέα αργία / blackout</h3>
          <input
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Όνομα"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            required
            type="date"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.isBlackout}
              onChange={(e) =>
                setForm((f) => ({ ...f, isBlackout: e.target.checked }))
              }
            />
            Blackout αδειών
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.isRecurring}
              onChange={(e) =>
                setForm((f) => ({ ...f, isRecurring: e.target.checked }))
              }
            />
            Επαναλαμβανόμενη
          </label>
          <Button type="submit" size="sm" disabled={busy} className="w-full">
            Αποθήκευση
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function DocumentsPanel({
  employees,
  canWrite,
}: {
  employees: EmpOpt[];
  canWrite: boolean;
}) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      title: string;
      category: string;
      fileName: string | null;
      fileUrl: string | null;
      issuedAt: string | null;
      expiresAt: string | null;
      employee: EmpOpt;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    employeeId: employees[0]?.id ?? "",
    category: "CONTRACT",
    title: "",
    fileName: "",
    fileUrl: "",
    issuedAt: "",
    expiresAt: "",
    notes: "",
  });

  async function load() {
    const data = await readJson(await fetch("/api/hr/documents"));
    setItems(data.items ?? []);
  }

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Σφάλμα"),
    );
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch("/api/hr/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }),
      );
      setForm((f) => ({ ...f, title: "", fileName: "", fileUrl: "", notes: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Διαγραφή εγγράφου;")) return;
    setBusy(true);
    try {
      await readJson(
        await fetch(`/api/hr/documents?id=${id}`, { method: "DELETE" }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  const soon = (iso: string | null) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t - Date.now() < 30 * 86400000 && t >= Date.now();
  };
  const expired = (iso: string | null) =>
    iso ? new Date(iso).getTime() < Date.now() : false;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold">Μητρώο εγγράφων</h3>
          <p className="text-xs text-slate-500">
            Συμβάσεις, ταυτότητες, πιστοποιητικά — με ειδοποίηση λήξης.
          </p>
        </div>
        {error ? (
          <p className="px-4 py-2 text-sm text-rose-600">{error}</p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Εργαζόμενος</th>
                <th className="px-3 py-2">Έγγραφο</th>
                <th className="px-3 py-2">Κατηγορία</th>
                <th className="px-3 py-2">Λήξη</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{empName(d.employee)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{d.title}</div>
                    {d.fileUrl ? (
                      <a
                        href={d.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-teal-700"
                      >
                        {d.fileName || "Άνοιγμα"}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {d.fileName || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {hrDocumentCategoryLabel[
                      d.category as keyof typeof hrDocumentCategoryLabel
                    ] || d.category}
                  </td>
                  <td className="px-3 py-2">
                    {expired(d.expiresAt) ? (
                      <Badge tone="rose">Έληξε {day(d.expiresAt)}</Badge>
                    ) : soon(d.expiresAt) ? (
                      <Badge tone="amber">{day(d.expiresAt)}</Badge>
                    ) : (
                      <span className="text-xs text-slate-600">
                        {day(d.expiresAt)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => void onDelete(d.id)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Δεν υπάρχουν έγγραφα ακόμα.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {canWrite ? (
        <form onSubmit={onCreate} className="soft-panel h-fit space-y-2.5 p-4">
          <h3 className="text-sm font-semibold">Καταχώρηση εγγράφου</h3>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.employeeId}
            onChange={(e) =>
              setForm((f) => ({ ...f, employeeId: e.target.value }))
            }
            required
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {empName(e)}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({ ...f, category: e.target.value }))
            }
          >
            {Object.entries(hrDocumentCategoryLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Τίτλος"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Όνομα αρχείου"
            value={form.fileName}
            onChange={(e) =>
              setForm((f) => ({ ...f, fileName: e.target.value }))
            }
          />
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="URL / σύνδεσμος"
            value={form.fileUrl}
            onChange={(e) => setForm((f) => ({ ...f, fileUrl: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-500">
              Έκδοση
              <input
                type="date"
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={form.issuedAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, issuedAt: e.target.value }))
                }
              />
            </label>
            <label className="text-[10px] text-slate-500">
              Λήξη
              <input
                type="date"
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={form.expiresAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expiresAt: e.target.value }))
                }
              />
            </label>
          </div>
          <Button type="submit" size="sm" disabled={busy} className="w-full">
            Αποθήκευση
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function OnboardingPanel({
  employees,
  canWrite,
}: {
  employees: EmpOpt[];
  canWrite: boolean;
}) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      title: string;
      kind: string;
      status: string;
      dueDate: string | null;
      employee: EmpOpt;
    }>
  >([]);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("TODO");

  async function load() {
    const qs = new URLSearchParams();
    if (filter !== "ALL") qs.set("status", filter);
    const data = await readJson(await fetch(`/api/hr/checklist?${qs}`));
    setItems(data.items ?? []);
  }

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Σφάλμα"),
    );
  }, [filter]);

  async function seed() {
    if (!employeeId) return;
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch("/api/hr/checklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed: true, employeeId }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "TODO" | "DONE" | "SKIPPED") {
    setBusy(true);
    try {
      await readJson(
        await fetch(`/api/hr/checklist/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const i of items) {
      const key = empName(i.employee);
      const list = m.get(key) ?? [];
      list.push(i);
      m.set(key, list);
    }
    return [...m.entries()];
  }, [items]);

  return (
    <div className="space-y-3">
      <div className="soft-panel flex flex-wrap items-center gap-2 p-3">
        <select
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="TODO">Εκκρεμή</option>
          <option value="DONE">Ολοκληρωμένα</option>
          <option value="SKIPPED">Παραλείψεις</option>
          <option value="ALL">Όλα</option>
        </select>
        {canWrite ? (
          <>
            <select
              className="min-w-[200px] rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empName(e)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              type="button"
              disabled={busy || !employeeId}
              onClick={() => void seed()}
            >
              Seed onboarding checklist
            </Button>
          </>
        ) : null}
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <div className="space-y-3">
        {grouped.map(([name, rows]) => {
          const done = rows.filter((r) => r.status === "DONE").length;
          const pct = rows.length
            ? Math.round((done / rows.length) * 100)
            : 0;
          return (
            <section key={name} className="soft-panel p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{name}</h3>
                <span className="text-xs tabular-nums text-slate-500">
                  {done}/{rows.length} · {pct}%
                </span>
              </div>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-teal-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <ul className="space-y-1.5">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 rounded-xl border border-slate-50 px-2 py-1.5 text-sm"
                  >
                    <button
                      type="button"
                      disabled={!canWrite || busy}
                      onClick={() =>
                        void setStatus(
                          r.id,
                          r.status === "DONE" ? "TODO" : "DONE",
                        )
                      }
                      className="text-teal-700"
                    >
                      {r.status === "DONE" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate",
                          r.status === "DONE" && "text-slate-400 line-through",
                        )}
                      >
                        {r.title}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {checklistKindLabel[
                          r.kind as keyof typeof checklistKindLabel
                        ] || r.kind}
                        {r.dueDate ? ` · έως ${day(r.dueDate)}` : ""}
                      </p>
                    </div>
                    <Badge
                      tone={
                        r.status === "DONE"
                          ? "emerald"
                          : r.status === "SKIPPED"
                            ? "slate"
                            : "amber"
                      }
                    >
                      {checklistItemStatusLabel[
                        r.status as keyof typeof checklistItemStatusLabel
                      ] || r.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {grouped.length === 0 ? (
          <p className="soft-panel p-6 text-center text-sm text-slate-500">
            Δεν υπάρχουν βήματα. Seed checklist σε εργαζόμενο ή πρόσλαβε νέο.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function LeaveTypesAdminPanel({
  initialTypes,
  canWrite,
  onChanged,
}: {
  initialTypes: LeaveType[];
  canWrite: boolean;
  onChanged: (types: LeaveType[]) => void;
}) {
  const [types, setTypes] = useState(initialTypes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    daysPerYear: "20",
    isPaid: true,
  });

  useEffect(() => setTypes(initialTypes), [initialTypes]);

  async function createType(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await readJson(
        await fetch("/api/hr/leave-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: form.code,
            name: form.name,
            daysPerYear: Number(form.daysPerYear),
            isPaid: form.isPaid,
          }),
        }),
      );
      const next = [...types, data.item];
      setTypes(next);
      onChanged(next);
      setForm({ code: "", name: "", daysPerYear: "20", isPaid: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function patchType(
    id: string,
    patch: Partial<LeaveType>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const data = await readJson(
        await fetch(`/api/hr/leave-types/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
      );
      const next = types.map((t) => (t.id === id ? { ...t, ...data.item } : t));
      setTypes(next);
      onChanged(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold">Τύποι αδειών</h3>
          <p className="text-xs text-slate-500">
            Ελληνικά πρότυπα + προσαρμοσμένοι τύποι. Το δικαίωμα/έτος τροφοδοτεί
            τα υπόλοιπα.
          </p>
        </div>
        {error ? (
          <p className="px-4 py-2 text-sm text-rose-600">{error}</p>
        ) : null}
        <ul className="divide-y divide-slate-50">
          {types.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-[140px]">
                <p className="font-medium">{t.name}</p>
                <p className="font-mono text-[10px] text-slate-400">{t.code}</p>
              </div>
              <label className="text-[10px] text-slate-500">
                Ημέρες/έτος
                <input
                  type="number"
                  min={0}
                  max={366}
                  disabled={!canWrite || busy}
                  className="ml-1 w-16 rounded border border-slate-200 px-1 py-0.5 text-sm"
                  defaultValue={t.daysPerYear}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== t.daysPerYear) {
                      void patchType(t.id, { daysPerYear: v });
                    }
                  }}
                />
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={t.isPaid}
                  disabled={!canWrite || busy}
                  onChange={(e) =>
                    void patchType(t.id, { isPaid: e.target.checked })
                  }
                />
                Έμμισθη
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={t.isActive}
                  disabled={!canWrite || busy}
                  onChange={(e) =>
                    void patchType(t.id, { isActive: e.target.checked })
                  }
                />
                Ενεργός
              </label>
            </li>
          ))}
        </ul>
      </section>
      {canWrite ? (
        <form onSubmit={createType} className="soft-panel h-fit space-y-2.5 p-4">
          <h3 className="text-sm font-semibold">Νέος τύπος</h3>
          <input
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase"
            placeholder="ΚΩΔΙΚΟΣ"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          />
          <input
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Όνομα"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            type="number"
            min={0}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.daysPerYear}
            onChange={(e) =>
              setForm((f) => ({ ...f, daysPerYear: e.target.value }))
            }
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.isPaid}
              onChange={(e) =>
                setForm((f) => ({ ...f, isPaid: e.target.checked }))
              }
            />
            Έμμισθη
          </label>
          <Button type="submit" size="sm" disabled={busy} className="w-full">
            Δημιουργία
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function LeaveAdjustmentsPanel({
  employees,
  leaveTypes,
  year,
  canWrite,
  onAdjusted,
}: {
  employees: EmpOpt[];
  leaveTypes: LeaveType[];
  year: number;
  canWrite: boolean;
  onAdjusted: () => void;
}) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      days: number;
      year: number;
      reason: string | null;
      createdAt: string;
      employee: EmpOpt;
      leaveType: { id: string; code: string; name: string };
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    employeeId: employees[0]?.id ?? "",
    leaveTypeId: leaveTypes[0]?.id ?? "",
    days: "1",
    reason: "Μεταφορά από προηγούμενο έτος",
  });

  async function load() {
    const data = await readJson(
      await fetch(`/api/hr/leave-adjustments?year=${year}`),
    );
    setItems(data.items ?? []);
  }

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Σφάλμα"),
    );
  }, [year]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch("/api/hr/leave-adjustments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            year,
            days: Number(form.days),
          }),
        }),
      );
      await load();
      onAdjusted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold">Προσαρμογές υπολοίπων {year}</h3>
          <p className="text-xs text-slate-500">
            Μεταφορές ημερών, διορθώσεις, επιπλέον δικαίωμα.
          </p>
        </div>
        {error ? (
          <p className="px-4 py-2 text-sm text-rose-600">{error}</p>
        ) : null}
        <ul className="divide-y divide-slate-50 text-sm">
          {items.map((a) => (
            <li key={a.id} className="flex justify-between gap-2 px-4 py-2.5">
              <div>
                <p className="font-medium">{empName(a.employee)}</p>
                <p className="text-xs text-slate-500">
                  {a.leaveType.name}
                  {a.reason ? ` · ${a.reason}` : ""}
                </p>
              </div>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  a.days >= 0 ? "text-teal-700" : "text-rose-600",
                )}
              >
                {a.days >= 0 ? "+" : ""}
                {a.days}
              </span>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="px-4 py-8 text-center text-slate-500">
              Καμία προσαρμογή φέτος.
            </li>
          ) : null}
        </ul>
      </section>
      {canWrite ? (
        <form onSubmit={onCreate} className="soft-panel h-fit space-y-2.5 p-4">
          <h3 className="text-sm font-semibold">Νέα προσαρμογή</h3>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.employeeId}
            onChange={(e) =>
              setForm((f) => ({ ...f, employeeId: e.target.value }))
            }
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {empName(e)}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.leaveTypeId}
            onChange={(e) =>
              setForm((f) => ({ ...f, leaveTypeId: e.target.value }))
            }
          >
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.5"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.days}
            onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))}
          />
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Αιτία"
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
          <Button type="submit" size="sm" disabled={busy} className="w-full">
            Καταχώρηση
          </Button>
        </form>
      ) : null}
    </div>
  );
}
