"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
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
      setError(null);
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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
      <section className="space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Υπόλοιπο
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-teal-800">
              {account.pointsBalance.toLocaleString("el-GR")}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Αξία {formatEUR(account.balanceEur)}
            </p>
          </div>
          <Badge tone={account.isActive ? "emerald" : "slate"}>
            {account.isActive ? "Ενεργός" : "Ανενεργός"}
          </Badge>
        </div>

        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Πολιτική: +{rules.earnPointsPerEur} πτ./€ · {rules.redeemPointsPerEur}{" "}
          πτ. = 1 €
        </p>

        {canWrite ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Tier</span>
              <select
                value={account.tier}
                disabled={pending}
                onChange={(e) => setTier(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 outline-none ring-teal-500/30 focus:ring-2"
              >
                {Object.entries(loyaltyTierLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Προσαρμογή πόντων
              </p>
              <input
                type="number"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder="Πόντοι (±)"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Αιτιολογία *"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending || !points || !note}
                  onClick={adjust}
                >
                  Εφαρμογή
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
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">Κινήσεις</h2>
        <ul className="divide-y divide-slate-100">
          {account.ledger.length === 0 ? (
            <li className="py-8 text-center text-sm text-slate-500">
              Καμία κίνηση ακόμη
            </li>
          ) : (
            account.ledger.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium text-ink-900">
                    {loyaltyLedgerKindLabel[l.kind] ?? l.kind}
                  </span>
                  {l.note ? (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {l.note}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {new Date(l.createdAt).toLocaleString("el-GR")}
                  </span>
                </div>
                <div
                  className={cn(
                    "tabular-nums font-semibold",
                    l.points >= 0 ? "text-emerald-700" : "text-rose-700",
                  )}
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
