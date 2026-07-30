"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { formatEUR } from "@/modules/sales/invoice-utils";
import {
  loyaltyLedgerKindLabel,
  loyaltyTierLabel,
} from "@/modules/loyalty/labels";

type Ledger = {
  id: string;
  kind: keyof typeof loyaltyLedgerKindLabel;
  points: number;
  invoiceId: string | null;
  note: string | null;
  createdAt: string;
};

type Account = {
  id: string;
  pointsBalance: number;
  balanceEur: number;
  tier: string;
  isActive: boolean;
  customer: { id: string; code: string; name: string; email: string | null };
  ledger: Ledger[];
};

export function LoyaltyDetailClient({
  initial,
  canWrite,
  rules,
}: {
  initial: Account;
  canWrite: boolean;
  rules: { earnPointsPerEur: number; redeemPointsPerEur: number };
}) {
  const router = useRouter();
  const [account, setAccount] = useState(initial);
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const adjust = () => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/loyalty/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust",
          points: Number(points),
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setAccount({
        id: data.item.id,
        pointsBalance: data.item.pointsBalance,
        balanceEur: data.item.balanceEur,
        tier: data.item.tier,
        isActive: data.item.isActive,
        customer: data.item.customer,
        ledger: data.item.ledger ?? [],
      });
      setPoints("");
      setNote("");
      setMessage("Προσαρμόστηκε.");
      router.refresh();
    });
  };

  const toggleActive = () => {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/loyalty/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !account.isActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setAccount((prev) => ({ ...prev, isActive: data.item.isActive }));
      router.refresh();
    });
  };

  const setTier = (tier: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/loyalty/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setAccount((prev) => ({ ...prev, tier: data.item.tier }));
      router.refresh();
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <section className="soft-panel space-y-3 p-5">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Πόντοι</span>
          <span className="text-lg font-semibold tabular-nums text-teal-800">
            {account.pointsBalance.toLocaleString("el-GR")}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Αξία εξαργύρωσης</span>
          <span className="tabular-nums">{formatEUR(account.balanceEur)}</span>
        </div>
        <p className="text-xs text-slate-400">
          Πολιτική: +{rules.earnPointsPerEur} πτ./€ · {rules.redeemPointsPerEur}{" "}
          πτ. = 1 €
        </p>

        {canWrite ? (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Tier</span>
              <select
                value={account.tier}
                disabled={pending}
                onChange={(e) => setTier(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3"
              >
                {Object.entries(loyaltyTierLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="Πόντοι προσαρμογής (±)"
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Αιτιολογία"
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending || !points || !note}
                onClick={adjust}
              >
                Προσαρμογή πόντων
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={toggleActive}
              >
                {account.isActive ? "Απενεργοποίηση" : "Ενεργοποίηση"}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      </section>

      <section className="soft-panel p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">Ledger</h2>
        <ul className="divide-y divide-slate-100">
          {account.ledger.length === 0 ? (
            <li className="py-4 text-sm text-slate-500">Καμία κίνηση</li>
          ) : (
            account.ledger.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm"
              >
                <div>
                  <span className="font-medium">
                    {loyaltyLedgerKindLabel[l.kind] ?? l.kind}
                  </span>
                  {l.note ? (
                    <span className="block text-xs text-slate-500">{l.note}</span>
                  ) : null}
                  <span className="block text-xs text-slate-400">
                    {new Date(l.createdAt).toLocaleString("el-GR")}
                  </span>
                </div>
                <div
                  className={`tabular-nums font-medium ${
                    l.points >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {l.points >= 0 ? "+" : ""}
                  {l.points.toLocaleString("el-GR")}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
