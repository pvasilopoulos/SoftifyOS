"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  MinusCircle,
  PlusCircle,
  Receipt,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { pointsToEur } from "@/modules/loyalty/rules";
import {
  loyaltyLedgerKindLabel,
  loyaltyTierLabel,
} from "@/modules/loyalty/labels";

type LedgerKind = keyof typeof loyaltyLedgerKindLabel;

type Ledger = {
  id: string;
  kind: LedgerKind;
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

const ledgerKindMeta: Record<
  LedgerKind,
  { icon: typeof Star; tone: string }
> = {
  EARN: {
    icon: PlusCircle,
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  REDEEM: {
    icon: MinusCircle,
    tone: "bg-rose-50 text-rose-700 ring-rose-100",
  },
  ADJUST: {
    icon: SlidersHorizontal,
    tone: "bg-amber-50 text-amber-800 ring-amber-100",
  },
  VOID: {
    icon: Ban,
    tone: "bg-slate-100 text-slate-600 ring-slate-200",
  },
};

function friendlyNote(note: string | null, kind: LedgerKind) {
  if (!note) return null;
  const t = note.trim();
  if (!t) return null;
  if (/^POS earn$/i.test(t)) return "Κέρδος πόντων από πώληση POS";
  if (/^POS redeem/i.test(t)) {
    const eur = t.match(/([\d.,]+)\s*€/);
    return eur
      ? `Εξαργύρωση στο POS · ${eur[1]} €`
      : "Εξαργύρωση πόντων στο POS";
  }
  if (/backfill/i.test(t)) return "Καταχώρηση από μετάπτωση δεδομένων";
  if (kind === "ADJUST") return t;
  return t;
}

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
  const [kindFilter, setKindFilter] = useState<"all" | LedgerKind>("all");
  const [pending, startTransition] = useTransition();

  const ledgerStats = useMemo(() => {
    let earned = 0;
    let redeemed = 0;
    for (const l of account.ledger) {
      if (l.points > 0) earned += l.points;
      if (l.points < 0) redeemed += Math.abs(l.points);
    }
    return {
      count: account.ledger.length,
      earned,
      redeemed,
      earnedEur: pointsToEur(earned, rules),
      redeemedEur: pointsToEur(redeemed, rules),
    };
  }, [account.ledger, rules]);

  const visibleLedger = useMemo(() => {
    if (kindFilter === "all") return account.ledger;
    return account.ledger.filter((l) => l.kind === kindFilter);
  }, [account.ledger, kindFilter]);

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
              Υπόλοιπο πόντων
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-teal-800">
              {account.pointsBalance.toLocaleString("el-GR")}
              <span className="ml-1.5 text-base font-medium text-slate-400">
                πτ.
              </span>
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Αξία εξαργύρωσης {formatEUR(account.balanceEur)}
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

            <div className="space-y-2.5 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
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

      <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-950">Κινήσεις</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Κέρδη, εξαργυρώσεις και προσαρμογές πόντων
              </p>
            </div>
            <Badge tone="slate">{ledgerStats.count} κινήσεις</Badge>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Κέρδη
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-700">
                +{ledgerStats.earned.toLocaleString("el-GR")} πτ.
              </p>
              <p className="text-[11px] text-slate-400">
                ~{formatEUR(ledgerStats.earnedEur)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Εξαργυρώσεις
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-rose-700">
                −{ledgerStats.redeemed.toLocaleString("el-GR")} πτ.
              </p>
              <p className="text-[11px] text-slate-400">
                ~{formatEUR(ledgerStats.redeemedEur)}
              </p>
            </div>
            <div className="col-span-2 rounded-xl bg-teal-50/70 px-3 py-2 sm:col-span-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-teal-700/80">
                Τρέχον
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-teal-900">
                {account.pointsBalance.toLocaleString("el-GR")} πτ.
              </p>
              <p className="text-[11px] text-teal-800/70">
                {formatEUR(account.balanceEur)}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <FilterChip
              active={kindFilter === "all"}
              onClick={() => setKindFilter("all")}
              label="Όλα"
            />
            {(Object.keys(loyaltyLedgerKindLabel) as LedgerKind[]).map((k) => {
              const count = account.ledger.filter((l) => l.kind === k).length;
              if (count === 0) return null;
              return (
                <FilterChip
                  key={k}
                  active={kindFilter === k}
                  onClick={() => setKindFilter(k)}
                  label={`${loyaltyLedgerKindLabel[k]} ${count}`}
                />
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {visibleLedger.length === 0 ? (
            <div className="flex h-full min-h-[12rem] flex-col items-center justify-center text-center">
              <Star className="mb-2 text-slate-300" size={28} />
              <p className="text-sm font-medium text-ink-900">Καμία κίνηση</p>
              <p className="mt-1 max-w-xs text-sm text-slate-500">
                {kindFilter === "all"
                  ? "Οι πόντοι από POS και προσαρμογές θα εμφανιστούν εδώ."
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
                const noteText = friendlyNote(l.note, l.kind);
                const when = new Date(l.createdAt);
                const eurValue = pointsToEur(Math.abs(l.points), rules);
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
                        "min-w-0 flex-1 rounded-xl border border-slate-100 bg-slate-50/50 px-3.5 py-3",
                        index === 0 && "border-teal-100 bg-teal-50/30",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-ink-950">
                              {loyaltyLedgerKindLabel[l.kind] ?? l.kind}
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
                          {noteText ? (
                            <p className="mt-1 text-xs leading-relaxed text-slate-600">
                              {noteText}
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
                        </div>
                        <div className="text-right">
                          <p
                            className={cn(
                              "text-base font-semibold tabular-nums",
                              l.points >= 0
                                ? "text-emerald-700"
                                : "text-rose-700",
                            )}
                          >
                            {l.points >= 0 ? "+" : ""}
                            {l.points.toLocaleString("el-GR")}
                            <span className="ml-1 text-xs font-medium text-slate-400">
                              πτ.
                            </span>
                          </p>
                          {eurValue > 0 ? (
                            <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                              {l.points >= 0 ? "~" : "−"}
                              {formatEUR(eurValue)}
                            </p>
                          ) : null}
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
