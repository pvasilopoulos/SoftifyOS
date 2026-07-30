"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  Clock3,
  Gift,
  MinusCircle,
  PlusCircle,
  Receipt,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { giftCardLedgerKindLabel } from "@/modules/gift-cards/labels";
import { DEFAULT_GIFT_CARD_ACCOUNTS } from "@/modules/gift-cards/accounting";

type LedgerKind = keyof typeof giftCardLedgerKindLabel;

const ledgerKindMeta: Record<
  LedgerKind,
  {
    icon: typeof Gift;
    tone: string;
    amountTone: string;
  }
> = {
  ISSUE: {
    icon: PlusCircle,
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amountTone: "text-emerald-700",
  },
  REDEEM: {
    icon: Gift,
    tone: "bg-teal-50 text-teal-700 ring-teal-100",
    amountTone: "text-rose-700",
  },
  ADJUST: {
    icon: SlidersHorizontal,
    tone: "bg-amber-50 text-amber-800 ring-amber-100",
    amountTone: "text-ink-900",
  },
  VOID: {
    icon: Ban,
    tone: "bg-rose-50 text-rose-700 ring-rose-100",
    amountTone: "text-rose-700",
  },
  EXPIRE: {
    icon: Clock3,
    tone: "bg-slate-100 text-slate-600 ring-slate-200",
    amountTone: "text-slate-700",
  },
};

function friendlyNote(note: string | null, kind: LedgerKind) {
  if (!note) return null;
  const t = note.trim();
  if (!t) return null;
  if (/backfill/i.test(t)) {
    return kind === "ISSUE"
      ? "Αρχική έκδοση κάρτας"
      : "Καταχώρηση από μετάπτωση δεδομένων";
  }
  return t;
}

type Ledger = {
  id: string;
  kind: LedgerKind;
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
  const [kindFilter, setKindFilter] = useState<"all" | LedgerKind>("all");
  const [pending, startTransition] = useTransition();

  const ledgerStats = useMemo(() => {
    const issued = card.ledger
      .filter((l) => l.kind === "ISSUE" || (l.kind === "ADJUST" && l.amount > 0))
      .reduce((s, l) => s + Math.max(0, l.amount), 0);
    const redeemed = card.ledger
      .filter((l) => l.kind === "REDEEM" || (l.kind === "ADJUST" && l.amount < 0) || l.kind === "VOID")
      .reduce((s, l) => s + Math.abs(Math.min(0, l.amount)), 0);
    return {
      count: card.ledger.length,
      issued,
      redeemed,
    };
  }, [card.ledger]);

  const visibleLedger = useMemo(() => {
    if (kindFilter === "all") return card.ledger;
    return card.ledger.filter((l) => l.kind === kindFilter);
  }, [card.ledger, kindFilter]);

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

      <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-950">Ιστορικό</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Κινήσεις υπολοίπου και λογιστικές εγγραφές
              </p>
            </div>
            <Badge tone="slate">{ledgerStats.count} κινήσεις</Badge>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Πιστώσεις
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-700">
                +{formatEUR(ledgerStats.issued)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Χρεώσεις
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-rose-700">
                −{formatEUR(ledgerStats.redeemed)}
              </p>
            </div>
            <div className="col-span-2 rounded-xl bg-teal-50/70 px-3 py-2 sm:col-span-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-teal-700/80">
                Τρέχον
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-teal-900">
                {formatEUR(card.balance)}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <FilterChip
              active={kindFilter === "all"}
              onClick={() => setKindFilter("all")}
              label="Όλα"
            />
            {(Object.keys(giftCardLedgerKindLabel) as LedgerKind[]).map((k) => {
              const count = card.ledger.filter((l) => l.kind === k).length;
              if (count === 0) return null;
              return (
                <FilterChip
                  key={k}
                  active={kindFilter === k}
                  onClick={() => setKindFilter(k)}
                  label={`${giftCardLedgerKindLabel[k]} ${count}`}
                />
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {visibleLedger.length === 0 ? (
            <div className="flex h-full min-h-[12rem] flex-col items-center justify-center text-center">
              <RefreshCw className="mb-2 text-slate-300" size={28} />
              <p className="text-sm font-medium text-ink-900">Καμία κίνηση</p>
              <p className="mt-1 text-sm text-slate-500">
                {kindFilter === "all"
                  ? "Οι κινήσεις θα εμφανιστούν εδώ μετά την έκδοση ή χρήση."
                  : "Δεν υπάρχουν κινήσεις σε αυτό το φίλτρο."}
              </p>
            </div>
          ) : (
            <ol className="relative space-y-0">
              <span
                aria-hidden
                className="absolute bottom-3 left-[1.15rem] top-3 w-px bg-slate-200"
              />
              {visibleLedger.map((l, index) => {
                const meta = ledgerKindMeta[l.kind] ?? ledgerKindMeta.ADJUST;
                const Icon = meta.icon;
                const note = friendlyNote(l.note, l.kind);
                const when = new Date(l.createdAt);
                return (
                  <li key={l.id} className="relative flex gap-3 pb-5 last:pb-0">
                    <span
                      className={cn(
                        "relative z-[1] mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ring-4 ring-white",
                        meta.tone,
                      )}
                    >
                      <Icon size={16} />
                    </span>
                    <div
                      className={cn(
                        "min-w-0 flex-1 rounded-xl border border-slate-100 bg-slate-50/50 px-3.5 py-3 transition",
                        index === 0 && "border-teal-100 bg-teal-50/30",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-ink-950">
                              {giftCardLedgerKindLabel[l.kind] ?? l.kind}
                            </p>
                            {l.invoiceId ? (
                              <Link
                                href={`/invoices/${l.invoiceId}`}
                                className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-teal-800 ring-1 ring-slate-200 hover:bg-teal-50"
                              >
                                <Receipt size={11} />
                                Παραστατικό
                              </Link>
                            ) : null}
                          </div>
                          {note ? (
                            <p className="mt-1 text-xs leading-relaxed text-slate-600">
                              {note}
                            </p>
                          ) : null}
                          <p className="mt-1.5 text-[11px] text-slate-400">
                            {when.toLocaleDateString("el-GR", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                            {" · "}
                            {when.toLocaleTimeString("el-GR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                          {l.glDebitAccount || l.glCreditAccount ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                                <MinusCircle size={10} className="text-slate-400" />
                                Χρ. {l.glDebitAccount ?? "—"}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                                <PlusCircle size={10} className="text-slate-400" />
                                Πι. {l.glCreditAccount ?? "—"}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p
                            className={cn(
                              "text-base font-semibold tabular-nums",
                              l.amount >= 0
                                ? "text-emerald-700"
                                : "text-rose-700",
                            )}
                          >
                            {l.amount >= 0 ? "+" : ""}
                            {formatEUR(l.amount)}
                          </p>
                          <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                            υπόλ. {formatEUR(l.balanceAfter)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs font-medium transition",
        active
          ? "border-ink-900 bg-ink-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink-900",
      )}
    >
      {label}
    </button>
  );
}
