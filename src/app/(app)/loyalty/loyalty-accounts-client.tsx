"use client";

import Link from "next/link";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Star,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";
import { cn } from "@/shared/lib/cn";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { loyaltyTierLabel } from "@/modules/loyalty/labels";
import {
  LoyaltyProgramEditor,
  type LoyaltyProgramForm,
} from "./loyalty-program-editor";

type Item = {
  id: string;
  pointsBalance: number;
  balanceEur: number;
  tier: string;
  isActive: boolean;
  customer: { id: string; code: string; name: string; email: string | null };
  updatedAt: string;
};

type Tab = "accounts" | "program";

function tierTone(tier: string): "slate" | "teal" | "amber" | "emerald" {
  switch (tier) {
    case "SILVER":
      return "slate";
    case "GOLD":
      return "amber";
    case "PLATINUM":
      return "teal";
    default:
      return "emerald";
  }
}

export function LoyaltyAccountsClient({
  initialItems,
  customersWithout,
  canWrite,
  canManageProgram,
  initialProgram,
  initialTab = "accounts",
}: {
  initialItems: Item[];
  customersWithout: { id: string; code: string; name: string }[];
  canWrite: boolean;
  canManageProgram: boolean;
  initialProgram: LoyaltyProgramForm;
  initialTab?: Tab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [program, setProgram] = useState(initialProgram);
  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [customerFilter, setCustomerFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showOpen, setShowOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#open" && canWrite) {
      setShowOpen(true);
      setTab("accounts");
    }
  }, [canWrite]);

  const stats = useMemo(() => {
    const active = initialItems.filter((a) => a.isActive).length;
    const points = initialItems.reduce((s, a) => s + a.pointsBalance, 0);
    const value = initialItems.reduce((s, a) => s + a.balanceEur, 0);
    return { active, points, value, total: initialItems.length };
  }, [initialItems]);

  const items = useMemo(() => {
    return initialItems.filter((a) => {
      if (tierFilter !== "all" && a.tier !== tierFilter) return false;
      if (statusFilter === "active" && !a.isActive) return false;
      if (statusFilter === "inactive" && a.isActive) return false;
      if (!q.trim()) return true;
      const needle = q.trim().toLowerCase();
      return (
        a.customer.name.toLowerCase().includes(needle) ||
        a.customer.code.toLowerCase().includes(needle) ||
        (a.customer.email?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [initialItems, q, tierFilter, statusFilter]);

  const filteredCustomers = useMemo(() => {
    const needle = customerFilter.trim().toLowerCase();
    if (!needle) return customersWithout;
    return customersWithout.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.code.toLowerCase().includes(needle),
    );
  }, [customersWithout, customerFilter]);

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

  const programSummary = `Κέρδος ${program.earnPointsPerEur} πτ./€ · εξαργύρωση ${program.redeemPointsPerEur} πτ. = 1 €`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loyalty"
        description={
          program.isActive
            ? `${program.name} · ${programSummary}`
            : `${program.name} · ανενεργό · ${programSummary}`
        }
        actions={
          canWrite && tab === "accounts" ? (
            <Button size="sm" onClick={() => setShowOpen(true)}>
              <Plus size={15} />
              Νέος λογαριασμός
            </Button>
          ) : null
        }
      />

      <div className="border-b border-slate-200">
        <div className="-mb-px flex gap-6">
          <TabButton
            active={tab === "accounts"}
            onClick={() => {
              setTab("accounts");
              router.replace("/loyalty", { scroll: false });
            }}
            label="Λογαριασμοί"
            count={stats.total}
          />
          {canManageProgram ? (
            <TabButton
              active={tab === "program"}
              onClick={() => {
                setTab("program");
                router.replace("/loyalty?tab=program", { scroll: false });
              }}
              label="Πρόγραμμα"
            />
          ) : null}
        </div>
      </div>

      {tab === "program" && canManageProgram ? (
        <LoyaltyProgramEditor
          initial={program}
          onSaved={(next) => {
            setProgram(next);
            router.refresh();
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              icon={<Users size={16} />}
              label="Ενεργοί λογαριασμοί"
              value={String(stats.active)}
              hint={`${stats.total} συνολικά`}
            />
            <StatCard
              icon={<Star size={16} />}
              label="Σύνολο πόντων"
              value={stats.points.toLocaleString("el-GR")}
              hint="σε όλους τους λογαριασμούς"
            />
            <StatCard
              icon={<Star size={16} />}
              label="Αξία εξαργύρωσης"
              value={formatEUR(stats.value)}
              hint="τρέχοντα υπόλοιπα"
            />
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "Όλοι"],
                  ["active", "Ενεργοί"],
                  ["inactive", "Ανενεργοί"],
                ] as const
              ).map(([key, label]) => (
                <FilterChip
                  key={key}
                  active={statusFilter === key}
                  onClick={() => setStatusFilter(key)}
                  label={label}
                />
              ))}
              <span className="mx-1 hidden h-6 w-px self-center bg-slate-200 sm:block" />
              <FilterChip
                active={tierFilter === "all"}
                onClick={() => setTierFilter("all")}
                label="Όλα τα tiers"
              />
              {Object.entries(loyaltyTierLabel).map(([k, v]) => (
                <FilterChip
                  key={k}
                  active={tierFilter === k}
                  onClick={() => setTierFilter(k)}
                  label={v}
                />
              ))}
            </div>
            <label className="relative block w-full lg:max-w-xs">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Αναζήτηση πελάτη…"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none ring-teal-500/30 placeholder:text-slate-400 focus:ring-2"
              />
            </label>
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 lg:grid lg:grid-cols-[minmax(0,1.6fr)_7rem_7rem_7rem_6.5rem]">
              <span>Πελάτης</span>
              <span>Πόντοι</span>
              <span>Αξία €</span>
              <span>Tier</span>
              <span>Κατάσταση</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <li className="px-4 py-16 text-center">
                  <p className="text-sm font-medium text-ink-900">
                    Δεν βρέθηκαν λογαριασμοί
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Αλλάξτε φίλτρα ή ανοίξτε νέο λογαριασμό.
                  </p>
                  {canWrite ? (
                    <Button
                      size="sm"
                      className="mt-4"
                      onClick={() => setShowOpen(true)}
                    >
                      <Plus size={15} />
                      Νέος λογαριασμός
                    </Button>
                  ) : null}
                </li>
              ) : (
                items.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/loyalty/${a.id}`}
                      className="grid gap-2 px-4 py-3.5 transition hover:bg-slate-50/90 focus-visible:bg-slate-50 focus-visible:outline-none lg:grid-cols-[minmax(0,1.6fr)_7rem_7rem_7rem_6.5rem] lg:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-950">
                          {a.customer.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                          {a.customer.code}
                          {a.customer.email ? ` · ${a.customer.email}` : ""}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 lg:hidden">
                          Πόντοι
                        </p>
                        <p className="tabular-nums text-sm font-medium text-ink-900">
                          {a.pointsBalance.toLocaleString("el-GR")}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 lg:hidden">
                          Αξία
                        </p>
                        <p className="tabular-nums text-sm text-slate-600">
                          {formatEUR(a.balanceEur)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 lg:hidden">
                          Tier
                        </p>
                        <Badge tone={tierTone(a.tier)}>
                          {loyaltyTierLabel[
                            a.tier as keyof typeof loyaltyTierLabel
                          ] ?? a.tier}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 lg:hidden">
                          Κατάσταση
                        </p>
                        <Badge tone={a.isActive ? "emerald" : "slate"}>
                          {a.isActive ? "Ενεργός" : "Ανενεργός"}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      )}

      {showOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/40">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Κλείσιμο"
            onClick={() => {
              setShowOpen(false);
              setError(null);
            }}
          />
          <form
            onSubmit={openAccount}
            className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-ink-950">
                  Νέος λογαριασμός
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Σύνδεση πελάτη με το πρόγραμμα loyalty
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowOpen(false);
                  setError(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
                aria-label="Κλείσιμο"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Αναζήτηση πελάτη</span>
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={customerFilter}
                    onChange={(e) => setCustomerFilter(e.target.value)}
                    placeholder="Όνομα ή κωδικός…"
                    className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                  />
                </div>
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Πελάτης *</span>
                <select
                  name="customerId"
                  required
                  className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                  defaultValue=""
                >
                  <option value="" disabled>
                    {filteredCustomers.length
                      ? "Επιλογή…"
                      : "Κανένας διαθέσιμος πελάτης"}
                  </option>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-slate-500">
                  Εμφανίζονται μόνο πελάτες χωρίς υπάρχοντα λογαριασμό (
                  {filteredCustomers.length}).
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Tier</span>
                  <select
                    name="tier"
                    defaultValue="STANDARD"
                    className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                  >
                    {Object.entries(loyaltyTierLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Αρχικοί πόντοι</span>
                  <input
                    name="openingPoints"
                    type="number"
                    min={0}
                    defaultValue={0}
                    className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Σημείωση</span>
                <input
                  name="note"
                  placeholder="Προαιρετικά"
                  className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                />
              </label>
            </div>

            <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
              <Button type="submit" disabled={pending} className="flex-1">
                {pending ? "Δημιουργία…" : "Δημιουργία"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowOpen(false);
                  setError(null);
                }}
              >
                Ακύρωση
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative pb-3 text-sm font-medium transition",
        active ? "text-ink-950" : "text-slate-500 hover:text-ink-800",
      )}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={cn(
            "ml-1.5 tabular-nums",
            active ? "text-teal-700" : "text-slate-400",
          )}
        >
          {count}
        </span>
      ) : null}
      {active ? (
        <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-600" />
      ) : null}
    </button>
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
        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
        active
          ? "border-ink-900 bg-ink-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink-900",
      )}
    >
      {label}
    </button>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 text-slate-500">
        <span className="flex size-7 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
          {icon}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-ink-950">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}
