"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";

export function LoyaltyProgramClient({
  initial,
}: {
  initial: {
    name: string;
    earnPointsPerEur: number;
    redeemPointsPerEur: number;
    isActive: boolean;
  };
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/loyalty/program", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setForm({
        name: data.item.name,
        earnPointsPerEur: data.item.earnPointsPerEur,
        redeemPointsPerEur: data.item.redeemPointsPerEur,
        isActive: data.item.isActive,
      });
      setMessage("Αποθηκεύτηκε.");
    });
  };

  return (
    <form onSubmit={onSubmit} className="soft-panel max-w-lg space-y-4 p-5">
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Όνομα προγράμματος</span>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="h-11 w-full rounded-xl border border-slate-200 px-3"
          required
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Πόντοι κέρδους ανά €</span>
        <input
          type="number"
          min="0"
          value={form.earnPointsPerEur}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              earnPointsPerEur: Number(e.target.value),
            }))
          }
          className="h-11 w-full rounded-xl border border-slate-200 px-3"
          required
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">
          Πόντοι για εξαργύρωση 1 €
        </span>
        <input
          type="number"
          min="1"
          value={form.redeemPointsPerEur}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              redeemPointsPerEur: Number(e.target.value),
            }))
          }
          className="h-11 w-full rounded-xl border border-slate-200 px-3"
          required
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) =>
            setForm((f) => ({ ...f, isActive: e.target.checked }))
          }
        />
        Ενεργό πρόγραμμα
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Αποθήκευση…" : "Αποθήκευση"}
      </Button>
    </form>
  );
}
