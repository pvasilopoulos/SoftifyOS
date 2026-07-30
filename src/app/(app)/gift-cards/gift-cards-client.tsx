"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/shared/ui/badge";
import { formatEUR } from "@/modules/sales/invoice-utils";
import {
  giftCardStatusLabel,
  giftCardStatusTone,
} from "@/modules/gift-cards/labels";

type Item = {
  id: string;
  code: string;
  initialBalance: number;
  balance: number;
  status: keyof typeof giftCardStatusLabel;
  expiresAt: string | null;
  customer: { id: string; code: string; name: string } | null;
  createdAt: string;
};

export function GiftCardsClient({ initialItems }: { initialItems: Item[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");

  const items = useMemo(() => {
    return initialItems.filter((g) => {
      if (status !== "all" && g.status !== status) return false;
      if (!q.trim()) return true;
      const needle = q.trim().toLowerCase();
      return (
        g.code.toLowerCase().includes(needle) ||
        (g.customer?.name.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [initialItems, q, status]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Αναζήτηση κωδικού / πελάτη"
          className="h-10 min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
        >
          <option value="all">Όλες</option>
          {Object.entries(giftCardStatusLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="soft-panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200/80 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-semibold">Κωδικός</th>
              <th className="px-4 py-3 font-semibold">Υπόλοιπο</th>
              <th className="px-4 py-3 font-semibold">Κατάσταση</th>
              <th className="px-4 py-3 font-semibold">Πελάτης</th>
              <th className="px-4 py-3 font-semibold">Λήξη</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Δεν βρέθηκαν δωροκάρτες
                </td>
              </tr>
            ) : (
              items.map((g) => (
                <tr key={g.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/gift-cards/${g.id}`}
                      className="font-medium text-teal-800 hover:underline"
                    >
                      {g.code}
                    </Link>
                    <div className="text-xs text-slate-400">
                      αρχικό {formatEUR(g.initialBalance)}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums font-medium">
                    {formatEUR(g.balance)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={giftCardStatusTone(g.status)}>
                      {giftCardStatusLabel[g.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {g.customer ? g.customer.name : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {g.expiresAt
                      ? new Date(g.expiresAt).toLocaleDateString("el-GR")
                      : "—"}
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
