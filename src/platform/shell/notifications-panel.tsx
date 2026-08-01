"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CircleDollarSign,
  ClipboardList,
  EyeOff,
  FileWarning,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Warehouse,
} from "lucide-react";
import { Drawer } from "@/shared/ui/drawer";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type Category = "finance" | "inventory" | "sales" | "mydata" | "ops";
type Priority = "critical" | "high" | "medium" | "low";
type Tone = "rose" | "amber" | "slate" | "teal";

type NotifAction = {
  id: string;
  label: string;
  href: string;
  primary?: boolean;
};

type Notif = {
  id: string;
  category: Category;
  priority: Priority;
  tone: Tone;
  title: string;
  body: string;
  href: string;
  entityLabel?: string;
  amount?: number | null;
  meta?: Array<{ label: string; value: string }>;
  tags?: string[];
  actions: NotifAction[];
  createdAt: string;
};

type Summary = {
  count: number;
  overdueTotal?: number;
  lowStock?: number;
  mydata?: number;
  draftOrders?: number;
  draftInvoices?: number;
  byCategory?: Record<Category, number>;
  byPriority?: Record<Priority, number>;
};

const READ_KEY = "softifyos.notif.read";
const DISMISS_KEY = "softifyos.notif.dismissed";

const CATEGORY_LABEL: Record<Category | "all", string> = {
  all: "Όλα",
  finance: "Οικονομικά",
  inventory: "Αποθήκη",
  sales: "Πωλήσεις",
  mydata: "myDATA",
  ops: "Ops",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Κρίσιμο",
  high: "Υψηλό",
  medium: "Μέτριο",
  low: "Χαμηλό",
};

const toneStyles: Record<
  Tone,
  { dot: string; soft: string; icon: string; ring: string }
> = {
  rose: {
    dot: "bg-rose-500",
    soft: "bg-rose-50 border-rose-100",
    icon: "text-rose-700 bg-rose-100",
    ring: "ring-rose-200",
  },
  amber: {
    dot: "bg-amber-500",
    soft: "bg-amber-50 border-amber-100",
    icon: "text-amber-800 bg-amber-100",
    ring: "ring-amber-200",
  },
  slate: {
    dot: "bg-slate-400",
    soft: "bg-slate-50 border-slate-200",
    icon: "text-slate-700 bg-slate-100",
    ring: "ring-slate-200",
  },
  teal: {
    dot: "bg-teal-500",
    soft: "bg-teal-50 border-teal-100",
    icon: "text-teal-800 bg-teal-100",
    ring: "ring-teal-200",
  },
};

function categoryIcon(cat: Category) {
  switch (cat) {
    case "finance":
      return CircleDollarSign;
    case "inventory":
      return Warehouse;
    case "sales":
      return ClipboardList;
    case "mydata":
      return ShieldAlert;
    case "ops":
      return Package;
  }
}

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set].slice(-400)));
  } catch {
    /* ignore */
  }
}

function relativeTime(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "τώρα";
  if (mins < 60) return `${mins}λ`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}ω`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}η`;
  return new Date(iso).toLocaleDateString("el-GR");
}

