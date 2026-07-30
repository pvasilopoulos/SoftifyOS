"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { giftCardLedgerKindLabel } from "@/modules/gift-cards/labels";
import { DEFAULT_GIFT_CARD_ACCOUNTS } from "@/modules/gift-cards/accounting";

type Ledger = {
  id: string;
  kind: keyof typeof giftCardLedgerKindLabel;
  amount: number;
  balanceAfter: number;
  invoiceId: string | null;
  note: string | null;
  glDebitAccount: string | null;
  glCreditAccount: string | null;
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
  glLiabilityAccount: string | null;
  glCashAccount: string | null;
  glRedeemContraAccount: string | null;
  costCenter: string | null;
  accountingCode: string | null;
  customer: { id: string; code: string; name: string } | null;
  ledger: Ledger[];
};

const inputCls =
  "h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2";

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
  const [accounts, setAccounts] = useState({
    glLiabilityAccount:
      card.glLiabilityAccount ?? DEFAULT_GIFT_CARD_ACCOUNTS.glLiabilityAccount,
    glCashAccount:
      card.glCashAccount ?? DEFAULT_GIFT_CARD_ACCOUNTS.glCashAccount,
    glRedeemContraAccount:
      card.glRedeemContraAccount ??
      DEFAULT_GIFT_CARD_ACCOUNTS.glRedeemContraAccount,
    costCenter: card.costCenter ?? "",
    accountingCode: card.accountingCode ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const applyCard = (item: Card) => {
    setCard(item);
    setAccounts({
      glLiabilityAccount:
        item.glLiabilityAccount ?? DEFAULT_GIFT_CARD_ACCOUNTS.glLiabilityAccount,
      glCashAccount:
        item.glCashAccount ?? DEFAULT_GIFT_CARD_ACCOUNTS.glCashAccount,
      glRedeemContraAccount:
        item.glRedeemContraAccount ??
        DEFAULT_GIFT_CARD_ACCOUNTS.glRedeemContraAccount,
      costCenter: item.costCenter ?? "",
      accountingCode: item.accountingCode ?? "",
    });
  };

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
      applyCard({ ...data.item, ledger: data.item.ledger ?? [] });
      setAdjustAmount("");
      setAdjustNote("");
      setMessage(action === "void" ? "Ακυρώθηκε." : "Προσαρμόστηκε.");
      router.refresh();
    });
  };

  const saveAccounting = () => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/gift-cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accounting", ...accounts }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης λογιστικής");
        return;
      }
      applyCard({ ...data.item, ledger: data.item.ledger ?? [] });
      setMessage("Η λογιστική ενημερώθηκε.");
      router.refresh();
    });
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
      <div className="space-y-4">
        <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Υπόλοιπο
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-teal-800">
                {formatEUR(card.balance)}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Αρχικό {formatEUR(card.initialBalance)}
              </p>
            </div>
          </div>

          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-400">Πελάτης</dt>
              <dd className="mt-0.5 font-medium text-ink-900">
                {card.customer?.name ?? "—"}
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-400">Λήξη</dt>
              <dd className="mt-0.5 font-medium text-ink-900">
                {card.expiresAt
                  ? new Date(card.expiresAt).toLocaleDateString("el-GR")
                  : "—"}
              </dd>
            </div>
          </dl>

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
                className={inputCls}
              />
              <input
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="Αιτιολογία"
                className={inputCls}
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
                    if (
                      confirm(
                        "Ακύρωση δωροκάρτας; Το υπόλοιπο μηδενίζεται με λογιστική αντιστροφή.",
                      )
                    ) {
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

        <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div>
            <h2 className="text-sm font-semibold text-ink-950">Λογιστική</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Οι νέες κινήσεις χρησιμοποιούν αυτούς τους λογαριασμούς.
            </p>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Παθητικό</span>
            <input
              className={cn(inputCls, "font-mono")}
              value={accounts.glLiabilityAccount}
              disabled={!canWrite}
              onChange={(e) =>
                setAccounts((a) => ({
                  ...a,
                  glLiabilityAccount: e.target.value,
                }))
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Ταμείο / είσπραξη</span>
            <input
              className={cn(inputCls, "font-mono")}
              value={accounts.glCashAccount}
              disabled={!canWrite}
              onChange={(e) =>
                setAccounts((a) => ({ ...a, glCashAccount: e.target.value }))
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Αντίστοιχος εξαργύρωσης</span>
            <input
              className={cn(inputCls, "font-mono")}
              value={accounts.glRedeemContraAccount}
              disabled={!canWrite}
              onChange={(e) =>
                setAccounts((a) => ({
                  ...a,
                  glRedeemContraAccount: e.target.value,
                }))
              }
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Κέντρο κόστους</span>
              <input
                className={inputCls}
                value={accounts.costCenter}
                disabled={!canWrite}
                onChange={(e) =>
                  setAccounts((a) => ({ ...a, costCenter: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Κωδ. λογιστικής</span>
              <input
                className={cn(inputCls, "font-mono")}
                value={accounts.accountingCode}
                disabled={!canWrite}
                onChange={(e) =>
                  setAccounts((a) => ({ ...a, accountingCode: e.target.value }))
                }
              />
            </label>
          </div>
          {canWrite ? (
            <Button size="sm" disabled={pending} onClick={saveAccounting}>
              Αποθήκευση λογιστικής
            </Button>
          ) : null}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">
          Ιστορικό & λογιστικές κινήσεις
        </h2>
        <ul className="divide-y divide-slate-100">
          {card.ledger.length === 0 ? (
            <li className="py-8 text-center text-sm text-slate-500">
              Καμία κίνηση
            </li>
          ) : (
            card.ledger.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium text-ink-900">
                    {giftCardLedgerKindLabel[l.kind] ?? l.kind}
                  </span>
                  {l.note ? (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {l.note}
                    </span>
                  ) : null}
                  {l.glDebitAccount || l.glCreditAccount ? (
                    <span className="mt-1 block font-mono text-[11px] text-slate-500">
                      Χρ. {l.glDebitAccount ?? "—"}
                      <span className="mx-1.5 text-slate-300">/</span>
                      Πι. {l.glCreditAccount ?? "—"}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {new Date(l.createdAt).toLocaleString("el-GR")}
                  </span>
                </div>
                <div className="text-right tabular-nums">
                  <div
                    className={
                      l.amount >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"
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
