"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Employee = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  department: string | null;
  hireDate: string | null;
  status: string;
};

export function HrClient({ initialEmployees }: { initialEmployees: Employee[] }) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    title: "",
    department: "",
    hireDate: "",
  });

  useEffect(() => setEmployees(initialEmployees), [initialEmployees]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          email: form.email || null,
          phone: form.phone || null,
          title: form.title || null,
          department: form.department || null,
          hireDate: form.hireDate || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setMessage("Ο εργαζόμενος καταχωρήθηκε");
      setForm({
        code: "",
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        title: "",
        department: "",
        hireDate: "",
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
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

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Κωδικός</th>
                <th className="px-3 py-2">Όνομα</th>
                <th className="px-3 py-2">Τίτλος</th>
                <th className="px-3 py-2">Τμήμα</th>
                <th className="px-3 py-2">Κατάσταση</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{e.code}</td>
                  <td className="px-3 py-2 font-medium">
                    {e.lastName} {e.firstName}
                    {e.email ? (
                      <div className="text-xs font-normal text-slate-500">
                        {e.email}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{e.title || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {e.department || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {e.status === "ACTIVE" ? "Ενεργός" : "Ανενεργός"}
                  </td>
                </tr>
              ))}
              {employees.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
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
          onSubmit={create}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
        >
          <h2 className="text-sm font-semibold text-slate-900">
            Νέος εργαζόμενος
          </h2>
          {(
            [
              ["code", "Κωδικός", true],
              ["firstName", "Όνομα", true],
              ["lastName", "Επώνυμο", true],
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
                value={form[key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [key]: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
          ))}
          <label className="block text-xs text-slate-600">
            Ημ/νία πρόσληψης
            <input
              type="date"
              value={form.hireDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, hireDate: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Αποθήκευση
          </button>
        </form>
      </div>
    </div>
  );
}
