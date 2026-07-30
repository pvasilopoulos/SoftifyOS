"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import {
  earnPointsForSale,
  pointsToEur,
} from "@/modules/loyalty/rules";

export type LoyaltyProgramForm = {
  name: string;
  earnPointsPerEur: number;
  redeemPointsPerEur: number;
  isActive: boolean;
};

export function LoyaltyProgramEditor({
  initial,
  onSaved,
}: {
  initial: LoyaltyProgramForm;
  onSaved?: (program: LoyaltyProgramForm) => void;
}) {
  const [form, setForm] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [sampleSale, setSampleSale] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    form.name !== baseline.name ||
    form.earnPointsPerEur !== baseline.earnPointsPerEur ||
    form.redeemPointsPerEur !== baseline.redeemPointsPerEur ||
    form.isActive !== baseline.isActive;

  const preview = useMemo(() => {
    const rules = {
      earnPointsPerEur: Math.max(0, form.earnPointsPerEur || 0),
      redeemPointsPerEur: Math.max(1, form.redeemPointsPerEur || 1),
    };
    const earned = earnPointsForSale(sampleSale, rules);
    const redeemValue = pointsToEur(earned, rules);
    const pointsForTenEur = rules.redeemPointsPerEur * 10;
    return { earned, redeemValue, pointsForTenEur, rules };
  }, [form.earnPointsPerEur, form.redeemPointsPerEur, sampleSale]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/loyalty/program", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      const next: LoyaltyProgramForm = {
        name: data.item.name,
        earnPointsPerEur: data.item.earnPointsPerEur,
        redeemPointsPerEur: data.item.redeemPointsPerEur,
        isActive: data.item.isActive,
      };
      setForm(next);
      setBaseline(next);
      setMessage("Το πρόγραμμα αποθηκεύτηκε.");
      onSaved?.(next);
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]">
      <section className="space-y-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-950">Κανόνες προγράμματος</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Ισχύουν στο POS για κέρδος και εξαργύρωση πόντων.
            </p>
          </div>
          <Badge tone={form.isActive ? "emerald" : "slate"}>
            {form.isActive ? "Ενεργό" : "Ανενεργό"}
          </Badge>
        </div>

        {error ? (
          <p className="rounded-xl border border-rose-200/80 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-xl border border-emerald-200/80 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-ink-900">Όνομα προγράμματος *</span>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none ring-teal-500/30 focus:ring-2"
            required
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-ink-900">
              Κέρδος · πόντοι ανά €
            </span>
            <input
              type="number"
              min={0}
              max={1000}
              value={form.earnPointsPerEur}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  earnPointsPerEur: Number(e.target.value),
                }))
              }
              className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none ring-teal-500/30 focus:ring-2"
              required
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Π.χ. 1 = 1 πόντος για κάθε ευρώ πώλησης.
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-ink-900">
              Εξαργύρωση · πόντοι για 1 €
            </span>
            <input
              type="number"
              min={1}
              max={100000}
              value={form.redeemPointsPerEur}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  redeemPointsPerEur: Number(e.target.value),
                }))
              }
              className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none ring-teal-500/30 focus:ring-2"
              required
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Π.χ. 100 = χρειάζονται 100 πόντοι για έκπτωση 1 €.
            </span>
          </label>
        </div>

        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition",
            form.isActive
              ? "border-teal-200 bg-teal-50/50"
              : "border-slate-200 bg-slate-50/50",
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            checked={form.isActive}
            onChange={(e) =>
              setForm((f) => ({ ...f, isActive: e.target.checked }))
            }
          />
          <span>
            <span className="block font-medium text-ink-900">Ενεργό πρόγραμμα</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Αν είναι ανενεργό, το POS χρησιμοποιεί τους προεπιλεγμένους κανόνες.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setForm(baseline);
                setError(null);
                setMessage(null);
              }}
            >
              Ακύρωση
            </Button>
          ) : null}
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? "Αποθήκευση…" : "Αποθήκευση προγράμματος"}
          </Button>
        </div>
      </section>

      <aside className="h-fit space-y-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <Sparkles size={16} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-950">Παράδειγμα</h3>
            <p className="text-xs text-slate-500">Ζωντανή προεπισκόπηση κανόνων</p>
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-ink-900">Πώληση (€)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={sampleSale}
            onChange={(e) => setSampleSale(Number(e.target.value) || 0)}
            className="h-10 w-full rounded-xl border border-slate-200 px-3 outline-none ring-teal-500/30 focus:ring-2"
          />
        </label>

        <dl className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-3">
            <dt className="text-slate-500">Πόντοι που κερδίζει</dt>
            <dd className="font-semibold tabular-nums text-teal-800">
              +{preview.earned.toLocaleString("el-GR")}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-3">
            <dt className="text-slate-500">Αξία εξαργύρωσης</dt>
            <dd className="tabular-nums text-ink-900">
              {formatEUR(preview.redeemValue)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-slate-500">Για έκπτωση 10 €</dt>
            <dd className="tabular-nums text-ink-900">
              {preview.pointsForTenEur.toLocaleString("el-GR")} πτ.
            </dd>
          </div>
        </dl>

        <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
          Κέρδος{" "}
          <strong className="font-semibold text-ink-900">
            {preview.rules.earnPointsPerEur} πτ./€
          </strong>
          {" · "}
          εξαργύρωση{" "}
          <strong className="font-semibold text-ink-900">
            {preview.rules.redeemPointsPerEur} πτ. = 1 €
          </strong>
        </p>
      </aside>
    </form>
  );
}
