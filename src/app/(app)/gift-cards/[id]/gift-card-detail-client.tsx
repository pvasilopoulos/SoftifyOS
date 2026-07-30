"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { giftCardLedgerKindLabel } from "@/modules/gift-cards/labels";

type Ledger = {
  id: string;
  kind: keyof typeof giftCardLedgerKindLabel;
  amount: number;
  balanceAfter: number;
  invoiceId: string | null;
  note: string | null;
  createdAt: string;
};

type Card = {
  id: string;
  code: string;
  initialBalance: number;
  balance: number;
  status: string;
  expiresAt: string | null;
  notes: string | null;
  customer: { id: string; code: string; name: string } | null;
  ledger: Ledger[];
};

export function GiftCardDetailClient({
  initial,
  canWrite,
}: {
  initial: Card;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [card, setCard] = useState(initial);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: "adjust" | "void") => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const body =
        action === "void"
          ? { action: "void", note: adjustNote || "Ακύρωση" }
          : {
              action: "adjust",
              amount: Number(adjustAmount),
              note: adjustNote,
            };
      const res = await fetch(`/api/gift-cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setCard({
        ...data.item,
        ledger: data.item.ledger ?? [],
      });
      setAdjustAmount("");
      setAdjustNote("");
      setMessage(action === "void" ? "Ακυρώθηκε." : "Προσαρμόστηκε.");
      router.refresh();
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <section className="soft-panel space-y-3 p-5">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Υπόλοιπο</span>
          <span className="text-lg font-semibold tabular-nums text-teal-800">
            {formatEUR(card.balance)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Αρχικό</span>
          <span className="tabular-nums">{formatEUR(card.initialBalance)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Πελάτης</span>
          <span>{card.customer?.name ?? "—"}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Λήξη</span>
          <span>
            {card.expiresAt
              ? new Date(card.expiresAt).toLocaleDateString("el-GR")
              : "—"}
          </span>
        </div>
        {card.notes ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {card.notes}
          </p>
        ) : null}

        {canWrite && card.status !== "VOID" ? (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ενέργειες
            </p>
            <input
              type="number"
              step="0.01"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              placeholder="Ποσό προσαρμογής (±)"
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
            <input
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
              placeholder="Αιτιολογία"
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending || !adjustAmount || !adjustNote}
                onClick={() => run("adjust")}
              >
                Προσαρμογή
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  if (confirm("Ακύρωση δωροκάρτας; Το υπόλοιπο μηδενίζεται.")) {
                    run("void");
                  }
                }}
              >
                Ακύρωση
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : null}
        {message ? (
          <p className="text-sm text-emerald-700">{message}</p>
        ) : null}
      </section>

      <section className="soft-panel p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">Ιστορικό</h2>
        <ul className="divide-y divide-slate-100">
          {card.ledger.length === 0 ? (
            <li className="py-4 text-sm text-slate-500">Καμία κίνηση</li>
          ) : (
            card.ledger.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm"
              >
                <div>
                  <span className="font-medium">
                    {giftCardLedgerKindLabel[l.kind] ?? l.kind}
                  </span>
                  {l.note ? (
                    <span className="block text-xs text-slate-500">{l.note}</span>
                  ) : null}
                  <span className="block text-xs text-slate-400">
                    {new Date(l.createdAt).toLocaleString("el-GR")}
                  </span>
                </div>
                <div className="text-right tabular-nums">
                  <div
                    className={
                      l.amount >= 0 ? "text-emerald-700" : "text-rose-700"
                    }
                  >
                    {l.amount >= 0 ? "+" : ""}
                    {formatEUR(l.amount)}
                  </div>
                  <div className="text-xs text-slate-400">
                    υπόλ. {formatEUR(l.balanceAfter)}
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
