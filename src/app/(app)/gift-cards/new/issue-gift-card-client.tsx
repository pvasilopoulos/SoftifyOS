"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";

export function IssueGiftCardClient({
  customers,
}: {
  customers: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const expiresRaw = String(form.get("expiresAt") || "");
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(form.get("code") || ""),
          initialBalance: Number(form.get("initialBalance") || 0),
          customerId: String(form.get("customerId") || "") || null,
          expiresAt: expiresRaw
            ? new Date(expiresRaw).toISOString()
            : null,
          notes: String(form.get("notes") || "") || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία έκδοσης");
        return;
      }
      router.push(`/gift-cards/${data.item.id}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="soft-panel max-w-xl space-y-4 p-5">
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Κωδικός *</span>
        <input
          name="code"
          required
          placeholder="GIFT-50"
          className="h-11 w-full rounded-xl border border-slate-200 px-3 uppercase"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Αρχικό υπόλοιπο € *</span>
        <input
          name="initialBalance"
          type="number"
          min="0.01"
          step="0.01"
          required
          defaultValue="50"
          className="h-11 w-full rounded-xl border border-slate-200 px-3"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Πελάτης (προαιρετικά)</span>
        <select
          name="customerId"
          className="h-11 w-full rounded-xl border border-slate-200 px-3"
          defaultValue=""
        >
          <option value="">— Κανένας —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Ημ. λήξης</span>
        <input
          name="expiresAt"
          type="date"
          className="h-11 w-full rounded-xl border border-slate-200 px-3"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Σημειώσεις</span>
        <textarea
          name="notes"
          rows={3}
          className="w-full rounded-xl border border-slate-200 px-3 py-2"
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Έκδοση…" : "Έκδοση δωροκάρτας"}
      </Button>
    </form>
  );
}
