"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  Users,
  Wallet,
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
  createdAt?: string;
};

type Stats = {
  totalAccounts: number;
  activeAccounts: number;
  pointsTotal: number;
  valueTotal: number;
  byTier: Record<string, number>;
};

type Tab = "accounts" | "program";
type StatusFilter = "all" | "active" | "inactive";
type SortKey = "updated" | "points_desc" | "points_asc" | "name" | "tier";

const PAGE_SIZES = [25, 50, 100] as const;

const loyaltyRowGrid =
  "lg:grid-cols-[2rem_minmax(0,1.4fr)_6.5rem_6.5rem_6rem_7rem_7rem_2.5rem]";

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

function relativeTime(iso: string) {
  const d = new Date(iso);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "μόλις τώρα";
  const min = Math.round(sec / 60);
  if (min < 60) return `πριν ${min} λεπ.`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `πριν ${hr} ώρ.`;
  const day = Math.round(hr / 24);
  if (day < 30) return `πριν ${day} ημ.`;
  return d.toLocaleDateString("el-GR");
}

export function LoyaltyAccountsClient({
  initialItems,
  customersWithout,
  canWrite,
  canManageProgram,
  initialProgram,
  initialTab = "accounts",
  initialStats,
}: {
  initialItems: Item[];
  customersWithout: { id: string; code: string; name: string }[];
  canWrite: boolean;
  canManageProgram: boolean;
  initialProgram: LoyaltyProgramForm;
  initialTab?: Tab;
  initialStats?: Stats;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [program, setProgram] = useState(initialProgram);
  const [items, setItems] = useState(initialItems);
  const [stats, setStats] = useState<Stats>(
    initialStats ?? {
      totalAccounts: initialItems.length,
      activeAccounts: initialItems.filter((a) => a.isActive).length,
      pointsTotal: initialItems.reduce((s, a) => s + a.pointsBalance, 0),
      valueTotal: initialItems.reduce((s, a) => s + a.balanceEur, 0),
      byTier: {},
    },
  );
  const [total, setTotal] = useState(initialStats?.totalAccounts ?? initialItems.length);
  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [minPoints, setMinPoints] = useState("");
  const [maxPoints, setMaxPoints] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZES)[number]>(50);
  const [offset, setOffset] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customerFilter, setCustomerFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showOpen, setShowOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("10");
  const [adjustNote, setAdjustNote] = useState("Χειροκίνητη προσαρμογή");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#open" && canWrite) {
      setShowOpen(true);
      setTab("accounts");
    }
  }, [canWrite]);

  const load = useCallback(
    (opts?: {
      q?: string;
      status?: StatusFilter;
      tier?: string;
      minPoints?: string;
      maxPoints?: string;
      sort?: SortKey;
      limit?: number;
      offset?: number;
    }) => {
      const params = new URLSearchParams({
        limit: String(opts?.limit ?? pageSize),
        offset: String(opts?.offset ?? offset),
        sort: opts?.sort ?? sort,
        status: opts?.status ?? statusFilter,
        tier: opts?.tier ?? tierFilter,
      });
      const qq = opts?.q ?? q;
      if (qq.trim()) params.set("q", qq.trim());
      const minP = opts?.minPoints ?? minPoints;
      const maxP = opts?.maxPoints ?? maxPoints;
      if (minP.trim()) params.set("minPoints", minP.trim());
      if (maxP.trim()) params.set("maxPoints", maxP.trim());

      startTransition(async () => {
        setError(null);
        const res = await fetch(`/api/loyalty/accounts?${params}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Αποτυχία φόρτωσης");
          return;
        }
        setItems(data.items || []);
        setTotal(data.meta?.total ?? 0);
        if (data.stats) setStats(data.stats);
        setSelected(new Set());
        setRowMenu(null);
      });
    },
    [
      pageSize,
      offset,
      sort,
      statusFilter,
      tierFilter,
      q,
      minPoints,
      maxPoints,
    ],
  );

  useEffect(() => {
    if (tab !== "accounts") return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, offset, pageSize, sort, statusFilter, tierFilter]);

  const filteredCustomers = useMemo(() => {
    const needle = customerFilter.trim().toLowerCase();
    if (!needle) return customersWithout;
    return customersWithout.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.code.toLowerCase().includes(needle),
    );
  }, [customersWithout, customerFilter]);

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(total, offset + items.length);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageIndex = Math.floor(offset / pageSize);

  const allSelected =
    items.length > 0 && items.every((a) => selected.has(a.id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((a) => a.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applySearch() {
    setOffset(0);
    void load({ offset: 0 });
  }

  function exportCsv() {
    const header = [
      "customerCode",
      "customerName",
      "email",
      "points",
      "valueEur",
      "tier",
      "status",
      "updatedAt",
      "accountId",
    ];
    const lines = [
      header.join(","),
      ...items.map((a) =>
        [
          a.customer.code,
          a.customer.name,
          a.customer.email ?? "",
          a.pointsBalance,
          a.balanceEur,
          a.tier,
          a.isActive ? "ACTIVE" : "INACTIVE",
          a.updatedAt,
          a.id,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `loyalty-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function bulkUpdate(patch: { isActive?: boolean; tier?: string }) {
    if (selected.size === 0) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/loyalty/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία μαζικής ενημέρωσης");
        return;
      }
      setMessage(`Ενημερώθηκαν ${data.updated} λογαριασμοί`);
      void load();
    });
  }

  async function patchOne(
    id: string,
    patch: { isActive?: boolean; tier?: string },
  ) {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/loyalty/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setRowMenu(null);
      void load();
    });
  }

  async function submitAdjust() {
    if (!adjustId) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/loyalty/accounts/${adjustId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust",
          points: Number(adjustPoints),
          note: adjustNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία προσαρμογής");
        return;
      }
      setAdjustId(null);
      setMessage("Οι πόντοι ενημερώθηκαν");
      void load();
    });
  }

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
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void load()}
                disabled={pending}
              >
                <RefreshCw
                  size={14}
                  className={cn(pending && "animate-spin")}
                />
                Ανανέωση
              </Button>
              <Button size="sm" variant="secondary" onClick={exportCsv}>
                <Download size={14} /> CSV
              </Button>
              <Button size="sm" onClick={() => setShowOpen(true)}>
                <Plus size={15} />
                Νέος λογαριασμός
              </Button>
            </div>
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
            count={stats.totalAccounts}
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<Users size={16} />}
              label="Ενεργοί λογαριασμοί"
              value={String(stats.activeAccounts)}
              hint={`${stats.totalAccounts} συνολικά`}
              onClick={() => {
                setStatusFilter("active");
                setOffset(0);
              }}
              active={statusFilter === "active"}
            />
            <StatCard
              icon={<Star size={16} />}
              label="Σύνολο πόντων"
              value={stats.pointsTotal.toLocaleString("el-GR")}
              hint="σε όλους τους λογαριασμούς"
              onClick={() => {
                setSort("points_desc");
                setOffset(0);
              }}
              active={sort === "points_desc"}
            />
            <StatCard
              icon={<Wallet size={16} />}
              label="Αξία εξαργύρωσης"
              value={formatEUR(stats.valueTotal)}
              hint="τρέχοντα υπόλοιπα"
            />
            <StatCard
              icon={<Star size={16} />}
              label="Κατανομή tiers"
              value={
                Object.entries(stats.byTier)
                  .map(
                    ([t, n]) =>
                      `${loyaltyTierLabel[t as keyof typeof loyaltyTierLabel] ?? t} ${n}`,
                  )
                  .join(" · ") || "—"
              }
              hint="κλικ σε tier chip για φίλτρο"
              compactValue
            />
          </div>

          <div className="soft-panel space-y-3 p-3 sm:p-4">
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
                    onClick={() => {
                      setStatusFilter(key);
                      setOffset(0);
                    }}
                    label={label}
                  />
                ))}
                <span className="mx-1 hidden h-6 w-px self-center bg-slate-200 sm:block" />
                <FilterChip
                  active={tierFilter === "all"}
                  onClick={() => {
                    setTierFilter("all");
                    setOffset(0);
                  }}
                  label="Όλα τα tiers"
                />
                {Object.entries(loyaltyTierLabel).map(([k, v]) => (
                  <FilterChip
                    key={k}
                    active={tierFilter === k}
                    onClick={() => {
                      setTierFilter(k);
                      setOffset(0);
                    }}
                    label={`${v}${stats.byTier[k] != null ? ` (${stats.byTier[k]})` : ""}`}
                  />
                ))}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 lg:max-w-md lg:justify-end">
                <label className="relative min-w-[200px] flex-1">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applySearch();
                    }}
                    placeholder="Αναζήτηση πελάτη…"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none ring-teal-500/30 placeholder:text-slate-400 focus:ring-2"
                  />
                </label>
                <Button size="sm" variant="secondary" onClick={applySearch}>
                  Αναζήτηση
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  <SlidersHorizontal size={14} />
                  Φίλτρα
                </Button>
              </div>
            </div>

            {advancedOpen ? (
              <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    Ελάχ. πόντοι
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={minPoints}
                    onChange={(e) => setMinPoints(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    Μέγ. πόντοι
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={maxPoints}
                    onChange={(e) => setMaxPoints(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    Ταξινόμηση
                  </span>
                  <select
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value as SortKey);
                      setOffset(0);
                    }}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                  >
                    <option value="updated">Τελευταία ενημέρωση</option>
                    <option value="points_desc">Πόντοι ↓</option>
                    <option value="points_asc">Πόντοι ↑</option>
                    <option value="name">Όνομα πελάτη</option>
                    <option value="tier">Tier</option>
                  </select>
                </label>
                <div className="flex items-end gap-2">
                  <Button
                    size="sm"
                    className="h-10"
                    onClick={() => {
                      setOffset(0);
                      void load({ offset: 0 });
                    }}
                  >
                    Εφαρμογή
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10"
                    onClick={() => {
                      setMinPoints("");
                      setMaxPoints("");
                      setQ("");
                      setStatusFilter("all");
                      setTierFilter("all");
                      setSort("updated");
                      setOffset(0);
                      void load({
                        q: "",
                        status: "all",
                        tier: "all",
                        minPoints: "",
                        maxPoints: "",
                        sort: "updated",
                        offset: 0,
                      });
                    }}
                  >
                    Καθαρισμός
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {selected.size > 0 && canWrite ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-sm">
              <span className="font-medium text-teal-900">
                {selected.size} επιλεγμένοι
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void bulkUpdate({ isActive: true })}
              >
                Ενεργοποίηση
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void bulkUpdate({ isActive: false })}
              >
                Απενεργοποίηση
              </Button>
              <select
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  void bulkUpdate({ tier: e.target.value });
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  Αλλαγή tier…
                </option>
                {Object.entries(loyaltyTierLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ml-auto text-xs text-slate-500 hover:underline"
                onClick={() => setSelected(new Set())}
              >
                Καθαρισμός επιλογής
              </button>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
              {message}
            </p>
          ) : null}

          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <ArrowDownUp size={14} className="text-slate-400" />
                Λογαριασμοί
              </div>
              <p className="text-xs text-slate-500">
                {rangeStart.toLocaleString("el-GR")}–
                {rangeEnd.toLocaleString("el-GR")} από{" "}
                {total.toLocaleString("el-GR")}
              </p>
            </div>

            <div
              className={cn(
                "sticky top-0 z-10 hidden border-b border-slate-100 bg-slate-50/95 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 backdrop-blur lg:grid lg:items-center lg:gap-3",
                loyaltyRowGrid,
              )}
            >
              <span>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Επιλογή όλων"
                />
              </span>
              <button
                type="button"
                className="text-left hover:text-ink-900"
                onClick={() => {
                  setSort("name");
                  setOffset(0);
                }}
              >
                Πελάτης
              </button>
              <button
                type="button"
                className="text-right hover:text-ink-900"
                onClick={() => {
                  setSort(
                    sort === "points_desc" ? "points_asc" : "points_desc",
                  );
                  setOffset(0);
                }}
              >
                Πόντοι
              </button>
              <span className="text-right">Αξία €</span>
              <button
                type="button"
                className="text-left hover:text-ink-900"
                onClick={() => {
                  setSort("tier");
                  setOffset(0);
                }}
              >
                Tier
              </button>
              <span>Κατάσταση</span>
              <button
                type="button"
                className="text-left hover:text-ink-900"
                onClick={() => {
                  setSort("updated");
                  setOffset(0);
                }}
              >
                Ενημέρωση
              </button>
              <span />
            </div>

            <ul
              className={cn(
                "divide-y divide-slate-100",
                pending && "opacity-60",
              )}
            >
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
                  <li key={a.id} className="relative">
                    <div
                      className={cn(
                        "grid gap-2 px-4 py-3.5 transition hover:bg-slate-50/90 lg:items-center lg:gap-3",
                        loyaltyRowGrid,
                      )}
                    >
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggleOne(a.id)}
                          aria-label={`Επιλογή ${a.customer.name}`}
                        />
                      </div>
                      <Link href={`/loyalty/${a.id}`} className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-950 hover:underline">
                          {a.customer.name}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                          {a.customer.code}
                          {a.customer.email ? ` · ${a.customer.email}` : ""}
                        </p>
                      </Link>
                      <div className="lg:text-right">
                        <p className="tabular-nums text-sm font-medium text-ink-900">
                          {a.pointsBalance.toLocaleString("el-GR")}
                        </p>
                      </div>
                      <div className="lg:text-right">
                        <p className="tabular-nums text-sm text-slate-600">
                          {formatEUR(a.balanceEur)}
                        </p>
                      </div>
                      <div>
                        <Badge tone={tierTone(a.tier)}>
                          {loyaltyTierLabel[
                            a.tier as keyof typeof loyaltyTierLabel
                          ] ?? a.tier}
                        </Badge>
                      </div>
                      <div>
                        <Badge tone={a.isActive ? "emerald" : "slate"}>
                          {a.isActive ? "Ενεργός" : "Ανενεργός"}
                        </Badge>
                      </div>
                      <div className="text-xs text-slate-500">
                        {relativeTime(a.updatedAt)}
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
                          onClick={() =>
                            setRowMenu((v) => (v === a.id ? null : a.id))
                          }
                          aria-label="Ενέργειες"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>
                    </div>

                    {rowMenu === a.id ? (
                      <div className="absolute right-4 top-12 z-20 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                        <Link
                          href={`/loyalty/${a.id}`}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                        >
                          Άνοιγμα
                        </Link>
                        <Link
                          href={`/customers/${a.customer.id}`}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                        >
                          <ExternalLink size={13} /> Πελάτης
                        </Link>
                        {canWrite ? (
                          <>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                              onClick={() => {
                                setAdjustId(a.id);
                                setRowMenu(null);
                              }}
                            >
                              Προσαρμογή πόντων
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                              onClick={() =>
                                void patchOne(a.id, {
                                  isActive: !a.isActive,
                                })
                              }
                            >
                              {a.isActive ? "Απενεργοποίηση" : "Ενεργοποίηση"}
                            </button>
                            <div className="border-t border-slate-100 px-2 py-1">
                              <p className="px-1 py-1 text-[10px] font-semibold uppercase text-slate-400">
                                Tier
                              </p>
                              {Object.entries(loyaltyTierLabel).map(
                                ([k, v]) => (
                                  <button
                                    key={k}
                                    type="button"
                                    className={cn(
                                      "flex w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50",
                                      a.tier === k && "font-semibold text-teal-800",
                                    )}
                                    onClick={() =>
                                      void patchOne(a.id, { tier: k })
                                    }
                                  >
                                    {v}
                                  </button>
                                ),
                              )}
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))
              )}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Ανά σελίδα</span>
                <select
                  value={pageSize}
                  disabled={pending}
                  onChange={(e) => {
                    setPageSize(
                      Number(e.target.value) as (typeof PAGE_SIZES)[number],
                    );
                    setOffset(0);
                  }}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span>
                  · Σελίδα {(pageIndex + 1).toLocaleString("el-GR")} /{" "}
                  {pageCount.toLocaleString("el-GR")}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset <= 0 || pending}
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                >
                  <ChevronLeft size={14} /> Προηγούμενα
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset + pageSize >= total || pending}
                  onClick={() => setOffset(offset + pageSize)}
                >
                  Επόμενα <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {adjustId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-ink-950">
              Προσαρμογή πόντων
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Θετικό = κέρδος, αρνητικό = αφαίρεση.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Πόντοι</span>
                <input
                  type="number"
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Σημείωση *</span>
                <input
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setAdjustId(null)}
              >
                Άκυρο
              </Button>
              <Button disabled={pending} onClick={() => void submitAdjust()}>
                Εφαρμογή
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
  onClick,
  active,
  compactValue,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  onClick?: () => void;
  active?: boolean;
  compactValue?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-2xl border bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        active ? "border-teal-400 ring-2 ring-teal-500/20" : "border-slate-200/90",
        onClick && "transition hover:border-teal-300 hover:bg-teal-50/30",
      )}
    >
      <div className="flex items-center gap-2 text-slate-500">
        <span className="flex size-7 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
          {icon}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p
        className={cn(
          "mt-2 font-semibold text-ink-950",
          compactValue
            ? "text-sm leading-snug"
            : "text-xl tabular-nums",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
    </Comp>
  );
}
