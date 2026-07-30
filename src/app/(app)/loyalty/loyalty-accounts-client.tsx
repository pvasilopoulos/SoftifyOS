"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { loyaltyTierLabel } from "@/modules/loyalty/labels";

type Item = {
  id: string;
  pointsBalance: number;
  balanceEur: number;
  tier: string;
  isActive: boolean;
  customer: { id: string; code: string; name: string; email: string | null };
  updatedAt: string;
};

export function LoyaltyAccountsClient({
  initialItems,
  customersWithout,
  canWrite,
}: {
  initialItems: Item[];
  customersWithout: { id: string; code: string; name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showOpen, setShowOpen] = useState(false);

  const items = useMemo(() => {
    if (!q.trim()) return initialItems;
    const needle = q.trim().toLowerCase();
    return initialItems.filter(
      (a) =>
        a.customer.name.toLowerCase().includes(needle) ||
        a.customer.code.toLowerCase().includes(needle) ||
        (a.customer.email?.toLowerCase().includes(needle) ?? false),
    );
  }, [initialItems, q]);

  const openAccount = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/loyalty/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: String(form.get("customerId") || ""),
          tier: String(form.get("tier") || "STANDARD"),
          openingPoints: Number(form.get("openingPoints") || 0),
          note: String(form.get("note") || "") || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setShowOpen(false);
      router.push(`/loyalty/${data.item.id}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Αναζήτηση πελάτη"
          className="h-10 min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 text-sm"
        />
        {canWrite ? (
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() => setShowOpen((v) => !v)}
          >
            {showOpen ? "Κλείσιμο" : "Άνοιγμα λογαριασμού"}
          </Button>
        ) : null}
      </div>

      {showOpen ? (
        <form id="open" onSubmit={openAccount} className="soft-panel grid gap-3 p-4 sm:grid-cols-2">
          {error ? (
            <p className="sm:col-span-2 text-sm text-rose-700">{error}</p>
          ) : null}
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Πελάτης *</span>
            <select
              name="customerId"
              required
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            >
              <option value="">Επιλογή…</option>
              {customersWithout.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Tier</span>
            <select
              name="tier"
              defaultValue="STANDARD"
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            >
              {Object.entries(loyaltyTierLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Αρχικοί πόντοι</span>
            <input
              name="openingPoints"
              type="number"
              min="0"
              defaultValue="0"
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Σημείωση</span>
            <input
              name="note"
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            />
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            Δημιουργία
          </Button>
        </form>
      ) : null}

      <div className="soft-panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200/80 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-semibold">Πελάτης</th>
              <th className="px-4 py-3 font-semibold">Πόντοι</th>
              <th className="px-4 py-3 font-semibold">Αξία €</th>
              <th className="px-4 py-3 font-semibold">Tier</th>
              <th className="px-4 py-3 font-semibold">Κατάσταση</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Δεν υπάρχουν λογαριασμοί
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/loyalty/${a.id}`}
                      className="font-medium text-teal-800 hover:underline"
                    >
                      {a.customer.name}
                    </Link>
                    <div className="text-xs text-slate-400">{a.customer.code}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums font-medium">
                    {a.pointsBalance.toLocaleString("el-GR")}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {formatEUR(a.balanceEur)}
                  </td>
                  <td className="px-4 py-3">
                    {loyaltyTierLabel[a.tier as keyof typeof loyaltyTierLabel] ??
                      a.tier}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={a.isActive ? "emerald" : "slate"}>
                      {a.isActive ? "Ενεργός" : "Ανενεργός"}
                    </Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
