"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { DEFAULT_GIFT_CARD_ACCOUNTS } from "@/modules/gift-cards/accounting";

const inputCls =
  "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2";

export function IssueGiftCardClient({
  customers,
  defaults = DEFAULT_GIFT_CARD_ACCOUNTS,
}: {
  customers: { id: string; code: string; name: string }[];
  defaults?: {
    glLiabilityAccount: string;
    glCashAccount: string;
    glRedeemContraAccount: string;
  };
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
          expiresAt: expiresRaw ? new Date(expiresRaw).toISOString() : null,
          notes: String(form.get("notes") || "") || null,
          glLiabilityAccount: String(form.get("glLiabilityAccount") || "") || null,
          glCashAccount: String(form.get("glCashAccount") || "") || null,
          glRedeemContraAccount:
            String(form.get("glRedeemContraAccount") || "") || null,
          costCenter: String(form.get("costCenter") || "") || null,
          accountingCode: String(form.get("accountingCode") || "") || null,
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
    <form
      onSubmit={onSubmit}
      className="mx-auto grid max-w-3xl gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]"
    >
      <section className="space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Κωδικός *</span>
            <input
              name="code"
              required
              placeholder="GIFT-50"
              className={`${inputCls} uppercase font-mono`}
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
              className={inputCls}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Πελάτης (προαιρετικά)</span>
          <select name="customerId" className={inputCls} defaultValue="">
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
          <input name="expiresAt" type="date" className={inputCls} />
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Σημειώσεις</span>
          <textarea
            name="notes"
            rows={3}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
          />
        </label>

        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Έκδοση…" : "Έκδοση δωροκάρτας"}
        </Button>
      </section>

      <aside className="h-fit space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">Λογιστική</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Λογαριασμοί για έκδοση και εξαργύρωση — αποθηκεύονται και στο
            ιστορικό κινήσεων.
          </p>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">
            Παθητικό δωροκαρτών
          </span>
          <input
            name="glLiabilityAccount"
            defaultValue={defaults.glLiabilityAccount}
            placeholder="56.00.00"
            className={`${inputCls} font-mono`}
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Πίστωση στην έκδοση · χρέωση στην εξαργύρωση
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Ταμείο / είσπραξη</span>
          <input
            name="glCashAccount"
            defaultValue={defaults.glCashAccount}
            placeholder="38.00.00"
            className={`${inputCls} font-mono`}
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Χρέωση όταν εισπράττεται η αξία έκδοσης
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">
            Αντίστοιχος εξαργύρωσης
          </span>
          <input
            name="glRedeemContraAccount"
            defaultValue={defaults.glRedeemContraAccount}
            placeholder="70.00.00"
            className={`${inputCls} font-mono`}
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Πίστωση όταν χρησιμοποιείται στο POS
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Κέντρο κόστους</span>
            <input
              name="costCenter"
              placeholder="προαιρετικά"
              className={inputCls}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Κωδ. λογιστικής</span>
            <input
              name="accountingCode"
              placeholder="προαιρετικά"
              className={`${inputCls} font-mono`}
            />
          </label>
        </div>
      </aside>
    </form>
  );
}