function money(n: number) {
  return n.toLocaleString("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

export function NotificationsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [summary, setSummary] = useState<Summary>({ count: 0 });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sort, setSort] = useState<"priority" | "recent">("priority");
  const [hideRead, setHideRead] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setReadIds(loadSet(READ_KEY));
    setDismissedIds(loadSet(DISMISS_KEY));
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setItems((data.items || []) as Notif[]);
        setSummary((data.summary || { count: 0 }) as Summary);
        setGeneratedAt(data.generatedAt ?? null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, []);

  const unreadCount = useMemo(() => {
    return items.filter(
      (n) => !readIds.has(n.id) && !dismissedIds.has(n.id),
    ).length;
  }, [items, readIds, dismissedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.filter((n) => {
      if (!showDismissed && dismissedIds.has(n.id)) return false;
      if (showDismissed && !dismissedIds.has(n.id)) return false;
      if (hideRead && !showDismissed && readIds.has(n.id)) return false;
      if (category !== "all" && n.category !== category) return false;
      if (priority !== "all" && n.priority !== priority) return false;
      if (!q) return true;
      const hay = [
        n.title,
        n.body,
        n.entityLabel,
        ...(n.tags ?? []),
        ...(n.meta?.map((m) => `${m.label} ${m.value}`) ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    const rank: Record<Priority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    list = [...list].sort((a, b) => {
      if (sort === "recent") return b.createdAt.localeCompare(a.createdAt);
      const pr = rank[a.priority] - rank[b.priority];
      if (pr !== 0) return pr;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return list;
  }, [
    items,
    query,
    category,
    priority,
    sort,
    hideRead,
    showDismissed,
    readIds,
    dismissedIds,
  ]);

  function markRead(id: string) {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveSet(READ_KEY, next);
      return next;
    });
  }

  function markAllRead() {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const n of items) {
        if (!dismissedIds.has(n.id)) next.add(n.id);
      }
      saveSet(READ_KEY, next);
      return next;
    });
  }

  function dismiss(id: string) {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveSet(DISMISS_KEY, next);
      return next;
    });
    markRead(id);
  }

  function clearDismissed() {
    setDismissedIds(() => {
      const next = new Set<string>();
      saveSet(DISMISS_KEY, next);
      return next;
    });
    setShowDismissed(false);
  }

  function openItem(n: Notif, href?: string) {
    markRead(n.id);
    setOpen(false);
    router.push(href || n.href);
  }

  const categoryTabs: Array<Category | "all"> = [
    "all",
    "finance",
    "inventory",
    "sales",
    "mydata",
    "ops",
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
        aria-label="Ειδοποιήσεις"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={18} strokeWidth={1.75} className="pointer-events-none" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#F1F4F7]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Κέντρο ειδοποιήσεων"
        subtitle={
          unreadCount > 0
            ? `${unreadCount} μη αναγνωσμένες · ${summary.count} συνολικά`
            : summary.count > 0
              ? `${summary.count} ενεργές · όλες αναγνωσμένες`
              : "Καμία εκκρεμότητα"
        }
        widthClass="max-w-lg"
        headerExtra={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            disabled={loading}
          >
            <RefreshCw
              size={12}
              className={cn(loading && "animate-spin")}
            />
            Ανανέωση
          </button>
        }
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={unreadCount === 0}
              onClick={markAllRead}
            >
              <CheckCheck size={14} /> Όλα διαβασμένα
            </Button>
            {dismissedIds.size > 0 ? (
              <Button size="sm" variant="ghost" onClick={clearDismissed}>
                <Trash2 size={14} /> Καθαρισμός κρυφών
              </Button>
            ) : null}
            <span className="ml-auto text-[11px] text-slate-400">
              {generatedAt
                ? `Ενημ. ${relativeTime(generatedAt)}`
                : "Live feed"}
            </span>
          </div>
        }
      >
        <div className="space-y-3">
          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {
                label: "AR ληξιπρ.",
                value:
                  summary.overdueTotal != null
                    ? money(summary.overdueTotal)
                    : "—",
                tone: "text-rose-700",
              },
              {
                label: "Χαμηλό στοκ",
                value: String(summary.lowStock ?? 0),
                tone: "text-amber-700",
              },
              {
                label: "myDATA",
                value: String(summary.mydata ?? 0),
                tone: "text-rose-700",
              },
              {
                label: "Drafts",
                value: String(
                  (summary.draftOrders ?? 0) + (summary.draftInvoices ?? 0),
                ),
                tone: "text-slate-700",
              },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-2"
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {k.label}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-sm font-semibold tabular-nums",
                    k.tone,
                  )}
                >
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          {/* Search + toggles */}
          <div className="space-y-2">
            <label className="relative block">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Αναζήτηση τίτλου, πελάτη, SKU, tag…"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-teal-400"
              />
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as Priority | "all")
                }
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
              >
                <option value="all">Όλες οι προτεραιότητες</option>
                <option value="critical">Κρίσιμα</option>
                <option value="high">Υψηλά</option>
                <option value="medium">Μέτρια</option>
                <option value="low">Χαμηλά</option>
              </select>
              <select
                value={sort}
                onChange={(e) =>
                  setSort(e.target.value as "priority" | "recent")
                }
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
              >
                <option value="priority">Ταξινόμηση: προτεραιότητα</option>
                <option value="recent">Ταξινόμηση: νεότερα</option>
              </select>
              <button
                type="button"
                onClick={() => setHideRead((v) => !v)}
                className={cn(
                  "h-8 rounded-lg border px-2 text-xs font-medium",
                  hideRead
                    ? "border-teal-200 bg-teal-50 text-teal-800"
                    : "border-slate-200 bg-white text-slate-600",
                )}
              >
                {hideRead ? "Απόκρυψη διαβασμένων" : "Εμφάνιση διαβασμένων"}
              </button>
              <button
                type="button"
                onClick={() => setShowDismissed((v) => !v)}
                className={cn(
                  "h-8 rounded-lg border px-2 text-xs font-medium",
                  showDismissed
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-white text-slate-600",
                )}
              >
                <span className="inline-flex items-center gap-1">
                  <EyeOff size={12} />
                  Κρυφές ({dismissedIds.size})
                </span>
              </button>
            </div>
          </div>

          {/* Category tabs */}
          <div className="flex flex-wrap gap-1">
            {categoryTabs.map((c) => {
              const count =
                c === "all"
                  ? summary.count
                  : (summary.byCategory?.[c] ?? 0);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium",
                    category === c
                      ? "bg-teal-800 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {CATEGORY_LABEL[c]}
                  {count > 0 ? (
                    <span className="ml-1 opacity-80">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* List */}
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Φόρτωση…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <Bell size={18} />
              </span>
              <p className="text-sm font-medium text-ink-900">
                {showDismissed
                  ? "Δεν υπάρχουν κρυφές ειδοποιήσεις"
                  : items.length === 0
                    ? "Όλα εντάξει"
                    : "Κανένα αποτέλεσμα"}
              </p>
              <p className="max-w-[240px] text-xs text-slate-500">
                {items.length === 0
                  ? "Δεν υπάρχουν ειδοποιήσεις προς ενέργεια."
                  : "Δοκίμασε άλλο φίλτρο ή αναζήτηση."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2 pb-2">
              {filtered.map((n) => {
                const Icon = categoryIcon(n.category);
                const styles = toneStyles[n.tone];
                const isRead = readIds.has(n.id);
                const isDismissed = dismissedIds.has(n.id);
                const expanded = expandedId === n.id;
                return (
                  <li key={n.id}>
                    <article
                      className={cn(
                        "rounded-2xl border px-3 py-3 shadow-sm transition",
                        isRead ? "bg-white border-slate-200/80" : styles.soft,
                        !isRead && `ring-1 ${styles.ring}`,
                        isDismissed && "opacity-70",
                      )}
                    >
                      <div className="flex gap-3">
                        <span
                          className={cn(
                            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                            styles.icon,
                          )}
                        >
                          {n.priority === "critical" ? (
                            <AlertTriangle size={16} />
                          ) : n.priority === "high" ? (
                            <FileWarning size={16} />
                          ) : (
                            <Icon size={16} />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start gap-1.5">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() =>
                                setExpandedId((id) =>
                                  id === n.id ? null : n.id,
                                )
                              }
                            >
                              <p
                                className={cn(
                                  "text-sm leading-snug text-ink-950",
                                  isRead ? "font-medium" : "font-semibold",
                                )}
                              >
                                {!isRead ? (
                                  <span
                                    className={cn(
                                      "mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
                                      styles.dot,
                                    )}
                                  />
                                ) : null}
                                {n.title}
                              </p>
                              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                                {n.body}
                              </p>
                            </button>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className="text-[10px] tabular-nums text-slate-400">
                                {relativeTime(n.createdAt)}
                              </span>
                              <span
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  n.priority === "critical" &&
                                    "bg-rose-100 text-rose-800",
                                  n.priority === "high" &&
                                    "bg-amber-100 text-amber-900",
                                  n.priority === "medium" &&
                                    "bg-slate-100 text-slate-700",
                                  n.priority === "low" &&
                                    "bg-slate-50 text-slate-500",
                                )}
                              >
                                {PRIORITY_LABEL[n.priority]}
                              </span>
                            </div>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200/80">
                              {CATEGORY_LABEL[n.category]}
                            </span>
                            {(n.tags ?? []).slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200/60"
                              >
                                {t}
                              </span>
                            ))}
                            {n.amount != null ? (
                              <span className="ml-auto text-xs font-semibold tabular-nums text-ink-950">
                                {money(n.amount)}
                              </span>
                            ) : null}
                          </div>

                          {expanded && n.meta?.length ? (
                            <dl className="mt-2 grid grid-cols-2 gap-1.5 rounded-xl bg-white/70 p-2 text-[11px]">
                              {n.meta.map((m) => (
                                <div key={`${m.label}:${m.value}`}>
                                  <dt className="text-slate-400">{m.label}</dt>
                                  <dd className="font-medium text-slate-700">
                                    {m.value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}

                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            {(n.actions?.length
                              ? n.actions
                              : [
                                  {
                                    id: "open",
                                    label: "Άνοιγμα",
                                    href: n.href,
                                    primary: true,
                                  },
                                ]
                            ).map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => openItem(n, a.href)}
                                className={cn(
                                  "rounded-lg px-2.5 py-1 text-xs font-medium",
                                  a.primary
                                    ? "bg-teal-800 text-white hover:bg-teal-900"
                                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                )}
                              >
                                {a.label}
                              </button>
                            ))}
                            {!isRead ? (
                              <button
                                type="button"
                                onClick={() => markRead(n.id)}
                                className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white"
                              >
                                Διαβάστηκε
                              </button>
                            ) : null}
                            {!isDismissed ? (
                              <button
                                type="button"
                                onClick={() => dismiss(n.id)}
                                className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white"
                              >
                                Απόκρυψη
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Drawer>
    </>
  );
}
